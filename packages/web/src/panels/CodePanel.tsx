import { useMemo, useState } from 'react';
import type { DiffNode } from '@compass/core';
import { useCanvas } from '../canvas/context';
import { Icon, KindIcon } from '../canvas/icons';
import { CodeLines, useSymbolLines } from '../canvas/nodes';

export function CodePanel({ node, onClose, onFocus }: { node: DiffNode; onClose: () => void; onFocus: (id: string) => void }) {
  const { graph, idx } = useCanvas();
  const [tab, setTab] = useState<'code' | 'diff'>('code');
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
    <aside className="codepanel">
      <div className="cp-head">
        <span className={`dot s-${node.status}`} />
        <KindIcon kind={node.kind} />
        <b>{node.name}</b>
        <span className="kind">{node.kind}</span>
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
      <div className="cp-code">
        {tab === 'code' || !fd ? (
          <CodeLines lines={lines} language={node.language} total={asSymbol.range!.end - asSymbol.range!.start + 1} />
        ) : (
          <div className="code-body">
            {hunks.map((h, i) => (
              <div key={i} className="hunk">
                <div className="hunk-h">
                  @@ −{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@
                </div>
                {h.lines.map((l, j) => (
                  <div key={j} className={`cl ${l[0] === '+' ? 'cl-add' : l[0] === '-' ? 'cl-del' : 'cl-ctx'}`}>
                    <span className="cl-no">{l[0]}</span>
                    <span className="cl-txt">{l.slice(1) || ' '}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

const label = (n?: DiffNode) => (n ? (n.kind === 'file' ? n.path : `${n.path.split('/').pop()} › ${n.id.split('#')[1] ?? n.name}`) : '?');
