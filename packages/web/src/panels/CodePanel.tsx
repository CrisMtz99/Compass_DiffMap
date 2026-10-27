import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiffNode } from '@compass/core';
import { useCanvas } from '../canvas/context';
import { Icon, KindIcon } from '../canvas/icons';
import { CodeLines, DiffHunks, useSymbolLines } from '../canvas/nodes';

const DEFAULT_W = 480;
const MIN_W = 380;
/** El mapa nunca queda con menos del 30% de la ventana. */
const maxW = () => Math.max(MIN_W, Math.round(window.innerWidth * 0.7));
const clampW = (w: number) => Math.min(maxW(), Math.max(MIN_W, Math.round(w)));

// Preferencias por navegador (pueden no estar disponibles: modo privado, export abierto como archivo…)
const load = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const save = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sin almacenamiento: solo dura la sesión */
  }
};

/** Ancho del panel arrastrando su borde izquierdo; doble clic = ancho por defecto. */
function usePanelWidth() {
  const [width, setWidth] = useState(() => clampW(Number(load('compass.codepanel.width')) || DEFAULT_W));
  const dragging = useRef(false);
  useEffect(() => save('compass.codepanel.width', String(width)), [width]);
  useEffect(() => {
    const onResize = () => setWidth((w) => clampW(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging.current) setWidth(clampW(window.innerWidth - e.clientX));
  }, []);
  const onPointerUp = useCallback(() => {
    dragging.current = false;
    document.body.classList.remove('resizing');
  }, []);
  return { width, setWidth, handle: { onPointerDown, onPointerMove, onPointerUp, onDoubleClick: () => setWidth(clampW(DEFAULT_W)) } };
}

export function CodePanel({ node, onClose, onFocus }: { node: DiffNode; onClose: () => void; onFocus: (id: string) => void }) {
  const { graph, idx } = useCanvas();
  const [tab, setTab] = useState<'code' | 'diff'>('code');
  const [wrap, setWrapRaw] = useState(() => load('compass.codepanel.wrap') !== '0');
  const setWrap = (w: boolean) => {
    setWrapRaw(w);
    save('compass.codepanel.wrap', w ? '1' : '0');
  };
  const { width, setWidth, handle } = usePanelWidth();
  const isMax = width >= maxW() - 4;
  const fileLen = graph.nodes.find((n) => n.id === node.path)?.stats.lines ?? 0;
  const asSymbol: DiffNode = node.range ? node : { ...node, range: { start: 1, end: Math.max(1, fileLen) } };
  const lines = useSymbolLines(asSymbol, 600);
  const fd = graph.files[node.path];
  const hunks = useMemo(() => {
    if (!fd) return [];
    if (!node.range || node.kind === 'file') return fd.hunks;
    return fd.hunks.filter((h) => h.newStart <= node.range!.end && h.newStart + Math.max(h.newLines, 1) - 1 >= node.range!.start);
  }, [fd, node]);
  const callers = graph.edges.filter((e) => e.target === node.id).map((e) => e.source);
  const callees = graph.edges.filter((e) => e.source === node.id).map((e) => e.target);
  const summary = graph.insights.summaries?.[node.id];

  return (
    <aside className="codepanel" style={{ width }}>
      <div className="cp-resize" {...handle} title="Arrastra para cambiar el ancho · doble clic para restablecer" />
      <div className="cp-head">
        <span className={`dot s-${node.status}`} />
        <KindIcon kind={node.kind} />
        <b>{node.name}</b>
        <span className="kind">{node.kind}</span>
        <button className="ib cp-max" onClick={() => setWidth(isMax ? DEFAULT_W : maxW())} title={isMax ? 'Restablecer ancho' : 'Ampliar panel'}>
          {isMax ? Icon.collapse : Icon.expand}
        </button>
        <button className="ib" onClick={onClose} title="Cerrar">
          {Icon.close}
        </button>
      </div>
      <div className="cp-path">
        {node.path}
        {node.range ? `:${node.range.start}-${node.range.end}` : ''}
      </div>
      {node.signature && node.kind !== 'file' && <code className="cp-sig">{node.signature}</code>}
      {summary && <p className="ai-summary">{summary}</p>}
      <div className="cp-rel">
        {callers.length > 0 && (
          <div>
            <h4>Lo llaman ({callers.length})</h4>
            {callers.slice(0, 12).map((id) => (
              <button key={id} className="mini-ref" onClick={() => onFocus(id)}>
                {label(idx.byId.get(id))}
              </button>
            ))}
          </div>
        )}
        {callees.length > 0 && (
          <div>
            <h4>Llama a ({callees.length})</h4>
            {callees.slice(0, 12).map((id) => (
              <button key={id} className="mini-ref" onClick={() => onFocus(id)}>
                {label(idx.byId.get(id))}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="cp-tools">
        {fd && (
          <div className="seg small">
            <button className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')}>
              Código
            </button>
            <button className={tab === 'diff' ? 'on' : ''} onClick={() => setTab('diff')}>
              Diff ({hunks.length} hunks)
            </button>
          </div>
        )}
        <label className="check cp-wrap" title="Partir las líneas largas para que quepan en el panel">
          <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} /> Ajustar líneas
        </label>
      </div>
      <div className="cp-code">
        {tab === 'code' || !fd ? (
          <CodeLines lines={lines} language={node.language} total={asSymbol.range!.end - asSymbol.range!.start + 1} wrap={wrap} />
        ) : (
          <DiffHunks hunks={hunks} language={node.language} wrap={wrap} />
        )}
      </div>
    </aside>
  );
}

const label = (n?: DiffNode) => (n ? (n.kind === 'file' ? n.path : `${n.path.split('/').pop()} › ${n.id.split('#')[1] ?? n.name}`) : '?');
