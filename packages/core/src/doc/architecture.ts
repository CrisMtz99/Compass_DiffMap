import type { DiffGraph, DiffNode } from '../schema.js';

/**
 * Genera un ARCHITECTURE.md a partir del grafo (modo map):
 * árbol de módulos, entry points, hubs, ciclos, huérfanos y violaciones de reglas.
 * Las secciones de resumen se llenan con insights.summaries si la skill los escribió.
 */
export function renderArchitectureDoc(g: DiffGraph, opts: { maxDepth?: number } = {}): string {
  const maxDepth = opts.maxDepth ?? 3;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const kids = new Map<string, DiffNode[]>();
  for (const n of g.nodes) {
    if (!n.parentId) continue;
    if (!kids.has(n.parentId)) kids.set(n.parentId, []);
    kids.get(n.parentId)!.push(n);
  }
  const root = g.nodes.find((n) => n.kind === 'repo')!;
  const sum = g.insights.summaries ?? {};
  const out: string[] = [];
  const date = g.meta.generatedAt.slice(0, 10);

  out.push(`# Arquitectura de ${g.meta.repo}`);
  out.push('');
  out.push(`> Generado por Compass el ${date} sobre \`${g.meta.headSha?.slice(0, 10) ?? g.meta.head}\`. Regenerar con \`compass map --doc\`.`);
  out.push('');
  if (sum[root.id]) out.push(sum[root.id], '');

  out.push('## Resumen', '');
  const langs = Object.entries(g.insights.languages ?? {}).sort((a, b) => b[1] - a[1]);
  out.push(`- **Archivos:** ${root.stats.files} · **Líneas:** ${root.stats.lines.toLocaleString('es-MX')}`);
  out.push(`- **Símbolos:** ${g.nodes.filter((n) => !['repo', 'directory', 'file'].includes(n.kind)).length} · **Dependencias:** ${g.edges.length}`);
  if (langs.length) out.push(`- **Lenguajes:** ${langs.map(([l, c]) => `${l} (${c})`).join(', ')}`);
  out.push('');

  out.push('## Módulos', '');
  out.push('| Módulo | Archivos | Líneas | Dependencias | Descripción |');
  out.push('| --- | ---: | ---: | ---: | --- |');
  const walk = (n: DiffNode, depth: number) => {
    const dirs = (kids.get(n.id) ?? []).filter((k) => k.kind === 'directory').sort((a, b) => b.stats.lines - a.stats.lines);
    for (const d of dirs) {
      const indent = '&nbsp;&nbsp;'.repeat(depth);
      out.push(`| ${indent}\`${d.path}/\` | ${d.stats.files} | ${d.stats.lines.toLocaleString('es-MX')} | ${d.stats.deps} | ${(sum[d.id] ?? '').replace(/\|/g, '\\|')} |`);
      if (depth + 1 < maxDepth) walk(d, depth + 1);
    }
  };
  walk(root, 0);
  out.push('');

  const section = (title: string, items: { id: string; reason: string }[], empty: string) => {
    out.push(`## ${title}`, '');
    if (!items.length) out.push(empty, '');
    else {
      for (const i of items) out.push(`- \`${i.id}\` — ${i.reason}${sum[i.id] ? `. ${sum[i.id]}` : ''}`);
      out.push('');
    }
  };
  section('Puntos de entrada', g.insights.entryPoints, 'No se detectaron puntos de entrada claros.');
  section('Archivos más usados (hubs)', g.insights.hotspots, 'Sin dependencias detectadas.');

  out.push('## Salud de la estructura', '');
  const cycles = g.insights.cycles ?? [];
  out.push(`### Ciclos de imports (${cycles.length})`, '');
  if (!cycles.length) out.push('Ninguno.', '');
  for (const c of cycles.slice(0, 15)) out.push(`- ${c.files.map((f) => `\`${f}\``).join(' → ')}`);
  if (cycles.length) out.push('');
  const orphans = g.insights.orphans ?? [];
  out.push(`### Archivos sin dependencias (${orphans.length})`, '');
  if (!orphans.length) out.push('Ninguno.', '');
  else out.push(orphans.slice(0, 30).map((o) => `\`${o}\``).join(', '), '');
  const viol = g.insights.violations ?? [];
  out.push(`### Violaciones de reglas de arquitectura (${viol.length})`, '');
  if (!viol.length) out.push('Ninguna (o no hay reglas en `compass.config.json`).', '');
  for (const v of viol.slice(0, 50)) out.push(`- **${v.rule}:** \`${v.source}\` importa \`${v.target}\``);
  if (viol.length) out.push('');

  if (g.insights.risks?.length) {
    out.push('## Riesgos señalados', '');
    for (const r of g.insights.risks) out.push(`- \`${r.nodeId}\` — ${r.risk}`);
    out.push('');
  }
  void byId;
  return out.join('\n');
}
