# Formato de `.compass/insights.json`

Lo escribe la skill (o cualquier herramienta); Compass lo fusiona con
`graph.json` al leerlo, valida los ids y descarta lo inválido.

```ts
interface ExternalInsights {
  /** meta.headSha del análisis al que corresponde. Si no coincide, se ignora (salvo head = WORKTREE). */
  headSha?: string;
  /** Recorrido de revisión. Se muestra numerado en la app y con insignias sobre los nodos. */
  reviewTour?: { step: number; nodeId: string; why: string }[];
  /** Una frase por nodo. "." = resumen general. En modo map alimenta la columna Descripción de ARCHITECTURE.md. */
  summaries?: Record<string, string>;
  /** Riesgos concretos; se muestran en la tarjeta del nodo y en el panel de insights. */
  risks?: { nodeId: string; risk: string }[];
}
```

## Ids de nodo

| Tipo | Forma | Ejemplo |
| --- | --- | --- |
| Repo | `.` | `.` |
| Carpeta | `ruta/` | `src/framework/graph-visualiser/` |
| Archivo | `ruta` | `src/framework/graph-visualiser/index.ts` |
| Símbolo | `ruta#Calificado` | `src/framework/graph-visualiser/index.ts#GraphVisualiser.reLayout` |

Sobrecargas (Java/TS) llevan sufijo `~2`, `~3`.

## Ejemplo (diff)

```json
{
  "headSha": "f1d3e5be3f13982a94bd0a3806de999c8c026633",
  "reviewTour": [
    { "step": 1, "nodeId": "src/framework/graph-visualiser/", "why": "46% de las dependencias cambiadas pasan por aquí: empieza por este módulo" },
    { "step": 2, "nodeId": "src/framework/graph-visualiser/index.ts#GraphVisualiser", "why": "Entry point: lo usan 2 módulos y cambió +403 −128" },
    { "step": 3, "nodeId": "src/framework/graph-visualiser/index.ts#GraphVisualiser.reLayout", "why": "Ahora reinicia posiciones al azar y recentra la cámara" }
  ],
  "summaries": {
    ".": "Rediseño del visualizador de grafos: nuevo motor de layout, estilos por tipo y controles de zoom",
    "src/framework/graph-styles-pane/": "Panel nuevo para editar estilos de nodos y aristas"
  },
  "risks": [
    { "nodeId": "src/framework/graph-visualiser/index.ts#GraphVisualiser.reLayout", "risk": "Math.random() hace el layout no determinista entre recargas" }
  ]
}
```
