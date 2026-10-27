import { basename } from 'node:path';
import picomatch from 'picomatch';
import type { CompassConfig } from '../config.js';
import { changedLineSets, Git, WORKTREE } from '../git/git.js';
import { parseSource, type ParsedFile, type ParsedSymbol } from '../parse/extract.js';
import { languageFor, passiveLanguage } from '../parse/languages.js';
import { parseTsconfig, Resolver } from '../parse/resolve.js';
import type { ChangeStatus, DiffEdge, DiffGraph, DiffNode, EdgeKind, FileDiff, GraphMeta, Mode, NodeStats } from '../schema.js';
import { SCHEMA_VERSION } from '../schema.js';
import { computeInsights } from '../score/insights.js';

export interface AnalyzeOptions {
  root: string;
  mode: Mode;
  config: CompassConfig;
  /** Solo diff/pr. */
  base?: string;
  head?: string;
  /** Comparar contra el merge-base (como un PR). Default true. */
  mergeBase?: boolean;
  pr?: GraphMeta['pr'];
  onProgress?: (msg: string) => void;
}

/** Nombres demasiado comunes para resolver llamadas entre archivos por nombre. */
const GENERIC = new Set(
  'map filter reduce forEach push pop shift unshift slice splice join split replace trim toString valueOf get set has add delete clear keys values entries then catch finally log error warn info debug emit on off subscribe pipe next resolve reject apply call bind length size equals hashCode compareTo append format parse stringify assign create update find findOne findAll save remove run start stop init close open read write send render print len str int dict list items sorted range super constructor __init__'.split(
    ' ',
  ),
);

const emptyStats = (): NodeStats => ({ added: 0, removed: 0, addedChildren: 0, modifiedChildren: 0, deletedChildren: 0, deps: 0, files: 0, lines: 0 });

export const ROOT_ID = '.';
export const dirId = (p: string) => (p ? `${p}/` : ROOT_ID);
export const symId = (file: string, qualified: string) => `${file}#${qualified}`;

