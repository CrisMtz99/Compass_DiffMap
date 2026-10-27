import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeInsights, type CompassConfig, type DiffGraph } from '@compass/core';

export interface Paths {
  dir: string;
  graph: string;
  insights: string;
  doc: string;
}

export function paths(root: string, config: CompassConfig): Paths {
  const dir = join(root, config.output);
  return {
    dir,
    graph: join(dir, 'graph.json'),
    insights: join(dir, 'insights.json'),
    doc: join(dir, 'ARCHITECTURE.md'),
  };
}

export function saveGraph(p: Paths, g: DiffGraph): void {
  mkdirSync(p.dir, { recursive: true });
  writeFileSync(join(p.dir, '.gitignore'), '*\n');
  writeFileSync(p.graph, JSON.stringify(g));
}

/** Lee graph.json y, si la skill escribió insights.json, los fusiona (validando nodeIds). */
export function loadGraph(p: Paths): { graph: DiffGraph; insightErrors: string[] } | undefined {
  if (!existsSync(p.graph)) return undefined;
  const graph = JSON.parse(readFileSync(p.graph, 'utf8')) as DiffGraph;
  if (!existsSync(p.insights)) return { graph, insightErrors: [] };
  try {
    const ext = JSON.parse(readFileSync(p.insights, 'utf8'));
    // Solo aplica si se escribieron para este mismo análisis.
    if (ext.headSha && graph.meta.headSha && ext.headSha !== graph.meta.headSha && graph.meta.head !== 'WORKTREE') {
      return { graph, insightErrors: [`insights.json corresponde a ${ext.headSha.slice(0, 10)}, el grafo a ${graph.meta.headSha.slice(0, 10)}: se ignoró`] };
    }
    const r = mergeInsights(graph, ext);
    return { graph: r.graph, insightErrors: r.errors };
  } catch (e) {
    return { graph, insightErrors: [`insights.json inválido: ${(e as Error).message}`] };
  }
}
