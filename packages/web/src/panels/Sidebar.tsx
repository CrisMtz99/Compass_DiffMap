import { useEffect, useMemo, useState } from 'react';
import type { DiffGraph, DiffNode, Insight, Mode } from '@compass/core';
import { fetchRefs, isStatic, runAnalyze, writeDoc, type Refs } from '../api';
import { Icon, KindIcon } from '../canvas/icons';

export type SideTab = 'insights' | 'search' | 'analyze';
type G = DiffGraph & { insightErrors?: string[] };

interface Props {
  graph: G | null;
  tab: SideTab | null;
  setTab: (t: SideTab | null) => void;
  onFocus: (id: string) => void;
  onAnalyzed: () => void;
}

export function Sidebar({ graph, tab, setTab, onFocus, onAnalyzed }: Props) {
  const toggle = (t: SideTab) => setTab(tab === t ? null : t);
  return (
    <>
      <nav className="rail">
        <div className="rail-logo" title="Compass">
          {Icon.compass}
        </div>
        <button className={tab === 'insights' ? 'on' : ''} onClick={() => toggle('insights')} disabled={!graph} title="Insights">
          {Icon.health}
          <span>Insights</span>
        </button>
        <button className={tab === 'search' ? 'on' : ''} onClick={() => toggle('search')} disabled={!graph} title="Buscar">
          {Icon.search}
          <span>Buscar</span>
        </button>
        {!isStatic() && (
          <button className={tab === 'analyze' ? 'on' : ''} onClick={() => toggle('analyze')} title="Analizar">
            {Icon.play}
            <span>Analizar</span>
          </button>
        )}
      </nav>
      {tab && (
        <aside className="side">
          {tab === 'insights' && graph && <InsightsPanel graph={graph} onFocus={onFocus} />}
          {tab === 'search' && graph && <SearchPanel graph={graph} onFocus={onFocus} />}
          {tab === 'analyze' && <AnalyzePanel graph={graph} onAnalyzed={onAnalyzed} />}
        </aside>
      )}
    </>
  );
}

function NodeRef({ n, onFocus, children }: { n?: DiffNode; onFocus: (id: string) => void; children?: React.ReactNode }) {
  if (!n) return null;
  return (
    <button className={`ref s-${n.status}`} onClick={() => onFocus(n.id)} title={n.id}>
      <span className="dot" />
      <KindIcon kind={n.kind} />
      <span className="ref-name">{n.kind === 'file' || n.kind === 'directory' ? n.path : `${n.path.split('/').pop()} › ${n.id.split('#')[1]}`}</span>
      {children}
    </button>
  );
}