export async function analyze(opts: AnalyzeOptions): Promise<DiffGraph> {
  const t0 = Date.now();
  const { config, mode } = opts;
  const log = opts.onProgress ?? (() => {});
  const git = new Git(opts.root);
  if (!git.isRepo()) throw new Error(`${opts.root} no es un repositorio git`);

  let head = opts.head ?? config.head;
  if (head === WORKTREE && !git.hasCommits() && mode !== 'map') throw new Error('El repo no tiene commits todavía: usa el modo map.');
  if (head !== WORKTREE && !git.refExists(head)) throw new Error(`No existe el ref head "${head}"`);

  let baseRef: string | undefined;
  let fileDiffs: FileDiff[] = [];
  if (mode !== 'map') {
    const base = opts.base ?? config.base;
    if (!git.refExists(base)) throw new Error(`No existe el ref base "${base}". Usa --base <rama|commit>.`);
    baseRef = opts.mergeBase === false ? base : git.mergeBase(base, head);
    log(`diff ${baseRef.slice(0, 10)}…${head === WORKTREE ? 'worktree' : head}`);
    fileDiffs = git.diff(baseRef, head);
  }

  const isIncluded = picomatch(config.include, { dot: true });
  const isExcluded = picomatch(config.exclude, { dot: true });
  const keep = (p: string) => isIncluded(p) && !isExcluded(p);

  const headFiles = git.listFiles(head).filter(keep).slice(0, config.maxFiles);
  const diffByPath = new Map<string, FileDiff>();
  for (const fd of fileDiffs) if (keep(fd.path)) diffByPath.set(fd.path, fd);

  // ── Parseo ──
  const parsedHead = new Map<string, ParsedFile>();
  const parsedBase = new Map<string, ParsedFile>();
  const lineCount = new Map<string, number>();
  const headSources = git.readMany(head, headFiles, config.maxFileBytes);
  let n = 0;
  for (const f of headFiles) {
    if (++n % 500 === 0) log(`parseando ${n}/${headFiles.length}`);
    const src = headSources.get(f);
    if (src === undefined) continue;
    lineCount.set(f, src.length ? src.split('\n').length : 0);
    const lang = languageFor(f, config.languages);
    if (!lang) continue;
    parsedHead.set(f, await parseSource(f, src, lang));
  }
  const baseNeeded = [...diffByPath.values()].filter((fd) => fd.status !== 'added' && baseRef);
  const baseSources = baseRef ? git.readMany(baseRef, baseNeeded.map((fd) => fd.oldPath ?? fd.path), config.maxFileBytes) : new Map();
  for (const fd of baseNeeded) {
    const oldPath = fd.oldPath ?? fd.path;
    const lang = languageFor(oldPath, config.languages);
    const src = baseSources.get(oldPath);
    if (src === undefined) continue;
    if (fd.status === 'deleted') lineCount.set(fd.path, src.split('\n').length);
    if (lang) parsedBase.set(fd.path, await parseSource(fd.path, src, lang));
  }

  // ── Nodos ──
  const nodes = new Map<string, DiffNode>();
  const repoName = basename(opts.root);
  nodes.set(ROOT_ID, { id: ROOT_ID, kind: 'repo', name: repoName, path: '', parentId: null, status: 'unchanged', stats: emptyStats() });

  const ensureDir = (dirPath: string): string => {
    if (!dirPath) return ROOT_ID;
    const id = dirId(dirPath);
    if (!nodes.has(id)) {
      const parent = dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : '';
      const parentId = ensureDir(parent);
      nodes.set(id, { id, kind: 'directory', name: dirPath.split('/').pop()!, path: dirPath, parentId, status: 'unchanged', stats: emptyStats() });
    }
    return id;
  };

  const deletedFiles = [...diffByPath.values()].filter((d) => d.status === 'deleted').map((d) => d.path);
  const allFiles = [...new Set([...headFiles, ...deletedFiles])].sort();

  for (const f of allFiles) {
    const parentId = ensureDir(f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '');
    const fd = diffByPath.get(f);
    const status: ChangeStatus = fd ? fd.status : 'unchanged';
    const parsed = parsedHead.get(f) ?? parsedBase.get(f);
    const node: DiffNode = {
      id: f,
      kind: 'file',
      name: f.split('/').pop()!,
      path: f,
      parentId,
      language: parsed?.language ?? passiveLanguage(f),
      status,
      stats: { ...emptyStats(), added: fd?.added ?? 0, removed: fd?.removed ?? 0, lines: lineCount.get(f) ?? parsed?.lines ?? 0, files: 1 },
    };
    nodes.set(f, node);

    const headParsed = status === 'deleted' ? undefined : parsedHead.get(f);
    const baseParsed = parsedBase.get(f);
    const sets = fd ? changedLineSets(fd) : undefined;

    const addSym = (s: ParsedSymbol, st: ChangeStatus, added: number, removed: number) => {
      const id = symId(f, s.qualified);
      nodes.set(id, {
        id,
        kind: s.kind,
        name: s.name,
        path: f,
        parentId: s.parent ? symId(f, s.parent) : f,
        language: parsed?.language,
        range: { start: s.start, end: s.end },
        status: st,
        stats: { ...emptyStats(), added, removed, lines: s.end - s.start + 1 },
        signature: s.signature,
        exported: s.exported,
      });
    };

    if (headParsed) {
      const baseByQ = new Map((baseParsed?.symbols ?? []).map((s) => [s.qualified, s]));
      for (const s of headParsed.symbols) {
        let st: ChangeStatus = 'unchanged';
        let added = 0;
        let removed = 0;
        if (status === 'added') {
          st = 'added';
          added = s.end - s.start + 1;
        } else if (sets) {
          for (const l of sets.addedNew) if (l >= s.start && l <= s.end) added++;
          const b = baseByQ.get(s.qualified);
          if (b) for (const l of sets.removedOld) if (l >= b.start && l <= b.end) removed++;
          const delInside = sets.deletionPoints.some((p) => p >= s.start && p <= s.end);
          if (!b && baseParsed) st = 'added';
          else if (added > 0 || removed > 0 || delInside) st = 'modified';
        }
        addSym(s, st, added, removed);
      }
      // Símbolos que existían en base y ya no están.
      if (baseParsed) {
        const headQ = new Set(headParsed.symbols.map((s) => s.qualified));
        for (const b of baseParsed.symbols) {
          if (headQ.has(b.qualified)) continue;
          if (b.parent && !headQ.has(b.parent) && !baseParsed.symbols.some((x) => x.qualified === b.parent)) continue;
          // El padre borrado también se agrega como borrado (se procesa en orden: padres primero).
          addSym({ ...b, parent: b.parent }, 'deleted', 0, b.end - b.start + 1);
        }
      }
    } else if (status === 'deleted' && baseParsed) {
      for (const b of baseParsed.symbols) addSym(b, 'deleted', 0, b.end - b.start + 1);
    }
  }

  // Un padre que no existe (p. ej. clase borrada cuyo hijo quedó) cuelga del archivo.
  for (const node of nodes.values()) if (node.parentId && !nodes.has(node.parentId)) node.parentId = node.path;

  // ── Aristas ──
  const tsDir = config.tsconfig.includes('/') ? config.tsconfig.slice(0, config.tsconfig.lastIndexOf('/')) : '.';
  const ts = parseTsconfig(git.readFile(head, config.tsconfig), tsDir);
  const pkgFiles = headFiles.filter((f) => f === 'package.json' || f.endsWith('/package.json'));
  const pkgJsons = new Map<string, string>();
  for (const [f, t] of git.readMany(head, pkgFiles, 256_000)) if (t) pkgJsons.set(f, t);
  const resolver = new Resolver(headFiles, parsedHead, config.sourceRoots, ts, pkgJsons);
  const edgeMap = new Map<string, DiffEdge>();
  const addEdge = (source: string, target: string, kind: EdgeKind) => {
    if (source === target || !nodes.has(source) || !nodes.has(target)) return;
    const id = `${kind}:${source}->${target}`;
    const e = edgeMap.get(id);
    if (e) e.weight++;
    else edgeMap.set(id, { id, source, target, kind, changed: false, weight: 1 });
  };

  // índices para resolver nombres
  const symbolsByFile = new Map<string, ParsedSymbol[]>();
  for (const [f, pf] of parsedHead) symbolsByFile.set(f, pf.symbols);

  for (const [f, pf] of parsedHead) {
    if (nodes.get(f)?.status === 'deleted') continue;
    const resolved = resolver.resolve(pf);
    const importedFiles = new Set<string>();
    const localToTarget = new Map<string, { file: string; imported: string }>();
    for (const r of resolved) {
      if (!r.implicit) addEdge(f, r.target, 'import');
      importedFiles.add(r.target);
      for (const nm of r.imp.names) localToTarget.set(nm.local, { file: r.target, imported: nm.imported });
    }
    // Java: imports del mismo paquete son implícitos; solo creamos arista si de verdad se usa (vía llamadas abajo).
    const own = pf.symbols;
    const findIn = (file: string, name: string, preferTop: boolean) => {
      const syms = symbolsByFile.get(file) ?? [];
      const top = syms.filter((s) => s.name === name && !s.parent);
      if (top.length) return top[0];
      if (preferTop) return undefined;
      const any = syms.filter((s) => s.name === name && s.kind !== 'property');
      return any.length === 1 ? any[0] : undefined;
    };
    const resolveName = (fromQ: string | undefined, name: string, onSelf: boolean): string | undefined => {
      const caller = fromQ ? own.find((s) => s.qualified === fromQ) : undefined;
      // 1. miembro de la misma clase
      if (caller) {
        const cls = classOf(own, caller);
        if (cls) {
          const m = own.find((s) => s.parent === cls.qualified && s.name === name);
          if (m) return symId(f, m.qualified);
        }
      }
      if (onSelf) return undefined;
      // 2. símbolo de nivel superior del mismo archivo
      const local = own.find((s) => s.name === name && !s.parent);
      if (local) return symId(f, local.qualified);
      // 3. nombre importado explícitamente
      const imp = localToTarget.get(name);
      if (imp) {
        const s = findIn(imp.file, imp.imported === 'default' ? name : imp.imported, false) ?? (imp.imported === 'default' ? (symbolsByFile.get(imp.file) ?? []).find((x) => x.exported && !x.parent) : undefined);
        return s ? symId(imp.file, s.qualified) : imp.file;
      }
      // 4. símbolo exportado o método único en algún archivo importado
      if (GENERIC.has(name)) return undefined;
      const hits: string[] = [];
      for (const t of importedFiles) {
        const s = findIn(t, name, false);
        // un símbolo de nivel superior solo es alcanzable desde otro archivo si se exporta
        if (s && (s.parent || s.exported)) hits.push(symId(t, s.qualified));
      }
      return hits.length === 1 ? hits[0] : undefined;
    };

    for (const c of pf.calls) {
      const target = resolveName(c.from, c.name, c.onSelf);
      if (!target) continue;
      const src = c.from ? symId(f, c.from) : f;
      if (target === src) continue;
      addEdge(src, target, 'call');
      // Java: uso real de una clase del mismo paquete → arista de archivo
      if (pf.language === 'java') {
        const tf = target.split('#')[0];
        if (tf !== f) addEdge(f, tf, 'import');
      }
    }
    for (const s of own) {
      for (const ext of s.extends) {
        const target = resolveName(s.qualified, ext, false);
        if (target) addEdge(symId(f, s.qualified), target, 'extends');
      }
    }
  }

  // ── Estados y rollup ──
  const children = new Map<string, DiffNode[]>();
  for (const node of nodes.values()) {
    if (!node.parentId) continue;
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId)!.push(node);
  }

  const rollup = (node: DiffNode): void => {
    const kids = children.get(node.id) ?? [];
    for (const k of kids) rollup(k);
    if (node.kind === 'directory' || node.kind === 'repo') {
      const s = node.stats;
      for (const k of kids) {
        s.added += k.stats.added;
        s.removed += k.stats.removed;
        s.lines += k.stats.lines;
        s.files += k.stats.files;
        if (k.kind === 'file') {
          if (k.status === 'added') s.addedChildren++;
          else if (k.status === 'modified') s.modifiedChildren++;
          else if (k.status === 'deleted') s.deletedChildren++;
        } else {
          s.addedChildren += k.stats.addedChildren;
          s.modifiedChildren += k.stats.modifiedChildren;
          s.deletedChildren += k.stats.deletedChildren;
        }
      }
      const fileStatuses = descendantsFiles(node, children).map((d) => d.status);
      if (fileStatuses.length && fileStatuses.every((x) => x === 'added')) node.status = 'added';
      else if (fileStatuses.length && fileStatuses.every((x) => x === 'deleted')) node.status = 'deleted';
      else if (fileStatuses.some((x) => x !== 'unchanged')) node.status = 'modified';
    } else {
      // archivo o símbolo: contar símbolos descendientes por estado
      for (const k of kids) {
        if (k.status === 'added') node.stats.addedChildren++;
        else if (k.status === 'modified') node.stats.modifiedChildren++;
        else if (k.status === 'deleted') node.stats.deletedChildren++;
        node.stats.addedChildren += k.stats.addedChildren;
        node.stats.modifiedChildren += k.stats.modifiedChildren;
        node.stats.deletedChildren += k.stats.deletedChildren;
      }
      if (node.kind !== 'file' && node.status === 'unchanged' && kids.some((k) => k.status !== 'unchanged')) node.status = 'modified';
    }
  };
  rollup(nodes.get(ROOT_ID)!);

  // aristas: changed + deps por subárbol
  const depth = new Map<string, number>();
  const getDepth = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    const p = nodes.get(id)?.parentId;
    const d = p ? getDepth(p) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  const edges = [...edgeMap.values()];
  for (const e of edges) {
    const s = nodes.get(e.source)!;
    const t = nodes.get(e.target)!;
    e.changed = s.status !== 'unchanged' || t.status !== 'unchanged';
    let a: string | null = e.source;
    let b: string | null = e.target;
    while (a && b && a !== b) {
      if (getDepth(a) >= getDepth(b)) {
        nodes.get(a)!.stats.deps++;
        a = nodes.get(a)!.parentId;
      } else {
        nodes.get(b)!.stats.deps++;
        b = nodes.get(b)!.parentId;
      }
    }
  }

  const fileRecord: Record<string, FileDiff> = {};
  for (const fd of diffByPath.values()) fileRecord[fd.path] = fd;

  const nodeList = [...nodes.values()];
  const graph: DiffGraph = {
    meta: {
      schemaVersion: SCHEMA_VERSION,
      tool: 'compass',
      mode,
      repo: repoName,
      root: opts.root,
      base: mode === 'map' ? undefined : (opts.base ?? config.base),
      head,
      baseSha: baseRef ? git.resolve(baseRef) : undefined,
      headSha: head === WORKTREE ? git.resolve('HEAD') : git.resolve(head),
      pr: opts.pr,
      generatedAt: new Date().toISOString(),
    },
    nodes: nodeList,
    edges,
    files: fileRecord,
    insights: { entryPoints: [], hotspots: [] },
  };
  graph.insights = computeInsights(graph, config);
  graph.meta.durationMs = Date.now() - t0;
  log(`${nodeList.length} nodos, ${edges.length} aristas en ${graph.meta.durationMs} ms`);
  return graph;
}

function classOf(syms: ParsedSymbol[], s: ParsedSymbol): ParsedSymbol | undefined {
  let cur: ParsedSymbol | undefined = s;
  while (cur) {
    if (cur.kind === 'class' || cur.kind === 'interface' || cur.kind === 'enum') return cur;
    cur = cur.parent ? syms.find((x) => x.qualified === cur!.parent) : undefined;
  }
  return undefined;
}

function descendantsFiles(node: DiffNode, children: Map<string, DiffNode[]>): DiffNode[] {
  const out: DiffNode[] = [];
  const stack = [...(children.get(node.id) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.kind === 'file') out.push(n);
    else if (n.kind === 'directory') stack.push(...(children.get(n.id) ?? []));
  }
  return out;
}
