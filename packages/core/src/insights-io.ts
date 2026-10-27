import type { DiffGraph, Insights } from './schema.js';

/** Lo que la skill (u otra herramienta) puede escribir en .compass/insights.json. */
export type ExternalInsights = Pick<Insights, 'reviewTour' | 'summaries' | 'risks'>;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  cleaned: ExternalInsights;
}

/** Valida que los nodeIds existan en el grafo y descarta lo inválido. */
export function validateInsights(g: DiffGraph, ext: ExternalInsights): ValidationResult {
  const ids = new Set(g.nodes.map((n) => n.id));
  const errors: string[] = [];
  const cleaned: ExternalInsights = {};
  if (ext.reviewTour) {
    cleaned.reviewTour = ext.reviewTour.filter((s) => {
      if (!ids.has(s.nodeId)) errors.push(`reviewTour: nodeId inexistente "${s.nodeId}"`);
      return ids.has(s.nodeId);
    });
    cleaned.reviewTour.sort((a, b) => a.step - b.step);
  }
  if (ext.summaries) {
    cleaned.summaries = {};
    for (const [k, v] of Object.entries(ext.summaries)) {
      if (ids.has(k)) cleaned.summaries[k] = v;
      else errors.push(`summaries: nodeId inexistente "${k}"`);
    }
  }
  if (ext.risks) {
    cleaned.risks = ext.risks.filter((r) => {
      if (!ids.has(r.nodeId)) errors.push(`risks: nodeId inexistente "${r.nodeId}"`);
      return ids.has(r.nodeId);
    });
  }
  return { ok: errors.length === 0, errors, cleaned };
}

export function mergeInsights(g: DiffGraph, ext: ExternalInsights): { graph: DiffGraph; errors: string[] } {
  const v = validateInsights(g, ext);
  return { graph: { ...g, insights: { ...g.insights, ...v.cleaned } }, errors: v.errors };
}
