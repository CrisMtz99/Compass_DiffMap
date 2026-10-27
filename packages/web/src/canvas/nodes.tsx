import { memo, useEffect, useMemo, useState } from 'react';
import { Handle, NodeToolbar, Position, type NodeProps } from '@xyflow/react';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import type { DiffNode } from '@compass/core';
import { fetchSource } from '../api';
import { CODE_MAX_LINES } from '../model/layout';
import type { ViewNode } from '../model/view';
import { useCanvas } from './context';
import { Icon, KindIcon } from './icons';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('java', java);

export interface NodeData extends Record<string, unknown> {
  v: ViewNode;
}

const KIND_LABEL: Record<string, string> = {
  repo: 'repo',
  directory: 'directory',
  file: 'file',
  class: 'class',
  interface: 'interface',
  enum: 'enum',
  type: 'type',
  function: 'function',
  method: 'method',
  property: 'property',
};

function useNodeState(id: string) {
  const c = useCanvas();
  const traced = c.trace ? c.trace.related.has(id) : null;
  return {
    c,
    hovered: c.hover === id,
    dim: traced === false,
    focusTrace: c.trace?.nodeId === id,
    selected: c.selected === id,
    tour: c.tourSteps.get(id),
  };
}

function Stats({ n, compact }: { n: DiffNode; compact?: boolean }) {
  const s = n.stats;
  const container = n.kind === 'repo' || n.kind === 'directory';
  return (
    <span className="stats">
      {s.added > 0 && <span className="st-add">+{s.added}</span>}
      {s.removed > 0 && <span className="st-del">−{s.removed}</span>}
      {!compact && s.modifiedChildren > 0 && (
        <span className="st-mod" title={container ? 'archivos modificados' : 'símbolos modificados'}>
          ✎{s.modifiedChildren}
        </span>
      )}
      {!compact && s.deletedChildren > 0 && (
        <span className="st-rm" title="borrados">
          ⌫{s.deletedChildren}
        </span>
      )}
      {s.deps > 0 && (
        <span className="st-dep" title="dependencias que cruzan este nodo">
          ⇄{s.deps}
        </span>
      )}
      {container && !compact && s.added + s.removed === 0 && <span className="st-muted">{s.files} arch.</span>}
    </span>
  );
}

function HoverCard({ n, visible }: { n: DiffNode; visible: boolean }) {
  const { c } = useNodeState(n.id);
  const summary = c.graph.insights.summaries?.[n.id];
  const risks = c.graph.insights.risks?.filter((r) => r.nodeId === n.id) ?? [];
  return (
    <NodeToolbar isVisible={visible} position={Position.Top} align="start" offset={6}>
      <div className="hovercard" onMouseEnter={() => c.setHover(n.id)} onMouseLeave={() => c.setHover(null)}>
        <div className="hc-row">
          <Stats n={n} />
          {n.signature && n.kind !== 'file' && <code className="hc-sig">{n.signature}</code>}
        </div>
        {summary && <div className="hc-summary">{summary}</div>}
        {risks.map((r, i) => (
          <div key={i} className="hc-risk">
            ⚠ {r.risk}
          </div>
        ))}
        <div className="hc-actions">
          <button onClick={() => c.explore(n.id)}>{Icon.explore} Explore</button>
          <button onClick={() => c.showTrace(n.id, 'callers')}>{Icon.callers} Callers</button>
          <button onClick={() => c.showTrace(n.id, 'deps')}>{Icon.deps} Dependencies</button>
          {n.kind !== 'repo' && n.kind !== 'directory' && (
            <button onClick={() => c.select(n.id)} title="Ver código">
              {Icon.code}
            </button>
          )}
        </div>
      </div>
    </NodeToolbar>
  );
}

const handles = (
  <>
    <Handle type="target" position={Position.Left} className="h" isConnectable={false} />
    <Handle type="source" position={Position.Right} className="h" isConnectable={false} />
  </>
);

function cls(n: DiffNode, st: ReturnType<typeof useNodeState>, extra: string) {
  return [
    extra,
    `s-${n.status}`,
    st.dim ? 'dim' : '',
    st.hovered ? 'hovered' : '',
    st.focusTrace ? 'trace-focus' : '',
    st.selected ? 'selected' : '',
    st.c.graph.meta.mode === 'map' ? 'mode-map' : '',
  ].join(' ');
}

const hoverProps = (c: ReturnType<typeof useCanvas>, id: string) => ({
  onMouseEnter: (e: React.MouseEvent) => {
    e.stopPropagation();
    c.setHover(id);
  },
  onMouseLeave: () => c.setHover(null),
  onDoubleClick: (e: React.MouseEvent) => {
    e.stopPropagation();
    c.explore(id);
  },
});

export const ContainerNode = memo(({ data }: NodeProps) => {
  const v = (data as NodeData).v;
  const n = v.node!;
  const st = useNodeState(n.id);
  return (
    <div className={cls(n, st, 'cnode')}>
      {handles}
      <HoverCard n={n} visible={st.hovered} />
      <div className="cnode-head" {...hoverProps(st.c, n.id)}>
        <span className="dot" />
        <KindIcon kind={n.kind} />
        <span className="name">
          {v.label ?? n.name}
          {n.kind === 'directory' || n.kind === 'repo' ? '/' : ''}
        </span>
        <span className="kind">{KIND_LABEL[n.kind]}</span>
        <Stats n={n} />
        {st.tour && <span className="tour-badge">{st.tour}</span>}
      </div>
    </div>
  );
});

