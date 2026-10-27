import picomatch from 'picomatch';
import type { CompassConfig } from '../config.js';
import type { Cycle, DiffGraph, DiffNode, Insight, Insights, RuleViolation } from '../schema.js';

const SYMBOL_KINDS = new Set(['function', 'method', 'class']);
const ENTRY_NAMES = /^(main|index|app|server|cli|application|__main__|manage|wsgi|asgi)\.[a-z]+$|Application\.java$|Main\.java$/i;
const TEST_OR_CONFIG = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|_test\.py$|Test\.java$|(^|\/)[^/]*\.config\.[a-z]+$|(^|\/)(setup|conftest)\.py$/i;

export function computeInsights(g: DiffGraph, config: CompassConfig): Insights {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const fileOf = (id: string) => byId.get(id)?.path ?? id;
  const isAncestor = (anc: string, id: string) => {
    let cur = byId.get(id)?.parentId;
    while (cur) {
      if (cur === anc) return true;
      cur = byId.get(cur)?.parentId ?? null;
    }
    return false;
  };

  // Aristas a nivel archivo
  const fileEdges = new Map<string, { s: string; t: string; changed: boolean; w: number }>();
  for (const e of g.edges) {
    const s = fileOf(e.source);
    const t = fileOf(e.target);
    if (s === t) continue;
    const k = `${s}->${t}`;
    const fe = fileEdges.get(k);
    if (fe) {
      fe.w += e.weight;
      fe.changed ||= e.changed;
    } else fileEdges.set(k, { s, t, changed: e.changed, w: e.weight });
  }
  const fanIn = new Map<string, Set<string>>();
  const fanOut = new Map<string, Set<string>>();
  for (const fe of fileEdges.values()) {
    if (!fanIn.has(fe.t)) fanIn.set(fe.t, new Set());
    fanIn.get(fe.t)!.add(fe.s);
    if (!fanOut.has(fe.s)) fanOut.set(fe.s, new Set());
    fanOut.get(fe.s)!.add(fe.t);
  }

  const languages: Record<string, number> = {};
  for (const n of g.nodes) if (n.kind === 'file' && n.language) languages[n.language] = (languages[n.language] ?? 0) + 1;

  const violations = checkRules(config, fileEdges.values());

  if (g.meta.mode === 'map') {
    return { ...mapInsights(g, config, fanIn, fanOut, fileEdges), violations, languages };
  }
  return { ...diffInsights(g, config, byId, fileOf, isAncestor), violations, languages };
}

function checkRules(config: CompassConfig, edges: Iterable<{ s: string; t: string }>): RuleViolation[] {
  const out: RuleViolation[] = [];
  const rules = config.rules.map((r) => ({ r, from: picomatch(r.from, { dot: true }), dis: picomatch(r.disallow, { dot: true }) }));
  if (!rules.length) return out;
  for (const e of edges) for (const { r, from, dis } of rules) if (from(e.s) && dis(e.t)) out.push({ rule: r.name, source: e.s, target: e.t });
  return out.slice(0, 500);
}

// ───────────────────────── modo diff ─────────────────────────

