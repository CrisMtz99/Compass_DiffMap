import type { DiffGraph, Mode } from '@compass/core';

declare global {
  interface Window {
    __COMPASS_STATIC__?: { graph: DiffGraph; sources: Record<string, string> };
  }
}

export const isStatic = () => !!window.__COMPASS_STATIC__;

export type GraphWithErrors = DiffGraph & { insightErrors?: string[] };

export async function fetchGraph(): Promise<GraphWithErrors | null> {
  if (window.__COMPASS_STATIC__) return window.__COMPASS_STATIC__.graph;
  const r = await fetch('/api/graph');
  if (r.status === 404) return null;
  if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
  return r.json();
}

export interface Status {
  busy: string | null;
  graphMtime: number;
  insightsMtime: number;
  root: string;
}

export async function fetchStatus(): Promise<Status | null> {
  if (isStatic()) return null;
  try {
    const r = await fetch('/api/status');
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

export interface Refs {
  branches: string[];
  current: string;
  hasCommits: boolean;
  dirty: boolean;
  defaultBase: string;
}

export async function fetchRefs(): Promise<Refs | null> {
  if (isStatic()) return null;
  const r = await fetch('/api/refs');
  return r.ok ? r.json() : null;
}

export interface AnalyzeRequest {
  mode: Mode;
  base?: string;
  head?: string;
  pr?: string;
}

export async function runAnalyze(req: AnalyzeRequest): Promise<void> {
  const r = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
  if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
}

export async function writeDoc(target: 'repo' | 'compass'): Promise<{ path: string; markdown: string }> {
  const r = await fetch('/api/doc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }) });
  if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
  return r.json();
}

const cache = new Map<string, Promise<string | null>>();

/** Código fuente de un archivo en la versión head o base. */
export function fetchSource(path: string, which: 'head' | 'base' = 'head'): Promise<string | null> {
  const key = `${which}:${path}`;
  if (window.__COMPASS_STATIC__) return Promise.resolve(window.__COMPASS_STATIC__.sources[key] ?? null);
  if (!cache.has(key)) {
    cache.set(
      key,
      fetch(`/api/source?ref=${which}&path=${encodeURIComponent(path)}`).then((r) => (r.ok ? r.text() : null)),
    );
  }
  return cache.get(key)!;
}

export function clearSourceCache() {
  cache.clear();
}
