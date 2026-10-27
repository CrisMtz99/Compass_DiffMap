import { Git, WORKTREE, type DiffGraph } from '@compass/core';
import { readWebIndex } from './server.js';

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

/** HTML autocontenido con el grafo y el código necesario para navegar sin servidor. */
export function buildStaticHtml(root: string, graph: DiffGraph): string {
  const html = readWebIndex();
  if (!html) throw new Error('La UI no está construida. Corre `pnpm build` en la raíz de Compass.');
  const git = new Git(root);
  const headRef = graph.meta.head === WORKTREE ? WORKTREE : graph.meta.headSha!;
  const sources: Record<string, string> = {};
  let bytes = 0;
  const add = (key: string, ref: string | undefined, path: string) => {
    if (!ref || bytes > MAX_SOURCE_BYTES) return;
    const t = git.readFile(ref, path);
    if (t === undefined) return;
    bytes += t.length;
    sources[key] = t;
  };
  const changed = Object.values(graph.files);
  for (const fd of changed) {
    if (fd.status !== 'deleted') add(`head:${fd.path}`, headRef, fd.path);
    if (fd.status !== 'added') add(`base:${fd.path}`, graph.meta.baseSha, fd.oldPath ?? fd.path);
  }
  // Contexto: archivos con símbolos, los más conectados primero, hasta el límite.
  const withSymbols = new Set(graph.nodes.filter((n) => n.parentId && graph.nodes.find((f) => f.id === n.parentId)?.kind === 'file').map((n) => n.path));
  const deps = new Map(graph.nodes.filter((n) => n.kind === 'file').map((n) => [n.id, n.stats.deps]));
  for (const f of [...withSymbols].sort((a, b) => (deps.get(b) ?? 0) - (deps.get(a) ?? 0))) {
    if (!sources[`head:${f}`] && graph.nodes.find((n) => n.id === f)?.status !== 'deleted') add(`head:${f}`, headRef, f);
  }
  const payload = JSON.stringify({ graph, sources }).replace(/</g, '\\u003c');
  const tag = `<script>window.__COMPASS_STATIC__=${payload};</script>`;
  return html.includes('</head>') ? html.replace('</head>', `${tag}</head>`) : tag + html;
}
