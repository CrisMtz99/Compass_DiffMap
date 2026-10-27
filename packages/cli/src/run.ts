import { analyze, Git, loadConfig, type CompassConfig, type DiffGraph, type Mode } from '@compass/core';
import { ensurePrCommits, fetchPr, parsePrArg, prFromGit, repoFromRemote, type PrInfo } from './github.js';
import { paths, saveGraph } from './store.js';

export interface RunRequest {
  root: string;
  mode: Mode;
  base?: string;
  head?: string;
  pr?: string;
  repo?: string;
  mergeBase?: boolean;
  quiet?: boolean;
}

export async function runAnalysis(req: RunRequest): Promise<{ graph: DiffGraph; config: CompassConfig; file: string }> {
  const config = loadConfig(req.root);
  const log = req.quiet ? () => {} : (m: string) => process.stderr.write(`[compass] ${m}\n`);
  let graph: DiffGraph;
  if (req.mode === 'pr') {
    if (!req.pr) throw new Error('Falta el número o URL del PR');
    const git = new Git(req.root);
    const parsed = parsePrArg(req.pr);
    const repo = parsed.repo ?? req.repo ?? config.github.repo ?? repoFromRemote(git.remoteUrl());
    if (!repo) throw new Error('No sé de qué repo es el PR: usa --repo owner/nombre o configura github.repo');
    log(`consultando ${repo}#${parsed.number} en GitHub`);
    let pr: PrInfo;
    try {
      pr = await fetchPr(repo, parsed.number, config.github.tokenEnv);
      ensurePrCommits(git, pr);
    } catch (e) {
      // Sin API (token, rate limit, red): traer el PR por git y comparar contra la base indicada o configurada.
      log(`${(e as Error).message}; usando git directamente (pull/${parsed.number}/head)`);
      pr = prFromGit(git, parsed.number, repo, req.base ?? config.base);
    }
    graph = await analyze({
      root: req.root,
      mode: 'pr',
      base: pr.baseSha,
      head: pr.headSha,
      config,
      pr: { provider: 'github', number: pr.number, title: pr.title, url: pr.url, author: pr.author },
      onProgress: log,
    });
    graph.meta.base = pr.baseRef;
  } else {
    graph = await analyze({ root: req.root, mode: req.mode, base: req.base, head: req.head, mergeBase: req.mergeBase, config, onProgress: log });
  }
  const p = paths(req.root, config);
  saveGraph(p, graph);
  return { graph, config, file: p.graph };
}
