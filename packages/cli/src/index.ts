#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import { Git, loadConfig, renderArchitectureDoc, validateInsights, type DiffGraph, type Mode } from '@compass/core';
import { buildStaticHtml } from './export.js';
import { runAnalysis } from './run.js';
import { serve } from './server.js';
import { loadGraph, paths } from './store.js';

const program = new Command();
program
  .name('compass')
  .description('Compass — mapa navegable de repositorios y diffs (DiffMap)')
  .version('0.2.0')
  .option('-C, --root <dir>', 'raíz del repositorio a analizar', process.cwd());

const rootOf = () => Git.findRoot(resolve(program.opts().root));

function summary(g: DiffGraph): string {
  const r = g.nodes.find((n) => n.kind === 'repo')!.stats;
  const lines = [`${g.meta.mode.toUpperCase()} · ${g.meta.repo} · ${r.files} archivos · ${g.nodes.length} nodos · ${g.edges.length} aristas`];
  if (g.meta.mode !== 'map') lines.push(`cambios: +${r.added} −${r.removed} · ${r.addedChildren} nuevos, ${r.modifiedChildren} modificados, ${r.deletedChildren} borrados`);
  if (g.meta.pr) lines.push(`PR #${g.meta.pr.number}: ${g.meta.pr.title}`);
  const top = (label: string, xs: { id: string; reason: string }[]) => {
    if (!xs.length) return;
    lines.push(`${label}:`);
    for (const x of xs.slice(0, 5)) lines.push(`  · ${x.id} — ${x.reason}`);
  };
  top('Hotspots', g.insights.hotspots);
  top('Entry points', g.insights.entryPoints);
  if (g.insights.cycles?.length) lines.push(`Ciclos de imports: ${g.insights.cycles.length}`);
  if (g.insights.violations?.length) lines.push(`Violaciones de reglas: ${g.insights.violations.length}`);
  return lines.join('\n');
}

async function analyzeAndReport(mode: Mode, o: { base?: string; head?: string; pr?: string; repo?: string; mergeBase?: boolean; json?: boolean }) {
  const root = rootOf();
  const r = await runAnalysis({ root, mode, base: o.base, head: o.head, pr: o.pr, repo: o.repo, mergeBase: o.mergeBase });
  if (o.json) process.stdout.write(JSON.stringify({ file: r.file, meta: r.graph.meta, insights: r.graph.insights }, null, 2) + '\n');
  else console.log(`${summary(r.graph)}\n→ ${r.file}`);
  return r;
}

program
  .command('map')
  .description('Mapa del repositorio completo (para repos heredados o nuevos): estructura, entry points, hubs, ciclos, reglas')
  .option('--head <ref>', 'commit/rama a mapear (default: árbol de trabajo)')
  .option('--doc [path]', 'además genera ARCHITECTURE.md (default .compass/ARCHITECTURE.md)')
  .option('--json', 'salida JSON')
  .action(async (o) => {
    const r = await analyzeAndReport('map', o);
    if (o.doc) {
      const root = rootOf();
      const target = typeof o.doc === 'string' ? resolve(root, o.doc) : paths(root, r.config).doc;
      const g = loadGraph(paths(root, r.config))!.graph;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, renderArchitectureDoc(g));
      console.log(`→ ${target}`);
    }
  });

program
  .command('diff')
  .description('DiffMap entre base y head (default: merge-base con la base configurada vs árbol de trabajo)')
  .option('-b, --base <ref>', 'rama o commit base')
  .option('-H, --head <ref>', 'rama o commit head (WORKTREE = incluir cambios sin commitear)')
  .option('--no-merge-base', 'comparar directo contra base en lugar del merge-base')
  .option('--json', 'salida JSON')
  .action(async (o) => {
    await analyzeAndReport('diff', o);
  });

program
  .command('pr <pr>')
  .description('DiffMap de un pull request de GitHub (número, #número o URL)')
  .option('--repo <owner/name>', 'repo de GitHub (default: el de origin)')
  .option('-b, --base <ref>', 'base si la API de GitHub no está disponible (default: la configurada)')
  .option('--json', 'salida JSON')
  .action(async (pr, o) => {
    await analyzeAndReport('pr', { ...o, pr });
  });

