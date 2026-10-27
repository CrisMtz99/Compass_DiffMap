import type { DiffEdge, DiffGraph, DiffNode, NodeKind } from '@compass/core';

export type Level = 'architecture' | 'package' | 'module' | 'code';
export const LEVELS: Level[] = ['architecture', 'package', 'module', 'code'];
export const LEVEL_LABEL: Record<Level, string> = { architecture: 'Architecture', package: 'Package', module: 'Module', code: 'Code' };

/** Qué tipos de nodo se expanden (muestran sus hijos) en cada nivel de zoom semántico. */
const EXPAND: Record<Level, Set<NodeKind>> = {
  architecture: new Set(['repo', 'directory']),
  package: new Set(['repo', 'directory', 'file']),
  module: new Set(['repo', 'directory', 'file', 'class', 'interface', 'enum']),
  code: new Set(['repo', 'directory', 'file', 'class', 'interface', 'enum']),
};

const MAX_LEAVES = 36;

export interface ViewNode {
  id: string;
  node?: DiffNode;
  /** Nombre a mostrar cuando se compacta una cadena de carpetas (java/src/main/…). */
  label?: string;
  /** Nodo sintético "+N más" (quiet = agrupa archivos sin cambios ni relación con los cambios). */
  more?: { count: number; parent: string; quiet?: boolean };
  children: ViewNode[];
  expanded: boolean;
  /** Se dibuja con su código (nivel Code). */
  code: boolean;
}

export interface ViewEdge {
  id: string;
  source: string;
  target: string;
  changed: boolean;
  weight: number;
  kinds: Set<DiffEdge['kind']>;
  /** Aristas originales que agrupa. */
  members: DiffEdge[];
}

export interface Index {
  byId: Map<string, DiffNode>;
  children: Map<string, DiffNode[]>;
  depth: (id: string) => number;
  isAncestor: (anc: string, id: string) => boolean;
  ancestors: (id: string) => DiffNode[];
}

export function buildIndex(g: DiffGraph): Index {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const children = new Map<string, DiffNode[]>();
  for (const n of g.nodes) {
    if (!n.parentId) continue;
    if (!children.has(n.parentId)) children.set(n.parentId, []);
    children.get(n.parentId)!.push(n);
  }
  const order: Record<string, number> = { directory: 0, file: 1, class: 2, interface: 3, enum: 4, type: 5, function: 6, method: 7, property: 8 };
  for (const list of children.values())
    list.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || (a.range?.start ?? 0) - (b.range?.start ?? 0) || a.name.localeCompare(b.name));
  const depthCache = new Map<string, number>();
  const depth = (id: string): number => {
    if (depthCache.has(id)) return depthCache.get(id)!;
    const p = byId.get(id)?.parentId;
    const d = p ? depth(p) + 1 : 0;
    depthCache.set(id, d);
    return d;
  };
  const isAncestor = (anc: string, id: string) => {
    let cur = byId.get(id)?.parentId;
    while (cur) {
      if (cur === anc) return true;
      cur = byId.get(cur)?.parentId ?? null;
    }
    return false;
  };
  const ancestors = (id: string) => {
    const out: DiffNode[] = [];
    let cur = byId.get(id)?.parentId;
    while (cur) {
      const n = byId.get(cur);
      if (!n) break;
      out.unshift(n);
      cur = n.parentId;
    }
    return out;
  };
  return { byId, children, depth, isAncestor, ancestors };
}

export interface ViewOptions {
  scope: string;
  level: Level;
  /** Ocultar lo que no cambió (solo diff/pr). */
  exact: boolean;
}

export interface View {
  root: ViewNode;
  visible: Map<string, ViewNode>;
  edges: ViewEdge[];
  /** id original → id visible (o undefined si quedó oculto). */
  resolve: (id: string) => string | undefined;
  count: number;
}

