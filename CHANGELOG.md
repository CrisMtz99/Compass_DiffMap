# Changelog

## Sin publicar · Windows

- **`compass serve --open` abre el navegador en Windows**: usa `cmd /c start "" <url>` (`start` es un comando interno de cmd y `execFile('start')` fallaba en silencio). macOS y Linux siguen con `open` / `xdg-open`.
- **Fix: archivos con acentos o `ñ` desaparecían del diff** (en cualquier sistema). git entrecomilla esas rutas (`"a/src/a\303\261o.ts"`) y el parser no las reconocía: el archivo salía como sin cambios. Compass corre git con `core.quotePath=false` y desentrecomilla las rutas que git sigue citando (comillas, `\`, caracteres de control). Los ids de nodo siguen siendo siempre con `/`, también en Windows.
- **Pruebas en Windows**: los repos del fixture fijan `core.autocrlf=false`, así que el resultado ya no depende de la configuración global de git (Git for Windows trae `true`). `pnpm test` pasa en Windows (Node 22+, que expande el glob `test/*.test.ts` por sí mismo).

## 0.2.2 — 2026-10-27 · Primer repo real (facturador)

- **Alias de tsconfig por paquete**: en monorepos cada archivo usa el `tsconfig.json` (o `tsconfig.app.json`) más cercano, p. ej. `"@/*": ["./src/*"]` de `packages/web`. Antes solo se leía el de la raíz y los imports con `@/` quedaban sin resolver (componentes marcados como huérfanos).
- **Código de pruebas fuera de los entry points**: llamadas desde tests, `e2e/`, fixtures y mocks no cuentan como "llamado desde fuera", y los fixtures cambiados no aparecen como punto de entrada.

## 0.2.1 — 2026-10-27 · Panel de código

- **Panel de código redimensionable**: arrastrando su borde izquierdo, entre 380 px y el 70% de la ventana; doble clic restablece, ⤢ amplía al máximo. El ancho se recuerda.
- **Ajustar líneas** (por defecto): las líneas largas se parten dentro del panel con sangría colgante, en Código y en Diff; el diff ahora también lleva resaltado de sintaxis.
- **Fix de llamadas entre archivos**: una función de nivel superior no exportada ya no se enlaza desde otro archivo solo porque comparte nombre (p. ej. dos `load()` distintas).
- Los controles de la barra superior ya no se parten en dos renglones cuando el panel es ancho.

## 0.2.0 — 2026-10-27 · Vista legible

Rediseño de la app tras comparar con la referencia: la v0.1 encuadraba el árbol completo y dibujaba todas las aristas, y en PRs grandes era ilegible. Detalle y capturas en [docs/GUIA-UI.md](docs/GUIA-UI.md#por-qué-se-ve-así).

- **Cámara inicial a escala legible**: si todo no cabe, centra el primer paso del recorrido o el hotspot principal; el resto queda en el minimapa.
- **Nivel de detalle según el zoom**: de lejos, etiquetas grandes de módulos (solo donde caben) y archivos como barras de color; de cerca, todo.
- **Aristas bajo demanda**: selector *Al pasar / Cambiadas / Todas*; automático según si hay un módulo aislado. Pasan por detrás de las fichas.
- **Estado solo por el punto**: bordes neutros, fondo por profundidad, borde punteado para lo que no cambió.
- **With Context** también agrupa en "+N sin cambios" los símbolos sin relación dentro de archivos que no son el foco.
- **Barra superior en dos franjas**: navegación y filtros arriba; PR o comparación, ruta y aislamiento abajo.
- **Panel de insights más corto**: listas de 5 con "ver más", una o dos líneas por razón, secciones plegables.
- Los nombres de los símbolos ya no se cortan.

## 0.1.0 — 2026-10-27 · Primera versión

- Motor (`@compass/core`): git + tree-sitter para TS/TSX, JS, Python y Java; estados por archivo y por símbolo; imports (relativos, alias de tsconfig, paquetes del monorepo, Python, Java) y llamadas; rollup; insights (hotspots, entry points, ciclos, huérfanos, reglas de arquitectura); ARCHITECTURE.md.
- CLI: `compass map | diff | pr | insights | serve | export | init`. `pr` usa la API de GitHub y, sin ella, trae `pull/N/head` por git.
- App: cuatro niveles, Explore / Callers / Dependencies, Exact / With Context, panel de código, controles para analizar desde la app, export a un solo HTML.
- Skill `compass` para Claude Code: recorrido de revisión, resúmenes y riesgos sugeridos al terminar cada cambio.
- Instalador, CI y `docs/ARCHITECTURE.md` generado por Compass sobre sí mismo.
