// Copia el build de la UI (packages/web/dist) dentro del CLI para que `compass serve` la sirva.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../../web/dist');
const dst = join(here, '../dist/web');
if (!existsSync(src)) {
  console.warn('[compass] packages/web/dist no existe todavía: corre `pnpm build` en la raíz.');
  process.exit(0);
}
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log('[compass] UI copiada a dist/web');
