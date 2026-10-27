---
name: compass
description: Mapa navegable de repos y diffs (Compass / DiffMap). Úsala sola al terminar cualquier cambio de código para sugerir insights de revisión; y cuando pidan visualizar, revisar o explicar un diff, PR o la estructura de un repo heredado o nuevo.
---

# Compass

Compass convierte un repositorio o un diff en un mapa con zoom semántico
(Architecture → Package → Module → Code). El CLI hace el análisis determinista
(git + tree-sitter); tú agregas el juicio: por dónde empezar, qué hace cada
módulo y qué riesgos hay. La app (`compass serve`) muestra ambos y se
actualiza sola cuando escribes insights.

## 0. Verifica la instalación

```bash
command -v compass || ls ~/.compass/packages/cli/dist/index.js
```

Si no existe, instala (una sola vez por máquina):

```bash
curl -fsSL https://raw.githubusercontent.com/CrisMtz99/Compass_DiffMap/main/scripts/install.sh | bash
```

Si el repo no tiene `compass.config.json`, corre `compass init` (detecta la rama base).

## 1. Elige el modo

| Situación | Comando |
| --- | --- |
| Terminaste cambios en esta sesión (por defecto, siempre) | `compass diff --json` (base configurada → árbol de trabajo) |
| Piden revisar un PR de GitHub | `compass pr <número o URL> --json` |
| Repo heredado o nuevo, o piden documentar/verificar estructura | `compass map --json` |
| Comparar dos ramas concretas | `compass diff --base <rama> -H <rama> --json` |

Si `compass diff` falla porque no existe la base, usa la rama de la que salió
el trabajo (`git merge-base --fork-point`, o pregunta). Si el diff sale vacío,
dilo y no inventes insights.

## 2. Lee los datos

```bash
compass insights --json
```

Te da `entryPoints`, `hotspots` (con `callers`/`callees`), `changed` (todos los
nodos cambiados con rango de líneas), y en modo map `cycles`, `orphans` y
`violations`. Los ids tienen la forma `ruta/archivo.ts#Clase.metodo`
(archivo = ruta, carpeta = `ruta/`, repo = `.`).

Para cada hotspot y los 3–5 entry points principales, **lee el código real**
(usa `range` para leer solo esas líneas). No resumas lo que no leíste.

## 3. Escribe los insights

Escribe `.compass/insights.json` (formato completo en `references/insights.md`):

```json
{
  "headSha": "<meta.headSha>",
  "reviewTour": [{ "step": 1, "nodeId": "src/x/index.ts#Engine.handleQueryResponse", "why": "Punto de entrada nuevo: todas las respuestas pasan por aquí" }],
  "summaries": { ".": "Qué cambió en una frase", "src/x/": "Qué hace este módulo" },
  "risks": [{ "nodeId": "src/x/api.ts#send", "risk": "Cambió la firma; 4 callers fuera del módulo" }]
}
```

Reglas:
- Solo ids que existan en `graph.json`. Valida con `compass insights --check .compass/insights.json` y corrige los errores.
- Diff/PR: `reviewTour` de 3–8 pasos, ordenado de entrada a detalle (hotspot → entry point → símbolo). `why` = una frase concreta.
- Map: `summaries` para cada carpeta de primer y segundo nivel + `.`; `risks` para ciclos, violaciones de reglas y archivos huérfanos que importen.
- `risks` solo con evidencia del código (contrato cambiado, efecto secundario, error no manejado, código muerto). Ninguno es válido.
- Escribe en el idioma del usuario.

## 4. Entrega

1. Si el usuario no la tiene abierta, ofrece `compass serve --open` (la app tiene controles para cambiar de modo, base o PR).
2. En el chat: el recorrido en ≤ 5 líneas y los riesgos, cada uno con su id. Nada más.
3. Modo map: si pidieron documentar, corre `compass map --doc docs/ARCHITECTURE.md` (incluye tus summaries) y menciona el archivo.
4. Para compartir con alguien sin Compass: `compass export -o compass-review.html` (un HTML autocontenido).

## Cuándo NO usarla

- Cambios de 1–3 archivos triviales (typos, config): una línea de resumen basta; no generes tour.
- Archivos que no son código (solo docs/assets).
