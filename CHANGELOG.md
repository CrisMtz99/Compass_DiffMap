# Changelog

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