program
  .command('insights')
  .description('Muestra los insights del último análisis, o aplica los que escribió la skill')
  .option('--json', 'salida JSON completa (nodos cambiados + insights) para la skill')
  .option('--check <file>', 'valida un insights.json contra el grafo sin aplicarlo')
  .action((o) => {
    const root = rootOf();
    const p = paths(root, loadConfig(root));
    const loaded = loadGraph(p);
    if (!loaded) throw new Error('No hay análisis: corre `compass map`, `compass diff` o `compass pr` primero.');
    const g = loaded.graph;
    if (o.check) {
      const v = validateInsights(g, JSON.parse(readFileSync(resolve(o.check), 'utf8')));
      console.log(v.ok ? 'insights válidos' : v.errors.join('\n'));
      process.exitCode = v.ok ? 0 : 1;
      return;
    }
    if (o.json) {
      const changed = g.nodes
        .filter((n) => n.status !== 'unchanged' && n.kind !== 'repo')
        .map((n) => ({ id: n.id, kind: n.kind, status: n.status, path: n.path, range: n.range, signature: n.signature, added: n.stats.added, removed: n.stats.removed }));
      const byId = new Map(g.nodes.map((n) => [n.id, n]));
      const callersOf = (id: string) => g.edges.filter((e) => e.target === id).map((e) => e.source);
      const calleesOf = (id: string) => g.edges.filter((e) => e.source === id).map((e) => e.target);
      const enrich = (xs: { id: string; score: number; reason: string }[]) =>
        xs.map((x) => ({ ...x, kind: byId.get(x.id)?.kind, range: byId.get(x.id)?.range, callers: callersOf(x.id).slice(0, 15), callees: calleesOf(x.id).slice(0, 15) }));
      const out = {
        graphFile: p.graph,
        insightsFile: p.insights,
        meta: g.meta,
        totals: g.nodes.find((n) => n.kind === 'repo')!.stats,
        entryPoints: enrich(g.insights.entryPoints),
        hotspots: enrich(g.insights.hotspots),
        cycles: g.insights.cycles,
        orphans: g.insights.orphans,
        violations: g.insights.violations,
        changed: changed.slice(0, 400),
        changedTruncated: changed.length > 400,
        existing: { reviewTour: g.insights.reviewTour, summaries: g.insights.summaries, risks: g.insights.risks },
        insightErrors: loaded.insightErrors,
      };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    } else {
      console.log(summary(g));
      if (g.insights.reviewTour?.length) {
        console.log('Recorrido de revisión:');
        for (const s of g.insights.reviewTour) console.log(`  ${s.step}. ${s.nodeId} — ${s.why}`);
      }
      for (const e of loaded.insightErrors) console.warn(`⚠ ${e}`);
    }
  });

program
  .command('serve')
  .description('Abre la app de Compass en el navegador (con controles para map / diff / PR)')
  .option('-p, --port <n>', 'puerto', (v) => Number(v))
  .option('--open', 'abrir el navegador')
  .option('--host <host>', 'host (default 127.0.0.1)')
  .action(async (o) => {
    const root = rootOf();
    const config = loadConfig(root);
    const s = await serve({ root, port: o.port ?? config.port, host: o.host });
    console.log(`Compass en ${s.url}  (repo: ${root})`);
    if (o.open) {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      execFile(cmd, [s.url], () => {});
    }
  });

program
  .command('export')
  .description('Genera un HTML autocontenido del último análisis (para adjuntar a un PR/MR)')
  .option('-o, --out <file>', 'archivo de salida', 'compass-review.html')
  .action((o) => {
    const root = rootOf();
    const loaded = loadGraph(paths(root, loadConfig(root)));
    if (!loaded) throw new Error('No hay análisis: corre `compass map`, `compass diff` o `compass pr` primero.');
    const out = resolve(o.out);
    writeFileSync(out, buildStaticHtml(root, loaded.graph));
    console.log(`→ ${out}`);
  });

program
  .command('init')
  .description('Crea compass.config.json con valores por defecto en el repo')
  .action(() => {
    const root = rootOf();
    const f = resolve(root, 'compass.config.json');
    if (existsSync(f)) return console.log('compass.config.json ya existe');
    const git = new Git(root);
    const base = ['origin/main', 'origin/develop', 'origin/master', 'main', 'develop', 'master'].find((b) => git.refExists(b)) ?? 'main';
    const cfg = {
      $schema: 'https://raw.githubusercontent.com/CrisMtz99/Compass_DiffMap/main/compass.schema.json',
      base,
      exclude: [],
      languages: ['typescript', 'tsx', 'javascript', 'python', 'java'],
      rules: [],
    };
    writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n');
    console.log(`→ ${f}`);
  });

program.parseAsync().catch((e) => {
  console.error(`compass: ${(e as Error).message}`);
  process.exit(1);
});
