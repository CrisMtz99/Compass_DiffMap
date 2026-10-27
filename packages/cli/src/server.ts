import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Git, loadConfig, renderArchitectureDoc, WORKTREE, type Mode } from '@compass/core';
import { runAnalysis } from './run.js';
import { loadGraph, paths } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
export const WEB_DIR = join(here, 'web');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

export interface ServeOptions {
  root: string;
  port: number;
  host?: string;
}

export function serve(opts: ServeOptions): Promise<{ url: string; close: () => void }> {
  const { root } = opts;
  const config = loadConfig(root);
  const p = paths(root, config);
  const git = new Git(root);
  let busy: string | null = null;

  const json = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(e);
        }
      });
    });
  const mtime = (f: string) => (existsSync(f) ? statSync(f).mtimeMs : 0);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/api/status') {
        return json(res, 200, { busy, graphMtime: mtime(p.graph), insightsMtime: mtime(p.insights), root });
      }
      if (url.pathname === '/api/graph') {
        const g = loadGraph(p);
        if (!g) return json(res, 404, { empty: true, root });
        return json(res, 200, { ...g.graph, insightErrors: g.insightErrors });
      }
      if (url.pathname === '/api/refs') {
        const hasCommits = git.hasCommits();
        const branches = hasCommits
          ? git
              .run(['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'], { allowFail: true })
              .split('\n')
              .filter((b) => b && !b.endsWith('/HEAD'))
          : [];
        const current = git.run(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true }).trim();
        const dirty = git.run(['status', '--porcelain'], { allowFail: true }).trim().length > 0;
        return json(res, 200, { branches, current, hasCommits, dirty, defaultBase: config.base });
      }
      if (url.pathname === '/api/source') {
        const g = loadGraph(p);
        const path = url.searchParams.get('path') ?? '';
        if (!g || !path || path.includes('..')) return json(res, 400, { error: 'path inválido' });
        const which = url.searchParams.get('ref') ?? 'head';
        const fd = g.graph.files[path];
        const ref = which === 'base' ? g.graph.meta.baseSha : g.graph.meta.head === WORKTREE ? WORKTREE : g.graph.meta.headSha;
        const file = which === 'base' ? (fd?.oldPath ?? path) : path;
        if (!ref) return json(res, 404, { error: 'sin ref' });
        const text = git.readFile(ref, file);
        if (text === undefined) return json(res, 404, { error: 'no encontrado' });
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(text);
      }
      if (url.pathname === '/api/analyze' && req.method === 'POST') {
        if (busy) return json(res, 409, { error: `Ya hay un análisis en curso (${busy})` });
        const body = await readBody(req);
        const mode = (body.mode as Mode) ?? 'map';
        busy = mode;
        try {
          const r = await runAnalysis({
            root,
            mode,
            base: body.base as string | undefined,
            head: (body.head as string | undefined) || undefined,
            pr: body.pr ? String(body.pr) : undefined,
            mergeBase: body.mergeBase !== false,
          });
          return json(res, 200, { ok: true, meta: r.graph.meta });
        } finally {
          busy = null;
        }
      }
      if (url.pathname === '/api/doc' && req.method === 'POST') {
        const g = loadGraph(p);
        if (!g) return json(res, 404, { error: 'Primero corre un análisis' });
        const body = await readBody(req);
        const md = renderArchitectureDoc(g.graph);
        const target = body.target === 'repo' ? join(root, 'docs', 'ARCHITECTURE.md') : p.doc;
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, md);
        return json(res, 200, { ok: true, path: target, markdown: md });
      }
      // estáticos
      if (!existsSync(WEB_DIR)) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('La UI no está construida. Corre `pnpm build` en la raíz de Compass.');
      }
      let file = normalize(join(WEB_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
      if (!file.startsWith(WEB_DIR) || !existsSync(file) || statSync(file).isDirectory()) file = join(WEB_DIR, 'index.html');
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
  });

  const host = opts.host ?? '127.0.0.1';
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, host, () => resolve({ url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${opts.port}`, close: () => server.close() }));
  });
}

export function readWebIndex(): string | undefined {
  const f = join(WEB_DIR, 'index.html');
  return existsSync(f) ? readFileSync(f, 'utf8') : undefined;
}
