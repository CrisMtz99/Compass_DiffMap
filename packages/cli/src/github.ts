import { Git } from '@compass/core';

export interface PrInfo {
  number: number;
  title: string;
  url: string;
  author?: string;
  baseRef: string;
  baseSha: string;
  headSha: string;
  repo: string;
}

/** owner/repo desde la URL del remoto origin (https o ssh). */
export function repoFromRemote(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(\.git)?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/** Acepta 123, #123 o https://github.com/o/r/pull/123 */
export function parsePrArg(arg: string): { number: number; repo?: string } {
  const url = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(arg);
  if (url) return { repo: `${url[1]}/${url[2]}`, number: Number(url[3]) };
  const n = Number(arg.replace(/^#/, ''));
  if (!Number.isInteger(n) || n <= 0) throw new Error(`PR inválido: "${arg}"`);
  return { number: n };
}

export async function fetchPr(repo: string, number: number, tokenEnv: string): Promise<PrInfo> {
  const token = process.env[tokenEnv];
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'compass-diffmap' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, { headers });
  if (!res.ok) {
    const hint = res.status === 404 && !token ? ` (si el repo es privado, exporta ${tokenEnv})` : '';
    throw new Error(`GitHub respondió ${res.status} para ${repo}#${number}${hint}`);
  }
  const pr = (await res.json()) as {
    number: number;
    title: string;
    html_url: string;
    user?: { login: string };
    base: { ref: string; sha: string };
    head: { sha: string };
  };
  return { number: pr.number, title: pr.title, url: pr.html_url, author: pr.user?.login, baseRef: pr.base.ref, baseSha: pr.base.sha, headSha: pr.head.sha, repo };
}

/** Garantiza que los commits del PR existan localmente. */
export function ensurePrCommits(git: Git, pr: PrInfo): void {
  if (!git.refExists(pr.headSha)) git.fetch('origin', `pull/${pr.number}/head`);
  if (!git.refExists(pr.baseSha)) git.fetch('origin', pr.baseRef);
  if (!git.refExists(pr.headSha) || !git.refExists(pr.baseSha)) {
    throw new Error('No se pudieron traer los commits del PR desde origin. ¿El remoto origin apunta a GitHub?');
  }
}

/** Respaldo sin API: trae refs/pull/N/head y usa como base la rama indicada. */
export function prFromGit(git: Git, number: number, repo: string, base: string): PrInfo {
  const local = `refs/compass/pr/${number}`;
  git.fetch('origin', `+pull/${number}/head:${local}`);
  const headSha = git.resolve(local);
  if (!headSha) throw new Error(`No se pudo traer pull/${number}/head desde origin`);
  const baseRef = base.replace(/^origin\//, '');
  if (!git.refExists(base)) git.fetch('origin', `+${baseRef}:refs/remotes/origin/${baseRef}`);
  const baseSha = git.resolve(base) ?? git.resolve(`origin/${baseRef}`);
  if (!baseSha) throw new Error(`No existe la base "${base}"; usa --base <rama>`);
  return { number, title: `PR #${number}`, url: `https://github.com/${repo}/pull/${number}`, baseRef, baseSha, headSha, repo };
}
