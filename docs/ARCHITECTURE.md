# Arquitectura de Compass_DiffMap

> Generado por Compass el 2026-10-27 sobre `1cc0ecbc1d`. Regenerar con `compass map --doc`.

Compass: CLI + app web que convierten un repo, un diff o un PR en un mapa con zoom semántico, más una skill de Claude Code que agrega recorrido, resúmenes y riesgos.

## Resumen

- **Archivos:** 61 · **Líneas:** 12,826
- **Símbolos:** 194 · **Dependencias:** 223
- **Lenguajes:** typescript (24), json (10), tsx (7), markdown (6), yaml (3), javascript (1), html (1), css (1), shell (1)

## Módulos

| Módulo | Archivos | Líneas | Dependencias | Descripción |
| --- | ---: | ---: | ---: | --- |
| `docs/` | 8 | 5,446 | 0 | Documentación: guía de la interfaz (GUIA-UI.md), capturas y esta arquitectura. |
| &nbsp;&nbsp;`docs/img/` | 6 | 5,266 | 0 | Capturas usadas en el README y la guía. |
| `packages/` | 40 | 5,190 | 0 | Monorepo pnpm: motor, CLI y UI. |
| &nbsp;&nbsp;`packages/web/` | 16 | 2,398 | 8 | App React + React Flow + ELK compilada a un solo index.html. |
| &nbsp;&nbsp;&nbsp;&nbsp;`packages/web/src/` | 12 | 2,329 | 8 | Vista por niveles (model/), lienzo y nodos (canvas/), paneles laterales (panels/). |
| &nbsp;&nbsp;`packages/core/` | 15 | 2,213 | 19 | Motor sin UI: git, parseo con tree-sitter, mapeo de hunks a símbolos, grafo con rollup e insights. |
| &nbsp;&nbsp;&nbsp;&nbsp;`packages/core/src/` | 11 | 2,056 | 21 | Código del motor; schema.ts es el contrato de graph.json. |
| &nbsp;&nbsp;&nbsp;&nbsp;`packages/core/test/` | 2 | 126 | 2 | Pruebas sobre un repo multi-lenguaje generado al vuelo. |
| &nbsp;&nbsp;`packages/cli/` | 9 | 579 | 11 | Comando compass: map, diff, pr, insights, serve, export, init. |
| &nbsp;&nbsp;&nbsp;&nbsp;`packages/cli/src/` | 6 | 541 | 11 | Comandos, servidor local con API para los controles de la app y export HTML. |
| &nbsp;&nbsp;&nbsp;&nbsp;`packages/cli/scripts/` | 1 | 15 | 0 | Copia el build de la UI dentro del CLI. |
| `skill/` | 2 | 135 | 0 | Skill de Claude Code. |
| &nbsp;&nbsp;`skill/compass/` | 2 | 135 | 0 | SKILL.md y formato de insights.json. |
| &nbsp;&nbsp;&nbsp;&nbsp;`skill/compass/references/` | 1 | 49 | 0 |  |
| `scripts/` | 1 | 51 | 0 | Instalador (clona, construye, deja el comando y la skill). |
| `.github/` | 1 | 42 | 0 | CI: build y pruebas; en PRs publica el DiffMap como artefacto. |
| &nbsp;&nbsp;`.github/workflows/` | 1 | 42 | 0 |  |

## Puntos de entrada

- `packages/core/src/index.ts` — importado por 15 · importa 8 archivos · nombre de entrada
- `packages/web/src/App.tsx` — importado por 1 · importa 8 archivos · nombre de entrada
- `packages/cli/src/index.ts` — nadie lo importa · importa 5 archivos · nombre de entrada
- `packages/cli/src/server.ts` — importado por 2 · importa 3 archivos · nombre de entrada
- `packages/web/src/main.tsx` — nadie lo importa · importa 2 archivos · nombre de entrada

## Archivos más usados (hubs)

- `packages/core/src/index.ts` — importado/usado por 15 archivos
- `packages/core/src/schema.ts` — importado/usado por 7 archivos
- `packages/web/src/model/view.ts` — importado/usado por 5 archivos
- `packages/web/src/canvas/context.ts` — importado/usado por 4 archivos
- `packages/web/src/canvas/icons.tsx` — importado/usado por 4 archivos
- `packages/cli/src/store.ts` — importado/usado por 3 archivos
- `packages/core/src/config.ts` — importado/usado por 3 archivos
- `packages/core/src/parse/languages.ts` — importado/usado por 3 archivos
- `packages/web/src/api.ts` — importado/usado por 3 archivos
- `packages/cli/src/server.ts` — importado/usado por 2 archivos
- `packages/cli/src/run.ts` — importado/usado por 2 archivos
- `packages/core/src/git/git.ts` — importado/usado por 2 archivos

## Salud de la estructura

### Ciclos de imports (0)

Ninguno.

### Archivos sin dependencias (0)

Ninguno.

### Violaciones de reglas de arquitectura (0)

Ninguna (o no hay reglas en `compass.config.json`).
