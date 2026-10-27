import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, MarkerType, MiniMap, ReactFlow, useReactFlow, type Edge, type Node } from '@xyflow/react';
import type { View } from '../model/view';
import { layoutView, type Box } from '../model/layout';
import { useCanvas } from './context';
import { nodeTypes, type NodeData } from './nodes';

interface Props {
  view: View;
  /** Nodo a centrar cuando termine el layout. */
  focusId: string | null;
  onLayout?: (ms: number) => void;
}

const EDGE = 'var(--edge)';
const EDGE_CHANGED = 'var(--edge-changed)';
const EDGE_HI = 'var(--edge-hi)';

export function Canvas({ view: nextView, focusId, onLayout }: Props) {
  const c = useCanvas();
  const rf = useReactFlow();
  // La vista y sus cajas viajan juntas: nunca se dibuja una vista nueva con cajas viejas.
  const [laid, setLaid] = useState<{ view: View; boxes: Map<string, Box> } | null>(null);
  const view = laid?.view ?? nextView;
  const boxes = laid?.boxes ?? null;
  const [busy, setBusy] = useState(false);
  const runId = useRef(0);

  useEffect(() => {
    const my = ++runId.current;
    setBusy(true);
    const t0 = performance.now();
    layoutView(nextView, c.idx)
      .then((b) => {
        if (my !== runId.current) return;
        setLaid({ view: nextView, boxes: b });
        onLayout?.(Math.round(performance.now() - t0));
      })
      .catch((e) => console.error('layout', e))
      .finally(() => my === runId.current && setBusy(false));
  }, [nextView, c.idx, onLayout]);

  const nodes: Node[] = useMemo(() => {
    if (!boxes) return [];
    const out: Node[] = [];
    // padres antes que hijos (orden del árbol)
    const walk = (v: View['root']) => {
      const b = boxes.get(v.id);
      if (b) {
        const container = v.expanded && v.children.length > 0;
        out.push({
          id: v.id,
          type: container ? 'container' : 'leaf',
          position: { x: b.x, y: b.y },
          parentId: b.parent,
          data: { v } satisfies NodeData,
          width: b.width,
          height: b.height,
          style: { width: b.width, height: b.height },
          draggable: false,
          selectable: false,
          zIndex: container ? 0 : 1,
        });
      }
      for (const k of v.children) walk(k);
    };
    walk(view.root);
    return out;
  }, [boxes, view]);

  // Aristas: resaltar las del nodo bajo el mouse (incluye su subárbol) o las del trace activo.
  const hoverSet = useMemo(() => {
    if (!c.hover) return null;
    const s = new Set<string>();
    for (const e of view.edges) {
      if (e.source === c.hover || e.target === c.hover || c.idx.isAncestor(c.hover, e.source) || c.idx.isAncestor(c.hover, e.target)) s.add(e.id);
    }
    return s;
  }, [c.hover, view.edges, c.idx]);

  const edges: Edge[] = useMemo(() => {
    if (!boxes) return [];
    const isMap = c.graph.meta.mode === 'map';
    return view.edges
      .filter((e) => boxes.has(e.source) && boxes.has(e.target))
      .map((e) => {
        const hi = hoverSet?.has(e.id) || c.trace?.edges.has(e.id);
        const dim = (c.trace && !c.trace.edges.has(e.id)) || (hoverSet && !hoverSet.has(e.id));
        const color = hi ? EDGE_HI : e.changed && !isMap ? EDGE_CHANGED : EDGE;
        const w = Math.min(1 + Math.log2(e.weight), 3.5) * (hi ? 1.4 : 1);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'default',
          zIndex: hi ? 5 : 2,
          style: { stroke: color, strokeWidth: w, opacity: dim ? 0.12 : hi ? 1 : e.changed || isMap ? 0.7 : 0.35 },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
          label: hi && e.weight > 1 ? String(e.weight) : undefined,
          labelStyle: { fill: 'var(--text)', fontSize: 10 },
          labelBgStyle: { fill: 'var(--panel)' },
          interactionWidth: 0,
          focusable: false,
        };
      });
  }, [boxes, view.edges, hoverSet, c.trace, c.graph.meta.mode]);

  // Centrar tras cada layout, cuando React Flow ya midió los nodos.
  const pendingFit = useRef(false);
  useEffect(() => {
    if (boxes) pendingFit.current = true;
  }, [boxes]);
  useEffect(() => {
    // Con tamaños explícitos (width/height) fitView no necesita esperar a que se midan todos los nodos.
    if (!boxes || !pendingFit.current) return;
    pendingFit.current = false;
    // Límites calculados del layout (no de los nodos medidos): funciona aunque haya render parcial.
    const abs = (id: string) => {
      let b = boxes.get(id);
      if (!b) return undefined;
      let x = b.x;
      let y = b.y;
      const { width, height } = b;
      while (b?.parent) {
        b = boxes.get(b.parent);
        if (!b) break;
        x += b.x;
        y += b.y;
      }
      return { x, y, width, height };
    };
    const id = window.setTimeout(() => {
      const target = focusId && boxes.has(focusId) && focusId !== view.root.id ? focusId : view.root.id;
      const r = abs(target);
      if (!r) return;
      const vw = (document.querySelector('.canvas') as HTMLElement | null)?.clientWidth ?? 1200;
      // con la vista completa, no acercar más de lo necesario
      const pad = target === view.root.id ? 0.04 : 0.35;
      rf.fitBounds(r, { padding: pad, duration: 350 }).then(() => {
        const z = rf.getZoom();
        if (z > 1.2) rf.setViewport({ ...rf.getViewport(), zoom: 1.2 });
      });
      void vw;
    }, 60);
    return () => window.clearTimeout(id);
  }, [boxes, focusId, rf, view.root.id]);

  return (
    <div className="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        minZoom={0.02}
        maxZoom={3}
        nodesConnectable={false}
        nodesDraggable={false}
        zoomOnDoubleClick={false}
        elementsSelectable={false}
        onlyRenderVisibleElements={nodes.length > 400}
        proOptions={{ hideAttribution: true }}
        onPaneClick={() => c.setHover(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--grid)" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => (n.type === 'container' ? 'transparent' : statusColor((n.data as NodeData).v.node?.status))}
          nodeStrokeColor={(n) => (n.type === 'container' ? statusColor((n.data as NodeData).v.node?.status) : 'transparent')}
          nodeStrokeWidth={6}
          maskColor="var(--minimap-mask)"
          style={{ background: 'var(--panel)' }}
        />
      </ReactFlow>
      {busy && <div className="layout-busy">acomodando {nextView.count} nodos…</div>}
    </div>
  );
}

function statusColor(s?: string) {
  return s === 'added' ? '#3fb950' : s === 'modified' ? '#d29922' : s === 'deleted' ? '#f85149' : '#3a414b';
}
