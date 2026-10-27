import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { analyze, loadConfig, renderArchitectureDoc, type DiffGraph } from '../src/index.js';
import { makeFixture } from './fixture.js';

let fx: ReturnType<typeof makeFixture>;
let diff: DiffGraph;
let map: DiffGraph;

before(async () => {
  fx = makeFixture();
  const config = loadConfig(fx.root);
  diff = await analyze({ root: fx.root, mode: 'diff', base: 'main', head: 'feature', config });
  map = await analyze({ root: fx.root, mode: 'map', head: 'feature', config });
});
after(() => fx.cleanup());

const node = (g: DiffGraph, id: string) => g.nodes.find((n) => n.id === id);
const hasEdge = (g: DiffGraph, s: string, t: string, kind?: string) => g.edges.some((e) => e.source === s && e.target === t && (!kind || e.kind === kind));

test('estados de archivos en diff', () => {
  assert.equal(node(diff, 'src/chat/history.ts')?.status, 'added');
  assert.equal(node(diff, 'src/chat/chat.service.ts')?.status, 'modified');
  assert.equal(node(diff, 'src/utils/old.ts')?.status, 'deleted');
  assert.equal(node(diff, 'src/app/main.ts')?.status, 'unchanged');
  assert.equal(node(diff, 'src/')?.status, 'modified');
});

test('estados de símbolos: agregado, modificado, borrado, sin cambios', () => {
  assert.equal(node(diff, 'src/chat/chat.service.ts#ChatService.audit')?.status, 'added');
  assert.equal(node(diff, 'src/chat/chat.service.ts#ChatService.log')?.status, 'deleted');
  assert.equal(node(diff, 'src/chat/chat.service.ts#ChatService.send')?.status, 'modified');
  assert.equal(node(diff, 'src/chat/chat.service.ts#ChatService.history')?.status, 'unchanged');
  assert.equal(node(diff, 'src/utils/format.ts#pad')?.status, 'unchanged');
  assert.equal(node(diff, 'src/utils/format.ts#formatDate')?.status, 'modified');
  assert.equal(node(diff, 'py/pkg/models.py#User.greet')?.status, 'modified');
  assert.equal(node(diff, 'py/pkg/models.py#helper')?.status, 'unchanged');
  assert.equal(node(diff, 'java/src/main/java/com/acme/Billing.java#Billing.refund')?.status, 'added');
  assert.equal(node(diff, 'java/src/main/java/com/acme/Billing.java#Billing.charge')?.status, 'modified');
});

test('imports resueltos (relativo, alias tsconfig, python relativo, java mismo paquete)', () => {
  assert.ok(hasEdge(diff, 'src/app/main.ts', 'src/chat/chat.service.ts', 'import'));
  assert.ok(hasEdge(diff, 'src/app/main.ts', 'src/utils/format.ts', 'import'), 'alias @utils');
  assert.ok(hasEdge(diff, 'py/pkg/api.py', 'py/pkg/models.py', 'import'));
  assert.ok(hasEdge(diff, 'java/src/main/java/com/acme/Billing.java', 'java/src/main/java/com/acme/Order.java', 'import'));
});

test('aristas de llamada', () => {
  assert.ok(hasEdge(diff, 'src/chat/chat.service.ts#ChatService.send', 'src/chat/chat.service.ts#ChatService.audit', 'call'));
  assert.ok(hasEdge(diff, 'src/chat/chat.service.ts#ChatService.audit', 'src/utils/format.ts#formatDate', 'call'));
  assert.ok(hasEdge(diff, 'src/app/main.ts#main', 'src/chat/chat.service.ts#ChatService', 'call'), 'new ChatService');
  assert.ok(hasEdge(diff, 'py/pkg/models.py#User.greet', 'py/pkg/models.py#helper', 'call'));
  assert.ok(hasEdge(diff, 'py/pkg/api.py#handle', 'py/pkg/models.py#User', 'call'));
  assert.ok(hasEdge(diff, 'java/src/main/java/com/acme/Billing.java#Billing.charge', 'java/src/main/java/com/acme/Order.java#Order.getTotal', 'call'));
});

test('insights de diff', () => {
  assert.ok(diff.insights.entryPoints.length > 0);
  assert.ok(diff.insights.entryPoints.some((e) => e.id === 'src/utils/format.ts#formatDate'), JSON.stringify(diff.insights.entryPoints));
  assert.ok(diff.insights.hotspots.length > 0);
});

test('modo map: entry points, doc', () => {
  assert.ok(map.nodes.every((n) => n.status === 'unchanged'));
  assert.ok(map.insights.entryPoints.some((e) => e.id === 'src/app/main.ts'), JSON.stringify(map.insights.entryPoints));
  assert.ok(map.insights.hotspots.some((h) => h.id === 'src/utils/format.ts'));
  const md = renderArchitectureDoc(map);
  assert.match(md, /# Arquitectura de/);
  assert.match(md, /src\/app\/main.ts/);
});

test('reglas de arquitectura', async () => {
  const config = loadConfig(fx.root, { rules: [{ name: 'app no importa utils directo', from: 'src/app/**', disallow: 'src/utils/**' }] });
  const g = await analyze({ root: fx.root, mode: 'map', head: 'feature', config });
  assert.equal(g.insights.violations?.length, 1);
});

test('una función no exportada no se enlaza desde otro archivo por coincidencia de nombre', async () => {
  const { execFileSync } = await import('node:child_process');
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  writeFileSync(join(fx.root, 'src/chat/panel.ts'), `const load = () => 1;\nexport function Panel() {\n  return load();\n}\n`);
  writeFileSync(join(fx.root, 'src/app/shell.ts'), `import { Panel } from '../chat/panel';\nfunction load() {\n  return Panel();\n}\nexport function boot() {\n  return load();\n}\n`);
  execFileSync('git', ['add', '-A'], { cwd: fx.root });
  const g = await analyze({ root: fx.root, mode: 'map', head: 'WORKTREE', config: loadConfig(fx.root) });
  assert.ok(!g.edges.some((e) => e.source.startsWith('src/app/shell.ts') && e.target === 'src/chat/panel.ts#load'));
  assert.ok(g.edges.some((e) => e.source === 'src/app/shell.ts#boot' && e.target === 'src/app/shell.ts#load'));
});
