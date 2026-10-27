# Compass

**Mapa navegable de repositorios y diffs.** Compass convierte un repo, un diff o un pull request en cajas anidadas con zoom semántico — *Architecture → Package → Module → Code* — para que veas por dónde pasan los cambios antes de leer una sola línea. **DiffMap** es el concepto: revisar código (sobre todo el que escribe la IA) como un mapa y no como una lista de 70 archivos.

Inspirado en un reel de graphicule.dev ("AI code diffs are a nightmare"); esta es una implementación propia.

## Tres modos

| Modo | Cuándo | Comando |
| --- | --- | --- |
| **Map** | Heredas o creas un repo: documentar y verificar la estructura | `compass map --doc docs/ARCHITECTURE.md` |
| **Diff** | Desarrollo, debugging y mantenimiento | `compass diff` (base configurada → árbol de trabajo) |
| **PR** | Revisar un pull request de GitHub (GitLab después) | `compass pr 905` o `compass pr <url>` |

`compass serve --open` abre la app con controles para los tres modos. Dentro de Claude Code, la skill [`compass`](skill/compass/SKILL.md) corre el análisis al terminar cada cambio y agrega un **recorrido de revisión**, **resúmenes** y **riesgos** que la app muestra al instante.

## Qué ves en la app

- **Cajas anidadas** carpeta → archivo → clase → método, con punto de estado (verde nuevo, ámbar modificado, rojo borrado, gris sin cambios) y métricas `+agregadas −borradas ✎modificados ⌫borrados ⇄dependencias`.
- **Zoom semántico**: Architecture (carpetas y archivos), Package (archivos con sus símbolos), Module (miembros de cada clase con sus llamadas), Code (el código de cada método con las líneas del diff).
- **Tarjeta al pasar el mouse**: *Explore* (aislar y bajar un nivel), *Callers*, *Dependencies*, ver código. Doble clic = Explore.
- **Exact / With Context**: solo lo que cambió, o lo que cambió más sus vecinos directos; el resto se agrupa en "+N sin cambios".
- **Insights**: hotspots (por dónde pasa el % de dependencias cambiadas), entry points, y en modo map hubs, ciclos de imports, archivos huérfanos y violaciones de reglas de arquitectura.
- **Panel de código** con callers/callees y el diff del símbolo.
- **Export**: `compass export` genera un único HTML autocontenido para adjuntar a un PR.

Probado sobre el PR del video ([typedb-studio#905](https://github.com/typedb/typedb-studio/pull/905), 70 archivos): Compass encuentra la misma base (`e16ecf6659`), señala `src/framework/graph-visualiser/` como el hotspot principal (46% de las dependencias cambiadas) y `handleQueryResponse` con sus +4 líneas.

## Instalación

Requiere Node 20+ y git.

```bash
curl -fsSL https://raw.githubusercontent.com/CrisMtz99/Compass_DiffMap/main/scripts/install.sh | bash
```

Instala en `~/.compass`, deja `compass` en `~/.local/bin` y copia la skill a `~/.claude/skills/compass`. Con `COMPASS_SKILL=project` la copia al `.claude/skills/` del repo actual.

Desde el código:

```bash
pnpm install && pnpm build
node packages/cli/dist/index.js --help
```

## Uso

```bash
cd mi-repo
compass init                      # crea compass.config.json (detecta la rama base)
compass map --doc                 # mapa completo + .compass/ARCHITECTURE.md
compass diff                      # tus cambios contra la base (incluye lo no commiteado)
compass diff --base develop -H feature/x
compass pr 123                    # usa GITHUB_TOKEN si existe; sin API, trae pull/123/head por git
compass insights                  # resumen en consola; --json para la skill
compass serve --open              # la app, en http://127.0.0.1:4777
compass export -o review.html
```

Todo se escribe en `.compass/` (con su propio `.gitignore`).

### Configuración (`compass.config.json`)

```json
{
  "$schema": "https://raw.githubusercontent.com/CrisMtz99/Compass_DiffMap/main/compass.schema.json",
  "base": "origin/develop",
  "exclude": ["**/migrations/**"],
  "languages": ["typescript", "tsx", "javascript", "python", "java"],
  "rules": [
    { "name": "la UI no toca la base de datos", "from": "src/ui/**", "disallow": "src/db/**" }
  ]
}
```

Ver [`compass.schema.json`](compass.schema.json) para todas las opciones.

## Lenguajes

TypeScript/TSX, JavaScript, Python y Java con símbolos, imports (alias de `tsconfig`, imports relativos de Python, paquetes de Java) y llamadas. HTML, CSS/SCSS, JSON, YAML, SQL y otros aparecen como archivos sin símbolos.

Agregar uno nuevo: el paquete `tree-sitter-wasms` ya trae Go, Rust, PHP, C#, Kotlin, Ruby y más. Se agrega su definición en [`languages.ts`](packages/core/src/parse/languages.ts) y un extractor en [`extract.ts`](packages/core/src/parse/extract.ts).

## Arquitectura

```text
packages/
  core/   motor: git → tree-sitter → mapeo hunks→símbolos → grafo + rollup → insights   (sin UI)
  cli/    compass map | diff | pr | insights | serve | export | init
  web/    React + React Flow + ELK + highlight.js, compilado a un solo index.html
skill/compass/   skill de Claude Code (SKILL.md + formato de insights)
scripts/install.sh
```

El contrato entre todo es `.compass/graph.json` ([`schema.ts`](packages/core/src/schema.ts)); la skill escribe aparte `.compass/insights.json` ([formato](skill/compass/references/insights.md)) y Compass lo fusiona validando los ids. La estructura de este mismo repo, generada por Compass, está en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Desarrollo

```bash
pnpm install
pnpm build          # core → web → cli (el CLI empaqueta la UI)
pnpm test           # pruebas del motor sobre un repo multi-lenguaje generado
pnpm dev:web        # UI con recarga; corre `compass serve` en otra terminal (proxy a :4777)
```

## Roadmap

- [x] Motor multi-lenguaje (TS/JS, Python, Java), modos map/diff/pr, insights, reglas de arquitectura
- [x] App con zoom semántico, Explore/Callers/Dependencies, Exact/With Context, panel de código, export HTML
- [x] Skill de Claude Code con recorrido, resúmenes y riesgos
- [ ] Merge requests de GitLab (`compass mr <iid>`)
- [ ] Más lenguajes (Go, C#, Kotlin, PHP…)
- [ ] Comentarios sobre nodos sincronizados con el PR/MR
- [ ] Layout en Web Worker y render WebGL para repos muy grandes
- [ ] App de escritorio (Tauri)
