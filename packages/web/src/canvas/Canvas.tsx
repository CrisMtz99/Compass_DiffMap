import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, MarkerType, MiniMap, ReactFlow, useReactFlow, useStore, type Edge, type Node } from '@xyflow/react';
import type { View } from '../model/view';
import { layoutView, type Box } from '../model/layout';
import { useCanvas } from './context';
import { nodeTypes, type NodeData } from './nodes';

export type EdgeMode = 'changed' | 'all' | 'hover';

interface Props {
  view: View;
  /** Nodo a centrar cuando termine el layout (desde insights, Explore…). */
  focusId: string | null;
  /** Si todo no cabe legible, a dónde mirar primero (p. ej. el hotspot principal). */
  anchorId: string | null;
  edgeMode: EdgeMode;
  onLayout?: (ms: number) => void;
}

/** Zoom mínimo al que el texto de las fichas todavía se lee. */
const READABLE_ZOOM = 0.75;

const EDGE = 'var(--edge)';
const EDGE_CHANGED = 'var(--edge-changed)';
const EDGE_HI = 'var(--edge-hi)';

export function Canvas({ view: nextView, focusId, anchorId, edgeMode, onLayout }: Props) {
  const c = useCanvas();
  const rf = useReactFlow();
  // La vista y sus cajas viajan juntas: nunca se dibuja una vista nueva con cajas viejas.
  const [laid, setLaid] = useState<{ view: View; boxes: Map<string, Box> } | null>(null);
  const view = laid?.view ?? nextView;
  const boxes = laid?.boxes ?? null;
  const [busy, setBusy] = useState(false);
  const runId = useRef(0);
  const zoom = useStore((s) => s.transform[2]);
  // Nivel de detalle: de lejos solo cajas y nombres de contenedores; de cerca todo.
  const lod = zoom < 0.5 ? 'lod-far' : zoom < READABLE_ZOOM ? 'lod-mid' : 'lod-near';

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
    const walk = (v: View['root'], depth: number) => {
      const b = boxes.get(v.id);
      if (b) {
        const container = v.expanded && v.children.length > 0;
        out.push({
          id: v.id,
          type: container ? 'container' : 'leaf',
          position: { x: b.x, y: b.y },
          parentId: b.parent,
          data: { v, depth } satisfies NodeData,
          width: b.width,
          height: b.height,
          style: { width: b.width, height: b.height },
          draggable: false,
          selectable: false,
          // las hojas (opacas) quedan sobre las aristas: una arista nunca tacha una ficha
          zIndex: container ? 0 : 3,
        });
      }
      for (const k of v.children) walk(k, depth + 1);
    };
    walk(view.root, 0);
    return out;
  }, [boxes, view]);

  // Aristas del nodo bajo el mouse (incluye su subárbol).
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
      .filter((e) => {
        const hi = hoverSet?.has(e.id) || c.trace?.edges.has(e.id);
        if (hi) return true;
        if (c.trace) return false; // con un trace activo, solo sus aristas
        if (edgeMode === 'all') return true;
        if (edgeMode === 'changed') return isMap ? false : e.changed;
        return false;
      })
      .map((e) => {
        const hi = !!(hoverSet?.has(e.id) || c.trace?.edges.has(e.id));
        const color = hi ? EDGE_HI : e.changed && !isMap ? EDGE_CHANGED : EDGE;
        const w = Math.min(1 + Math.log2(e.weight) * 0.5, 2.5) * (hi ? 1.5 : 1);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'default',
          zIndex: hi ? 4 : 1,
          animated: false,
          style: { stroke: color, strokeWidth: w, opacity: hi ? 0.95 : hoverSet ? 0.1 : 0.4 },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
          label: hi && e.weight > 1 ? String(e.weight) : undefined,
          labelStyle: { fill: 'var(--text)', fontSize: 10, fontFamily: 'var(--mono)' },
          labelBgStyle: { fill: 'var(--bg)' },
          labelBgPadding: [3, 1] as [number, number],
          interactionWidth: 0,
          focusable: false,
        };
      });
  }, [boxes, view.edges, hoverSet, c.trace, c.graph.meta.mode, edgeMode]);

  // Cámara tras cada layout: encuadra el foco; si todo no cabe legible, muestra el ancla a escala legible.
  const pendingFit = useRef(false);
  useEffect(() => {
    if (boxes) pendingFit.current = true;
  }, [boxes]);
  useEffect(() => {
    if (!boxes || !pendingFit.current) return;
    pendingFit.current = false;
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
    const t = window.setTimeout(() => {
      const el = document.querySelector('.canvas') as HTMLElement | null;
      const vw = el?.clientWidth ?? 1200;
      const vh = el?.clientHeight ?? 800;
      const fit = (r: { x: number; y: number; width: number; height: number }, pad: number, maxZoom = 1.15) => {
        const z = Math.min(maxZoom, (vw * (1 - pad)) / r.width, (vh * (1 - pad)) / r.height);
        rf.setViewport({ x: vw / 2 - (r.x + r.width / 2) * z, y: vh / 2 - (r.y + r.height / 2) * z, zoom: z }, { duration: 350 });
        return z;
      };
      const focus = focusId && boxes.has(focusId) && focusId !== view.root.id ? abs(focusId) : undefined;
      if (focus) {
        fit(focus, 0.25, 1.1);
        return;
      }
      const all = abs(view.root.id)!;
      const zAll = Math.min(1.1, (vw * 0.94) / all.width, (vh * 0.94) / all.height);
      if (zAll >= READABLE_ZOOM) {
        fit(all, 0.06, 1.1);
        return;
      }
      const anchor = anchorId && boxes.has(anchorId) ? abs(anchorId) : undefined;
      if (anchor) {
        // el ancla a escala legible (si es enorme, su esquina superior izquierda)
        const z = Math.max(READABLE_ZOOM, Math.min(1, (vw * 0.8) / anchor.width, (vh * 0.8) / anchor.height));
        const fitsW = anchor.width * z <= vw * 0.9;
        const fitsH = anchor.height * z <= vh * 0.9;
        const x = fitsW ? vw / 2 - (anchor.x + anchor.width / 2) * z : 24 - anchor.x * z;
        const y = fitsH ? vh / 2 - (anchor.y + anchor.height / 2) * z : 24 - anchor.y * z;
        rf.setViewport({ x, y, zoom: z }, { duration: 350 });
        return;
      }
      // sin ancla: arriba a la izquierda, a escala legible
      rf.setViewport({ x: 24 - all.x * READABLE_ZOOM, y: 24 - all.y * READABLE_ZOOM, zoom: READABLE_ZOOM }, { duration: 350 });
    }, 60);
    return () => window.clearTimeout(t);
  }, [boxes, focusId, anchorId, rf, view.root.id]);

  return (
    <div className={`canvas ${lod}`} style={{ ['--z' as string]: zoom }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        minZoom={0.03}
        maxZoom={2.5}
        nodesConnectable={false}
        nodesDraggable={false}
        zoomOnDoubleClick={false}
        elementsSelectable={false}
        onlyRenderVisibleElements={nodes.length > 400}
        proOptions={{ hideAttribution: true }}
        onPaneClick={() => c.setHover(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--grid)" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => (n.type === 'container' ? 'transparent' : statusColor((n.data as NodeData).v.node?.status))}
          nodeStrokeColor={(n) => (n.type === 'container' ? 'rgba(139,148,158,0.35)' : 'transparent')}
          nodeStrokeWidth={4}
          maskColor="var(--minimap-mask)"
          style={{ background: 'var(--panel)', width: 180, height: 120 }}
        />
      </ReactFlow>
      {busy && <div className="layout-busy">acomodando {nextView.count} nodos…</div>}
    </div>
  );
}

function statusColor(s?: string) {
  return s === 'added' ? '#3fb950' : s === 'modified' ? '#d29922' : s === 'deleted' ? '#f85149' : '#3a414b';
}