export const LeafNode = memo(({ data }: NodeProps) => {
  const v = (data as NodeData).v;
  const st0 = useCanvas();
  if (v.more) {
    return (
      <div className={`more-chip ${v.more.quiet ? 'quiet' : ''}`} onClick={() => st0.explore(v.more!.parent)} title={v.more.quiet ? 'Sin cambios y sin relación con los cambios (Explore o Exact/With Context)' : 'Explorar para ver todos'}>
        {handles}+{v.more.count} {v.more.quiet ? 'sin cambios' : 'más'}
      </div>
    );
  }
  return <RealLeaf v={v} />;
});

function RealLeaf({ v }: { v: ViewNode }) {
  const n = v.node!;
  const st = useNodeState(n.id);
  const isSymbol = !['repo', 'directory', 'file'].includes(n.kind);
  const big = isSymbol && n.kind !== 'property';
  if (v.code) return <CodeLeaf v={v} st={st} />;
  return (
    <div className={cls(n, st, big ? 'sym' : 'chip')} {...hoverProps(st.c, n.id)} onClick={() => isSymbol && st.c.select(n.id)}>
      {handles}
      <HoverCard n={n} visible={st.hovered} />
      <div className="leaf-line">
        <span className="dot" />
        <KindIcon kind={n.kind} />
        <span className="name">{n.name}</span>
        {st.tour && <span className="tour-badge">{st.tour}</span>}
      </div>
      {big && (
        <div className="leaf-sub">
          <span className="kind">{KIND_LABEL[n.kind]}</span>
          <Stats n={n} compact />
        </div>
      )}
    </div>
  );
}

function CodeLeaf({ v, st }: { v: ViewNode; st: ReturnType<typeof useNodeState> }) {
  const n = v.node!;
  const lines = useSymbolLines(n);
  return (
    <div className={cls(n, st, 'codenode')}>
      {handles}
      <HoverCard n={n} visible={st.hovered} />
      <div className="code-head" {...hoverProps(st.c, n.id)}>
        <span className="dot" />
        <KindIcon kind={n.kind} />
        <span className="name">{n.name}</span>
        <span className="kind">{KIND_LABEL[n.kind]}</span>
        <Stats n={n} compact />
        {st.tour && <span className="tour-badge">{st.tour}</span>}
      </div>
      <CodeLines lines={lines} language={n.language} total={n.range ? n.range.end - n.range.start + 1 : undefined} />
    </div>
  );
}

export interface CodeLine {
  no: number;
  text: string;
  mark: 'add' | 'del' | 'ctx';
  delBefore?: boolean;
}

/** Líneas del símbolo con marcas del diff (agregadas en verde, puntos de borrado en rojo). */
export function useSymbolLines(n: DiffNode, max = CODE_MAX_LINES): CodeLine[] | null {
  const { graph } = useCanvas();
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  const which = n.status === 'deleted' ? 'base' : 'head';
  useEffect(() => {
    let alive = true;
    fetchSource(n.path, which).then((s) => alive && setSrc(s));
    return () => {
      alive = false;
    };
  }, [n.path, which]);
  return useMemo(() => {
    if (src === undefined) return null;
    if (src === null || !n.range) return [];
    const all = src.split('\n');
    const fd = graph.files[n.path];
    const added = new Set<number>();
    const delAt = new Set<number>();
    if (fd && which === 'head') {
      for (const h of fd.hunks) {
        let ln = h.newStart;
        let sawDel = false;
        for (const l of h.lines) {
          if (l.startsWith('+')) {
            if (sawDel) delAt.add(ln);
            sawDel = false;
            added.add(ln++);
          } else if (l.startsWith('-')) sawDel = true;
          else ln++;
        }
        if (sawDel) delAt.add(h.newLines === 0 ? h.newStart + 1 : ln);
      }
    }
    const out: CodeLine[] = [];
    for (let i = n.range.start; i <= Math.min(n.range.end, n.range.start + max - 1); i++) {
      out.push({ no: i, text: all[i - 1] ?? '', mark: which === 'base' ? 'del' : fd?.status === 'added' || added.has(i) ? 'add' : 'ctx', delBefore: delAt.has(i) });
    }
    return out;
  }, [src, n, graph.files, which, max]);
}

export function CodeLines({ lines, language, total }: { lines: CodeLine[] | null; language?: string; total?: number }) {
  if (lines === null) return <div className="code-body loading">cargando…</div>;
  if (!lines.length) return <div className="code-body loading">sin código disponible</div>;
  const lang = language === 'tsx' ? 'typescript' : language && hljs.getLanguage(language) ? language : undefined;
  // quitar indentación común
  const indent = Math.min(...lines.filter((l) => l.text.trim()).map((l) => l.text.match(/^\s*/)![0].length));
  return (
    <div className="code-body">
      {lines.map((l) => {
        const text = l.text.slice(Number.isFinite(indent) ? indent : 0);
        const html = lang ? hljs.highlight(text, { language: lang, ignoreIllegals: true }).value : escapeHtml(text);
        return (
          <div key={l.no} className={`cl cl-${l.mark} ${l.delBefore ? 'cl-delbefore' : ''}`}>
            <span className="cl-no">{l.no}</span>
            <span className="cl-txt" dangerouslySetInnerHTML={{ __html: html || ' ' }} />
          </div>
        );
      })}
      {total !== undefined && total > lines.length && <div className="cl-more">… {total - lines.length} líneas más</div>}
    </div>
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export const nodeTypes = { container: ContainerNode, leaf: LeafNode };