export function buildView(g: DiffGraph, idx: Index, opts: ViewOptions): View {
  const isDiff = g.meta.mode !== 'map';
  const exact = isDiff && opts.exact;
  const visible = new Map<string, ViewNode>();
  const filtered = new Set<string>();
  const overflowTo = new Map<string, string>();
  const expandKinds = EXPAND[opts.level];
  const scopeDepth = idx.depth(opts.scope);

  // With Context: lo cambiado + sus vecinos directos (extremos de aristas cambiadas) y sus ancestros.
  const neighbors = new Set<string>();
  if (isDiff && !exact) {
    for (const e of g.edges) {
      if (!e.changed) continue;
      for (const end of [e.source, e.target]) {
        neighbors.add(end);
        for (const a of idx.ancestors(end)) neighbors.add(a.id);
      }
    }
  }
  // Sin cambios y sin relación con los cambios. Dentro de archivos solo se agrupa si el archivo no es el foco
  // (en Module/Code del archivo aislado se ven todos sus miembros, atenuados, como en la referencia).
  const isQuiet = (parent: DiffNode, k: DiffNode, parentIsScope: boolean) =>
    isDiff &&
    !exact &&
    k.status === 'unchanged' &&
    !neighbors.has(k.id) &&
    (parent.kind === 'directory' || parent.kind === 'repo' || (parent.kind === 'file' && !parentIsScope));

  const visibleKids = (n: DiffNode) =>
    (idx.children.get(n.id) ?? []).filter((k) => {
      if (exact && k.status === 'unchanged') {
        filtered.add(k.id);
        return false;
      }
      return true;
    });

  const make = (n0: DiffNode, isScope: boolean): ViewNode => {
    let n = n0;
    let kids = visibleKids(n);
    let label: string | undefined;
    // Compactar cadenas de carpetas con un solo hijo carpeta: java/src/main/java/com/acme
    if (!isScope && n.kind === 'directory' && expandKinds.has('directory')) {
      const parts = [n.name];
      while (kids.length === 1 && kids[0].kind === 'directory') {
        n = kids[0];
        parts.push(n.name);
        kids = visibleKids(n);
      }
      if (parts.length > 1) label = parts.join('/');
    }
    const deep = n.kind === 'directory' && opts.level === 'architecture' && idx.depth(n.id) - scopeDepth > 6;
    const expanded = kids.length > 0 && (isScope || (expandKinds.has(n.kind) && !deep));
    const v: ViewNode = { id: n.id, node: n, label, children: [], expanded, code: false };
    visible.set(n.id, v);
    if (!expanded) {
      v.code = opts.level === 'code' && !!n.range && n.kind !== 'property' && n.kind !== 'file';
      return v;
    }
    // archivos/carpetas sin cambios y sin relación con los cambios → un chip "+N sin cambios"
    const quiet = kids.filter((k) => isQuiet(n, k, isScope));
    if (quiet.length) kids = kids.filter((k) => !quiet.includes(k));
    // contenedores primero; hojas limitadas con un chip "+N"
    const containers = kids.filter((k) => (idx.children.get(k.id)?.length ?? 0) > 0 && expandKinds.has(k.kind));
    const leaves = kids.filter((k) => !containers.includes(k));
    leaves.sort((a, b) => rank(b) - rank(a));
    const shown = opts.level === 'code' ? leaves : leaves.slice(0, MAX_LEAVES);
    const hidden = leaves.slice(shown.length);
    // conservar el orden natural entre los que sí se muestran
    const shownSet = new Set(shown);
    for (const k of kids) {
      if (containers.includes(k) || shownSet.has(k)) v.children.push(make(k, false));
    }
    if (hidden.length) {
      const moreId = `${n.id}::more`;
      const mv: ViewNode = { id: moreId, more: { count: hidden.length, parent: n.id }, children: [], expanded: false, code: false };
      v.children.push(mv);
      visible.set(moreId, mv);
      for (const h of hidden) overflowTo.set(h.id, moreId);
    }
    if (quiet.length) {
      const qId = `${n.id}::quiet`;
      const qv: ViewNode = { id: qId, more: { count: quiet.length, parent: n.id, quiet: true }, children: [], expanded: false, code: false };
      v.children.push(qv);
      visible.set(qId, qv);
      for (const h of quiet) filtered.add(h.id);
    }
    return v;
  };

  const scopeNode = idx.byId.get(opts.scope) ?? g.nodes.find((n) => n.kind === 'repo')!;
  const root = make(scopeNode, true);

  const resolveCache = new Map<string, string | undefined>();
  const resolve = (id: string): string | undefined => {
    if (resolveCache.has(id)) return resolveCache.get(id);
    let cur: string | null | undefined = id;
    let out: string | undefined;
    while (cur) {
      if (visible.has(cur)) {
        out = cur;
        break;
      }
      if (filtered.has(cur)) break;
      const more = overflowTo.get(cur);
      if (more) {
        out = more;
        break;
      }
      if (cur === scopeNode.id) break;
      cur = idx.byId.get(cur)?.parentId;
    }
    const base = out?.replace(/::(more|quiet)$/, '');
    if (out && base && !(base === scopeNode.id || idx.isAncestor(scopeNode.id, base))) out = undefined;
    resolveCache.set(id, out);
    return out;
  };

  const parentOf = (vid: string) => (/::(more|quiet)$/.test(vid) ? vid.replace(/::(more|quiet)$/, '') : idx.byId.get(vid)?.parentId);
  const related = (a: string, b: string) => {
    let cur = parentOf(b);
    while (cur) {
      if (cur === a) return true;
      cur = idx.byId.get(cur)?.parentId;
    }
    cur = parentOf(a);
    while (cur) {
      if (cur === b) return true;
      cur = idx.byId.get(cur)?.parentId;
    }
    return false;
  };

  const edgeMap = new Map<string, ViewEdge>();
  for (const e of g.edges) {
    const s = resolve(e.source);
    const t = resolve(e.target);
    if (!s || !t || s === t || related(s, t)) continue;
    // en diff, las aristas hacia chips agrupados solo meten ruido
    if (isDiff && (s.includes('::') || t.includes('::'))) continue;
    const id = `${s}=>${t}`;
    const ve = edgeMap.get(id);
    if (ve) {
      ve.weight += e.weight;
      ve.changed ||= e.changed;
      ve.kinds.add(e.kind);
      ve.members.push(e);
    } else edgeMap.set(id, { id, source: s, target: t, changed: e.changed, weight: e.weight, kinds: new Set([e.kind]), members: [e] });
  }

  return { root, visible, edges: [...edgeMap.values()], resolve, count: visible.size };
}

function rank(n: DiffNode): number {
  const st = n.status === 'unchanged' ? 0 : 1000;
  return st + n.stats.deps * 2 + n.stats.added + n.stats.removed;
}

/** Nivel sugerido al hacer "Explore" sobre un nodo. */
export function exploreLevel(n: DiffNode): Level {
  if (n.kind === 'repo' || n.kind === 'directory') return 'package';
  if (n.kind === 'file' || n.kind === 'class' || n.kind === 'interface' || n.kind === 'enum') return 'module';
  return 'code';
}

/** Scope y nivel para enfocar un nodo concreto desde el panel de insights. */
export function focusTarget(idx: Index, id: string): { scope: string; level: Level } {
  const n = idx.byId.get(id);
  if (!n) return { scope: '.', level: 'architecture' };
  if (n.kind === 'repo') return { scope: n.id, level: 'architecture' };
  if (n.kind === 'directory') return { scope: n.id, level: 'package' };
  if (n.kind === 'file') return { scope: n.parentId ?? '.', level: 'package' };
  // símbolo: scope = su archivo
  return { scope: n.path, level: n.kind === 'class' || n.kind === 'interface' ? 'module' : 'code' };
}