function diffInsights(
  g: DiffGraph,
  config: CompassConfig,
  byId: Map<string, DiffNode>,
  fileOf: (id: string) => string,
  isAncestor: (a: string, id: string) => boolean,
): Pick<Insights, 'entryPoints' | 'hotspots'> {
  const changed = (n?: DiffNode) => !!n && n.status !== 'unchanged';
  const totalLines = g.nodes.find((n) => n.kind === 'repo')!.stats;
  const totalChangedLines = Math.max(1, totalLines.added + totalLines.removed);

  // Entry points: símbolos cambiados llamados desde fuera de su archivo.
  const outsideCallers = new Map<string, Set<string>>();
  for (const e of g.edges) {
    const t = byId.get(e.target);
    if (!t || !SYMBOL_KINDS.has(t.kind) || !changed(t)) continue;
    const sf = fileOf(e.source);
    if (sf === t.path) continue;
    if (!outsideCallers.has(t.id)) outsideCallers.set(t.id, new Set());
    outsideCallers.get(t.id)!.add(sf);
  }
  let entries: Insight[] = [...outsideCallers.entries()].map(([id, callers]) => {
    const n = byId.get(id)!;
    const lines = n.stats.added + n.stats.removed;
    return {
      id,
      score: round(callers.size * 2 + Math.log2(1 + lines)),
      reason: `${statusWord(n.status)}, llamado desde ${callers.size} archivo${callers.size === 1 ? '' : 's'} (+${n.stats.added} −${n.stats.removed})`,
    };
  });
  if (entries.length < config.scoring.entryTop) {
    // Completar con símbolos exportados cambiados de mayor tamaño de cambio.
    const seen = new Set(entries.map((e) => e.id));
    const extra = g.nodes
      .filter((n) => SYMBOL_KINDS.has(n.kind) && changed(n) && n.status !== 'deleted' && !seen.has(n.id) && n.exported && !(n.parentId && changed(byId.get(n.parentId)) && byId.get(n.parentId)!.kind === 'class' && byId.get(n.parentId)!.status === 'added'))
      .map((n) => ({ id: n.id, score: round(Math.log2(1 + n.stats.added + n.stats.removed)), reason: `${statusWord(n.status)} y exportado (+${n.stats.added} −${n.stats.removed})` }));
    entries = entries.concat(extra.sort((a, b) => b.score - a.score));
  }
  entries.sort((a, b) => b.score - a.score);

  // Hotspots: directorios/archivos por donde pasan más aristas cambiadas.
  const changedEdges = g.edges.filter((e) => e.changed);
  const totalChangedEdges = Math.max(1, changedEdges.length);
  // Bajar por cadenas de un solo hijo cambiado (src/ → src/app/ …) para no reportar la raíz.
  const kids = new Map<string, DiffNode[]>();
  for (const n of g.nodes) if (n.parentId && (n.kind === 'directory' || n.kind === 'file')) {
    if (!kids.has(n.parentId)) kids.set(n.parentId, []);
    kids.get(n.parentId)!.push(n);
  }
  let focus = g.nodes.find((n) => n.kind === 'repo')!;
  for (;;) {
    const ch = (kids.get(focus.id) ?? []).filter(changed);
    if (ch.length === 1 && ch[0].kind === 'directory') focus = ch[0];
    else break;
  }
  const candidates = g.nodes.filter((n) => (n.kind === 'directory' || n.kind === 'file') && changed(n) && n.id !== focus.id && isAncestor(focus.id, n.id));
  const touches = new Map<string, number>();
  for (const e of changedEdges) {
    const marked = new Set<string>();
    for (const end of [e.source, e.target]) {
      // subir desde el archivo del extremo hasta la raíz
      let cur: string | null = fileOf(end);
      while (cur) {
        marked.add(cur);
        cur = byId.get(cur)?.parentId ?? null;
      }
    }
    for (const m of marked) touches.set(m, (touches.get(m) ?? 0) + 1);
  }
  const scored = candidates
    .map((n) => {
      const t = touches.get(n.id) ?? 0;
      const lines = n.stats.added + n.stats.removed;
      const score = config.scoring.weightEdges * (t / totalChangedEdges) + config.scoring.weightLines * (lines / totalChangedLines);
      return { n, t, lines, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  // Un nodo que concentra casi todo y tiene varios hijos cambiados es demasiado general: se reportan sus hijos.
  const changedKids = (id: string) => (kids.get(id) ?? []).filter(changed).length;
  // También se baja a un hijo cuando ese hijo carga ≥ 70% de lo que pasa por el padre.
  const dominantChild = (id: string, t: number) => (kids.get(id) ?? []).some((k) => changed(k) && t > 0 && (touches.get(k.id) ?? 0) >= 0.7 * t);
  const tooGeneral = (x: (typeof scored)[number]) =>
    x.n.kind === 'directory' && ((x.t / totalChangedEdges >= 0.85 && changedKids(x.n.id) >= 2) || dominantChild(x.n.id, x.t));
  const hotspots: Insight[] = [];
  for (const x of scored) {
    if (hotspots.length >= config.scoring.hotspotTop) break;
    if (tooGeneral(x)) continue;
    // evitar reportar un nodo y su ancestro/descendiente
    const overlap = hotspots.some((h) => isAncestor(h.id, x.n.id) || isAncestor(x.n.id, h.id));
    if (overlap) continue;
    const pct = Math.round((100 * x.t) / totalChangedEdges);
    const files = x.n.kind === 'file' ? '' : plural(x.n.stats.addedChildren + x.n.stats.modifiedChildren + x.n.stats.deletedChildren, 'archivo cambiado', 'archivos cambiados') + ', ';
    const head = x.t > 0 ? `${pct}% de las dependencias cambiadas pasan por aquí` : 'sin dependencias cambiadas';
    hotspots.push({ id: x.n.id, score: round(x.score), reason: `${head}; ${files}+${x.n.stats.added} −${x.n.stats.removed}` });
  }
  return { entryPoints: entries.slice(0, config.scoring.entryTop), hotspots };
}

// ───────────────────────── modo map ─────────────────────────

function mapInsights(
  g: DiffGraph,
  config: CompassConfig,
  fanIn: Map<string, Set<string>>,
  fanOut: Map<string, Set<string>>,
  fileEdges: Map<string, { s: string; t: string }>,
): Pick<Insights, 'entryPoints' | 'hotspots' | 'cycles' | 'orphans'> {
  const codeFiles = g.nodes.filter((n) => n.kind === 'file' && g.nodes.some((c) => c.parentId === n.id));
  const parsedSet = new Set(g.nodes.filter((n) => n.kind === 'file' && n.language && ['typescript', 'tsx', 'javascript', 'python', 'java'].includes(n.language)).map((n) => n.id));

  const entryPoints: Insight[] = [];
  for (const f of parsedSet) {
    const fin = fanIn.get(f)?.size ?? 0;
    const fout = fanOut.get(f)?.size ?? 0;
    const named = ENTRY_NAMES.test(f.split('/').pop() ?? '');
    const hasMain = g.nodes.some((n) => n.path === f && n.name === 'main' && (n.kind === 'function' || n.kind === 'method'));
    if (TEST_OR_CONFIG.test(f)) continue;
    if ((fin === 0 && fout > 0) || named || hasMain) {
      const depthPenalty = f.split('/').length;
      entryPoints.push({
        id: f,
        score: round(fout + (named ? 5 : 0) + (hasMain ? 5 : 0) - depthPenalty * 0.5),
        reason: [fin === 0 ? 'nadie lo importa' : `importado por ${fin}`, `importa ${fout} archivo${fout === 1 ? '' : 's'}`, named ? 'nombre de entrada' : '', hasMain ? 'define main' : ''].filter(Boolean).join(' · '),
      });
    }
  }
  entryPoints.sort((a, b) => b.score - a.score);

  const hotspots: Insight[] = [...fanIn.entries()]
    .map(([id, s]) => ({ id, score: s.size, reason: `importado/usado por ${plural(s.size, 'archivo', 'archivos')}` }))
    .sort((a, b) => b.score - a.score)
    .slice(0, config.scoring.hotspotTop * 2);

  const cycles = findCycles([...fileEdges.values()]);
  const orphans = [...parsedSet].filter((f) => !fanIn.has(f) && !fanOut.has(f) && !TEST_OR_CONFIG.test(f) && codeFiles.some((c) => c.id === f)).slice(0, 100);

  return { entryPoints: entryPoints.slice(0, config.scoring.entryTop), hotspots, cycles, orphans };
}

/** Componentes fuertemente conexos (Tarjan) con más de un archivo. */
export function findCycles(edges: { s: string; t: string }[]): Cycle[] {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.s)) adj.set(e.s, []);
    adj.get(e.s)!.push(e.t);
  }
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: Cycle[] = [];
  const strong = (v: string) => {
    // versión iterativa para no reventar el stack en repos grandes
    const work: [string, number][] = [[v, 0]];
    idx.set(v, index);
    low.set(v, index++);
    stack.push(v);
    onStack.add(v);
    while (work.length) {
      const top = work[work.length - 1];
      const [node, i] = top;
      const ns = adj.get(node) ?? [];
      if (i < ns.length) {
        top[1]++;
        const w = ns[i];
        if (!idx.has(w)) {
          idx.set(w, index);
          low.set(w, index++);
          stack.push(w);
          onStack.add(w);
          work.push([w, 0]);
        } else if (onStack.has(w)) low.set(node, Math.min(low.get(node)!, idx.get(w)!));
      } else {
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1][0];
          low.set(parent, Math.min(low.get(parent)!, low.get(node)!));
        }
        if (low.get(node) === idx.get(node)) {
          const comp: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            comp.push(w);
          } while (w !== node);
          if (comp.length > 1) out.push({ files: comp.sort() });
        }
      }
    }
  };
  for (const v of adj.keys()) if (!idx.has(v)) strong(v);
  return out.sort((a, b) => b.files.length - a.files.length).slice(0, 50);
}

const round = (x: number) => Math.round(x * 100) / 100;
const statusWord = (s: string) => ({ added: 'Nuevo', modified: 'Modificado', deleted: 'Borrado', unchanged: 'Sin cambios' })[s] ?? s;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
