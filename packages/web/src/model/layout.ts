import ELK from 'elkjs/lib/elk.bundled.js';
import type { Index, View, ViewNode } from './view';

const elk = new ELK();

export const CODE_MAX_LINES = 40;
export const CODE_LINE_H = 17;
export const HEADER_H = 34;

export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parent?: string;
}

interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: ElkNode[];
  edges?: { id: string; sources: string[]; targets: string[] }[];
  layoutOptions?: Record<string, string>;
}

const textW = (s: string, px = 7.2) => s.length * px;

export function leafSize(v: ViewNode): { width: number; height: number } {
  if (v.more) return { width: v.more.quiet ? 132 : 92, height: 28 };
  const n = v.node!;
  if (v.code && n.range) {
    const lines = Math.min(n.range.end - n.range.start + 1, CODE_MAX_LINES);
    return { width: 560, height: 46 + lines * CODE_LINE_H + 12 };
  }
  const isSymbol = !['repo', 'directory', 'file'].includes(n.kind);
  if (isSymbol && (n.kind === 'method' || n.kind === 'function' || n.kind === 'class' || n.kind === 'interface' || n.kind === 'enum' || n.kind === 'type')) {
    return { width: Math.min(320, Math.max(150, textW(n.name, 8) + 60)), height: 44 };
  }
  return { width: Math.min(280, Math.max(96, textW(n.name, 7.8) + 52)), height: 28 };
}

/** Layout jerárquico: cada contenedor se acomoda por separado (layered si tiene aristas internas, rectpacking si no). */
export async function layoutView(view: View, idx: Index): Promise<Map<string, Box>> {
  // Proyectar las aristas al nivel de hermanos dentro de su contenedor común.
  const parentOf = (vid: string): string | undefined => {
    if (/::(more|quiet)$/.test(vid)) return vid.replace(/::(more|quiet)$/, '');
    return idx.byId.get(vid)?.parentId ?? undefined;
  };
  // Solo ancestros visibles (las carpetas compactadas no existen en el layout).
  const chainTo = (vid: string): string[] => {
    const out = [vid];
    let cur = parentOf(vid);
    while (cur) {
      if (view.visible.has(cur)) out.push(cur);
      if (cur === view.root.id) break;
      cur = parentOf(cur);
    }
    return out;
  };
  const sibEdges = new Map<string, Map<string, { s: string; t: string }>>();
  for (const e of view.edges) {
    const a = chainTo(e.source);
    const b = chainTo(e.target);
    const bset = new Set(b);
    let lcaIdx = a.findIndex((x) => bset.has(x));
    if (lcaIdx <= 0) continue;
    const lca = a[lcaIdx];
    const ca = a[lcaIdx - 1];
    const cb = b[b.indexOf(lca) - 1];
    if (!ca || !cb || ca === cb) continue;
    if (!sibEdges.has(lca)) sibEdges.set(lca, new Map());
    sibEdges.get(lca)!.set(`${ca}>${cb}`, { s: ca, t: cb });
  }

  const toElk = (v: ViewNode): ElkNode => {
    if (!v.expanded || !v.children.length) return { id: v.id, ...leafSize(v) };
    const n = v.node!;
    const statsW = 150;
    const minW = Math.max(160, textW(v.label ?? n.name, 8.4) + statsW);
    const internal = sibEdges.get(v.id);
    const hasEdges = !!internal && internal.size > 0;
    const layoutOptions: Record<string, string> = hasEdges
      ? {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          'elk.layered.spacing.nodeNodeBetweenLayers': '44',
          'elk.spacing.nodeNode': '14',
          'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
          'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        }
      : { 'elk.algorithm': 'rectpacking', 'elk.aspectRatio': '1.8', 'elk.spacing.nodeNode': '12', 'elk.rectpacking.widthApproximation.optimizationGoal': 'ASPECT_RATIO_DRIVEN' };
    layoutOptions['elk.padding'] = `[top=${HEADER_H + 8},left=12,bottom=12,right=12]`;
    layoutOptions['elk.nodeSize.constraints'] = 'MINIMUM_SIZE';
    layoutOptions['elk.nodeSize.minimum'] = `(${minW}, 60)`;
    return {
      id: v.id,
      layoutOptions,
      children: v.children.map(toElk),
      edges: hasEdges ? [...internal!.values()].map((e, i) => ({ id: `${v.id}#e${i}`, sources: [e.s], targets: [e.t] })) : [],
    };
  };

  const graph: ElkNode = {
    id: '__root__',
    layoutOptions: { 'elk.algorithm': 'rectpacking', 'elk.padding': '[top=0,left=0,bottom=0,right=0]' },
    children: [toElk(view.root)],
  };
  const res = (await elk.layout(graph as never)) as ElkNode;

  const boxes = new Map<string, Box>();
  const walk = (n: ElkNode, parent?: string) => {
    for (const c of n.children ?? []) {
      boxes.set(c.id, { id: c.id, x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 100, height: c.height ?? 40, parent: parent === '__root__' ? undefined : parent });
      walk(c, c.id);
    }
  };
  walk(res, '__root__');
  return boxes;
}