function InsightsPanel({ graph, onFocus }: { graph: G; onFocus: (id: string) => void }) {
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const ins = graph.insights;
  const isMap = graph.meta.mode === 'map';
  const hasTour = !!ins.reviewTour?.length;
  const r = graph.nodes.find((n) => n.kind === 'repo')!.stats;
  const list = (items: Insight[]) => <InsightList items={items} byId={byId} summaries={ins.summaries} onFocus={onFocus} />;
  return (
    <div className="panel">
      <h2>{isMap ? 'Mapa del repositorio' : graph.meta.pr ? `PR #${graph.meta.pr.number}` : 'Diff'}</h2>
      <div className="kpis">
        <div>
          <b>{r.files}</b>
          <span>archivos</span>
        </div>
        {isMap ? (
          <>
            <div>
              <b>{r.lines.toLocaleString('es-MX')}</b>
              <span>líneas</span>
            </div>
            <div>
              <b>{graph.edges.length}</b>
              <span>dependencias</span>
            </div>
          </>
        ) : (
          <>
            <div>
              <b className="st-add">+{r.added}</b>
              <span>agregadas</span>
            </div>
            <div>
              <b className="st-del">−{r.removed}</b>
              <span>borradas</span>
            </div>
            <div>
              <b>{r.addedChildren + r.modifiedChildren + r.deletedChildren}</b>
              <span>arch. cambiados</span>
            </div>
          </>
        )}
      </div>
      {ins.summaries?.['.'] && <p className="ai-summary">{ins.summaries['.']}</p>}
      {graph.insightErrors?.map((e, i) => (
        <p key={i} className="warn">
          {e}
        </p>
      ))}

      {ins.reviewTour && ins.reviewTour.length > 0 && (
        <section>
          <h3>Recorrido sugerido</h3>
          <ol className="tour">
            {ins.reviewTour.map((s) => (
              <li key={s.step}>
                <NodeRef n={byId.get(s.nodeId)} onFocus={onFocus} />
                <div className="why ai">{s.why}</div>
              </li>
            ))}
          </ol>
        </section>
      )}
      {ins.risks && ins.risks.length > 0 && (
        <section>
          <h3>Riesgos</h3>
          <ul className="ilist">
            {ins.risks.map((x, i) => (
              <li key={i}>
                <NodeRef n={byId.get(x.nodeId)} onFocus={onFocus} />
                <div className="why risk">⚠ {x.risk}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Section title={isMap ? 'Hubs' : 'Hotspots'} count={ins.hotspots.length} defaultOpen={!hasTour}>
        {ins.hotspots.length ? list(ins.hotspots) : <p className="muted">Nada que destacar.</p>}
      </Section>
      <Section title="Entry points" count={ins.entryPoints.length} defaultOpen={!hasTour && isMap}>
        {ins.entryPoints.length ? list(ins.entryPoints) : <p className="muted">No se detectaron.</p>}
      </Section>
      {(ins.cycles || ins.orphans || (ins.violations && ins.violations.length > 0)) && (
        <Section title="Salud de la estructura" defaultOpen={isMap}>
          {ins.violations && ins.violations.length > 0 && (
            <>
              <h4>Violaciones de reglas ({ins.violations.length})</h4>
              <ul className="ilist">
                {ins.violations.slice(0, 30).map((v, i) => (
                  <li key={i}>
                    <NodeRef n={byId.get(v.source)} onFocus={onFocus} />
                    <div className="why risk">
                      {v.rule}: importa {v.target}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {ins.cycles && (
            <>
              <h4>Ciclos de imports ({ins.cycles.length})</h4>
              {ins.cycles.slice(0, 10).map((c, i) => (
                <div key={i} className="cycle">
                  {c.files.map((f) => (
                    <NodeRef key={f} n={byId.get(f)} onFocus={onFocus} />
                  ))}
                </div>
              ))}
            </>
          )}
          {ins.orphans && (
            <>
              <h4>Archivos sin dependencias ({ins.orphans.length})</h4>
              <ul className="ilist compact">
                {ins.orphans.slice(0, 30).map((o) => (
                  <li key={o}>
                    <NodeRef n={byId.get(o)} onFocus={onFocus} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}
      {ins.languages && (
        <Section title="Lenguajes" defaultOpen={false}>
          <div className="langs">
            {Object.entries(ins.languages)
              .sort((a, b) => b[1] - a[1])
              .map(([l, c]) => (
                <span key={l}>
                  {l} <b>{c}</b>
                </span>
              ))}
          </div>
        </Section>
      )}
      <p className="muted foot">
        Generado {new Date(graph.meta.generatedAt).toLocaleString('es-MX')} · {graph.meta.durationMs} ms
      </p>
    </div>
  );
}

function Section({ title, count, defaultOpen = true, children }: { title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button className={`section-h ${open ? '' : 'closed'}`} onClick={() => setOpen(!open)}>
        <span>
          <span className="chev">▾</span>
          {title}
        </span>
        {count !== undefined && <span className="count">{count}</span>}
      </button>
      {open && children}
    </section>
  );
}

function InsightList({ items, byId, summaries, onFocus }: { items: Insight[]; byId: Map<string, DiffNode>; summaries?: Record<string, string>; onFocus: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 5);
  return (
    <>
      <ul className="ilist">
        {shown.map((i) => (
          <li key={i.id}>
            <NodeRef n={byId.get(i.id)} onFocus={onFocus} />
            <div className="why" title={i.reason}>
              {summaries?.[i.id] ?? i.reason}
            </div>
          </li>
        ))}
      </ul>
      {items.length > 5 && (
        <button className="more-link" onClick={() => setAll(!all)}>
          {all ? 'ver menos' : `ver ${items.length - 5} más`}
        </button>
      )}
    </>
  );
}

function SearchPanel({ graph, onFocus }: { graph: G; onFocus: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return graph.nodes
      .filter((n) => n.kind !== 'repo' && (!onlyChanged || n.status !== 'unchanged') && (n.name.toLowerCase().includes(s) || n.id.toLowerCase().includes(s)))
      .sort((a, b) => Number(b.name.toLowerCase() === s) - Number(a.name.toLowerCase() === s) || a.id.length - b.id.length)
      .slice(0, 120);
  }, [q, graph, onlyChanged]);
  return (
    <div className="panel">
      <h2>Buscar</h2>
      <input autoFocus className="input" placeholder="archivo, clase, método…" value={q} onChange={(e) => setQ(e.target.value)} />
      {graph.meta.mode !== 'map' && (
        <label className="check">
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> solo cambiados
        </label>
      )}
      <ul className="ilist compact">
        {results.map((n) => (
          <li key={n.id}>
            <NodeRef n={n} onFocus={onFocus} />
          </li>
        ))}
      </ul>
      {q && !results.length && <p className="muted">Sin resultados.</p>}
    </div>
  );
}

function AnalyzePanel({ graph, onAnalyzed }: { graph: G | null; onAnalyzed: () => void }) {
  const [refs, setRefs] = useState<Refs | null>(null);
  const [mode, setMode] = useState<Mode>(graph?.meta.mode ?? 'map');
  const [base, setBase] = useState('');
  const [head, setHead] = useState('WORKTREE');
  const [pr, setPr] = useState(graph?.meta.pr ? String(graph.meta.pr.number) : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetchRefs().then((r) => {
      setRefs(r);
      if (r) setBase(graph?.meta.mode === 'diff' && graph.meta.base ? graph.meta.base : r.branches.includes(r.defaultBase) ? r.defaultBase : (r.branches[0] ?? ''));
    });
  }, [graph]);

  const go = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await runAnalyze({ mode, base: mode === 'diff' ? base : undefined, head: mode === 'pr' ? undefined : head, pr: mode === 'pr' ? pr : undefined });
      setMsg({ ok: true, text: 'Listo.' });
      onAnalyzed();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const doc = async () => {
    setBusy(true);
    try {
      const r = await writeDoc('repo');
      setMsg({ ok: true, text: `Escrito ${r.path}` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h2>Analizar</h2>
      <div className="modes">
        <button className={mode === 'map' ? 'on' : ''} onClick={() => setMode('map')}>
          <b>Mapa del repo</b>
          <span>Repo heredado o nuevo: documentar y verificar la estructura</span>
        </button>
        <button className={mode === 'diff' ? 'on' : ''} onClick={() => setMode('diff')} disabled={refs ? !refs.hasCommits : false}>
          <b>Diff</b>
          <span>Desarrollo, debugging y mantenimiento</span>
        </button>
        <button className={mode === 'pr' ? 'on' : ''} onClick={() => setMode('pr')} disabled={refs ? !refs.hasCommits : false}>
          <b>Pull request</b>
          <span>Revisar un PR de GitHub</span>
        </button>
      </div>
      {mode !== 'pr' && (
        <label className="field">
          <span>{mode === 'map' ? 'Versión' : 'Head'}</span>
          <select className="input" value={head} onChange={(e) => setHead(e.target.value)}>
            <option value="WORKTREE">Árbol de trabajo{refs?.dirty ? ' (con cambios sin commitear)' : ''}</option>
            {refs?.branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      )}
      {mode === 'diff' && (
        <label className="field">
          <span>Base</span>
          <input className="input" list="branches" value={base} onChange={(e) => setBase(e.target.value)} placeholder="origin/main o un commit" />
          <datalist id="branches">
            {refs?.branches.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </label>
      )}
      {mode === 'pr' && (
        <label className="field">
          <span>PR</span>
          <input className="input" value={pr} onChange={(e) => setPr(e.target.value)} placeholder="123 o https://github.com/org/repo/pull/123" />
        </label>
      )}
      <button className="primary" onClick={go} disabled={busy || (mode === 'pr' && !pr) || (mode === 'diff' && !base)}>
        {busy ? 'Analizando…' : 'Analizar'}
      </button>
      {graph?.meta.mode === 'map' && (
        <button className="secondary" onClick={doc} disabled={busy} title="Escribe docs/ARCHITECTURE.md en el repo">
          {Icon.doc} Documentar estructura (docs/ARCHITECTURE.md)
        </button>
      )}
      {msg && <p className={msg.ok ? 'ok' : 'err'}>{msg.text}</p>}
      <p className="muted small">
        Desde Claude Code, la skill <code>compass</code> corre estos mismos análisis y agrega un recorrido de revisión, resúmenes y riesgos. Esta vista se actualiza sola.
      </p>
    </div>
  );
}
