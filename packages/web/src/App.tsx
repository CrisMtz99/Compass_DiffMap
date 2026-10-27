import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { DiffGraph } from '@compass/core';
import { clearSourceCache, fetchGraph, fetchStatus, isStatic, type GraphWithErrors } from './api';
import { Canvas } from './canvas/Canvas';
import { Ctx, type CanvasCtx, type Trace } from './canvas/context';
import { Icon } from './canvas/icons';
import { buildIndex, buildView, exploreLevel, focusTarget, LEVEL_LABEL, LEVELS, type Level } from './model/view';
import { CodePanel } from './panels/CodePanel';
import { Sidebar, type SideTab } from './panels/Sidebar';

interface Place {
  scope: string;
  level: Level;
  focus: string | null;
}

export function App() {
  const [graph, setGraph] = useState<GraphWithErrors | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [mtime, setMtime] = useState(0);

  const load = useCallback(async () => {
    try {
      const g = await fetchGraph();
      clearSourceCache();
      setGraph(g);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setGraph(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Recargar cuando el CLI o la skill reescriben graph.json / insights.json.
  useEffect(() => {
    if (isStatic()) return;
    const t = setInterval(async () => {
      const s = await fetchStatus();
      if (!s) return;
      const m = Math.max(s.graphMtime, s.insightsMtime);
      if (mtime && m !== mtime) load();
      setMtime(m);
    }, 2500);
    return () => clearInterval(t);
  }, [mtime, load]);

  if (graph === undefined) return <div className="splash">Cargando Compass…</div>;
  return <Workspace key={graph ? `${graph.meta.generatedAt}` : 'empty'} graph={graph} error={error} reload={load} />;
}

function Workspace({ graph, error, reload }: { graph: GraphWithErrors | null; error: string | null; reload: () => void }) {
  const [tab, setTab] = useState<SideTab | null>(graph ? 'insights' : 'analyze');
  if (!graph) {
    return (
      <div className="app no-graph">
        <Sidebar graph={null} tab={tab ?? 'analyze'} setTab={setTab} onFocus={() => {}} onAnalyzed={reload} />
        <div className="empty">
          <div className="empty-card">
            <div className="empty-logo">{Icon.compass}</div>
            <h1>Compass</h1>
            <p>Este repositorio todavía no tiene análisis. Empieza con el <b>mapa del repo</b> para documentar y verificar su estructura, o con un <b>diff</b> para revisar cambios.</p>
            {error && <p className="err">{error}</p>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <Loaded graph={graph} tab={tab} setTab={setTab} reload={reload} />
    </ReactFlowProvider>
  );
}

function Loaded({ graph, tab, setTab, reload }: { graph: GraphWithErrors; tab: SideTab | null; setTab: (t: SideTab | null) => void; reload: () => void }) {
  const idx = useMemo(() => buildIndex(graph), [graph]);
  const isDiff = graph.meta.mode !== 'map';
  const root = graph.nodes.find((n) => n.kind === 'repo')!.id;

  const [history, setHistory] = useState<Place[]>([{ scope: root, level: 'architecture', focus: null }]);
  const [pos, setPos] = useState(0);
  const place = history[pos];
  const [exact, setExact] = useState(false);
  const [hover, setHoverRaw] = useState<string | null>(null);
  const [traceReq, setTraceReq] = useState<{ nodeId: string; dir: 'callers' | 'deps' } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [layoutMs, setLayoutMs] = useState<number | null>(null);

  const go = useCallback(
    (p: Partial<Place>) => {
      setHistory((h) => {
        const cur = h[pos];
        const next = { ...cur, focus: null, ...p };
        if (next.scope === cur.scope && next.level === cur.level && next.focus === cur.focus) return h;
        const nh = [...h.slice(0, pos + 1), next];
        setPos(nh.length - 1);
        return nh;
      });
      setTraceReq(null);
    },
    [pos],
  );

  // hover con pequeño retardo de salida para poder entrar a la tarjeta
  const [hoverTimer, setHoverTimer] = useState<number | null>(null);
  const setHover = useCallback(
    (id: string | null) => {
      if (hoverTimer) window.clearTimeout(hoverTimer);
      if (id) setHoverRaw(id);
      else setHoverTimer(window.setTimeout(() => setHoverRaw(null), 180));
    },
    [hoverTimer],
  );

  const view = useMemo(() => buildView(graph, idx, { scope: place.scope, level: place.level, exact }), [graph, idx, place.scope, place.level, exact]);

  const trace: Trace | null = useMemo(() => {
    if (!traceReq) return null;
    const inside = (id: string) => id === traceReq.nodeId || idx.isAncestor(traceReq.nodeId, id);
    const related = new Set<string>([traceReq.nodeId]);
    const members = new Set<string>();
    for (const e of graph.edges) {
      const match = traceReq.dir === 'callers' ? inside(e.target) && !inside(e.source) : inside(e.source) && !inside(e.target);
      if (!match) continue;
      members.add(e.id);
      const other = view.resolve(traceReq.dir === 'callers' ? e.source : e.target);
      if (other) {
        related.add(other);
        for (const a of idx.ancestors(other)) related.add(a.id);
      }
    }
    for (const a of idx.ancestors(traceReq.nodeId)) related.add(a.id);
    // los hijos del nodo trazado también se ven
    for (const id of view.visible.keys()) if (inside(id)) related.add(id);
    const edges = new Set(view.edges.filter((ve) => ve.members.some((m) => members.has(m.id))).map((ve) => ve.id));
    return { ...traceReq, related, edges };
  }, [traceReq, graph.edges, view, idx]);

  const tourSteps = useMemo(() => new Map((graph.insights.reviewTour ?? []).map((s) => [s.nodeId, s.step])), [graph]);

  const ctx: CanvasCtx = {
    graph,
    idx,
    hover,
    setHover,
    trace,
    selected,
    tourSteps,
    explore: (id) => {
      const n = idx.byId.get(id);
      if (!n) return;
      go({ scope: id, level: exploreLevel(n) });
      setHoverRaw(null);
    },
    showTrace: (id, dir) => setTraceReq((t) => (t && t.nodeId === id && t.dir === dir ? null : { nodeId: id, dir })),
    select: (id) => setSelected(id),
  };

  const focusNode = (id: string) => {
    const t = focusTarget(idx, id);
    go({ ...t, focus: id });
    const n = idx.byId.get(id);
    if (n && n.kind !== 'directory' && n.kind !== 'repo') setSelected(id);
  };

  const scopeNode = idx.byId.get(place.scope)!;
  const crumbs = [...idx.ancestors(place.scope), scopeNode];
  const levelIdx = LEVELS.indexOf(place.level);
  const short = (s?: string) => (s ? s.slice(0, 10) : '');

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <Sidebar graph={graph as DiffGraph & { insightErrors?: string[] }} tab={tab} setTab={setTab} onFocus={focusNode} onAnalyzed={reload} />
        <main className="main">
          <div className="topbar">
            <div className="toolbar">
              <button className="ib" disabled={pos === 0} onClick={() => setPos(pos - 1)} title="Atrás">
                {Icon.back}
              </button>
              <button className="ib" disabled={pos >= history.length - 1} onClick={() => setPos(pos + 1)} title="Adelante">
                {Icon.fwd}
              </button>
              <div className="levels">
                {LEVELS.map((l) => (
                  <button key={l} className={l === place.level ? 'on' : ''} onClick={() => go({ level: l })}>
                    {LEVEL_LABEL[l]}
                  </button>
                ))}
              </div>
              <button className="ib" disabled={levelIdx === 0} onClick={() => go({ level: LEVELS[levelIdx - 1] })} title="Menos detalle">
                {Icon.minus}
              </button>
              <button className="ib" disabled={levelIdx === LEVELS.length - 1} onClick={() => go({ level: LEVELS[levelIdx + 1] })} title="Más detalle">
                {Icon.plus}
              </button>
            </div>
            <div className="banner">
              <div className="banner-row">
                {isDiff ? (
                  <span className="banner-title">
                    {Icon.branch}
                    {graph.meta.pr ? (
                      <a href={graph.meta.pr.url} target="_blank" rel="noreferrer">
                        PR #{graph.meta.pr.number}
                        {graph.meta.pr.title !== `PR #${graph.meta.pr.number}` ? ` · ${graph.meta.pr.title}` : ''}
                      </a>
                    ) : (
                      <>
                        Diff vs <code>{graph.meta.base}</code> <span className="muted">{short(graph.meta.baseSha)}</span> → {graph.meta.head === 'WORKTREE' ? 'árbol de trabajo' : <code>{short(graph.meta.headSha)}</code>}
                      </>
                    )}
                  </span>
                ) : (
                  <span className="banner-title">
                    {Icon.compass} Mapa de <b>{graph.meta.repo}</b> <span className="muted">{short(graph.meta.headSha)}</span>
                  </span>
                )}
                {place.scope !== root && (
                  <>
                    <span className="pill">Aislado</span>
                    <button className="link" onClick={() => go({ scope: root, level: 'architecture' })}>
                      {Icon.close} Dejar de aislar
                    </button>
                  </>
                )}
              </div>
              <div className="banner-row">
                {isDiff && (
                  <div className="seg">
                    <button className={exact ? 'on' : ''} onClick={() => setExact(true)} title="Solo lo que cambió">
                      Exact
                    </button>
                    <button className={!exact ? 'on' : ''} onClick={() => setExact(false)} title="Incluye lo que no cambió, atenuado">
                      With Context
                    </button>
                  </div>
                )}
                <div className="crumbs">
                  {crumbs.map((c, i) => (
                    <span key={c.id}>
                      {i > 0 && <span className="sep">/</span>}
                      <button className="crumb" onClick={() => go({ scope: c.id, level: c.kind === 'file' ? 'module' : place.level })}>
                        {c.name}
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              {trace && (
                <div className="banner-row trace-row">
                  <span>
                    {trace.dir === 'callers' ? 'Callers de' : 'Dependencias de'} <b>{idx.byId.get(trace.nodeId)?.name}</b> · {trace.related.size - 1} nodos
                  </span>
                  <button className="link" onClick={() => setTraceReq(null)}>
                    {Icon.close} limpiar
                  </button>
                </div>
              )}
            </div>
          </div>
          <Canvas view={view} focusId={place.focus} onLayout={setLayoutMs} />
          <div className="legend">
            {isDiff && (
              <>
                <span>
                  <i className="lg s-added" /> nuevo
                </span>
                <span>
                  <i className="lg s-modified" /> modificado
                </span>
                <span>
                  <i className="lg s-deleted" /> borrado
                </span>
                <span>
                  <i className="lg s-unchanged" /> sin cambios
                </span>
              </>
            )}
            <span className="muted">
              {view.count} nodos · {view.edges.length} aristas{layoutMs !== null ? ` · ${layoutMs} ms` : ''} · doble clic = Explore
            </span>
          </div>
        </main>
        {selected && idx.byId.get(selected) && <CodePanel node={idx.byId.get(selected)!} onClose={() => setSelected(null)} onFocus={focusNode} />}
      </div>
    </Ctx.Provider>
  );
}
