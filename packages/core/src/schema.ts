/**
 * Contrato de Compass: el archivo graph.json que produce el motor
 * y que consumen la UI, el export estático y la skill.
 */

export const SCHEMA_VERSION = 1;

export type NodeKind =
  | 'repo'
  | 'directory'
  | 'file'
  | 'class'
  | 'interface'
  | 'enum'
  | 'type'
  | 'function'
  | 'method'
  | 'property';

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'unchanged';

export type Mode = 'map' | 'diff' | 'pr';

export interface NodeStats {
  /** Líneas agregadas dentro del nodo (o su subárbol). */
  added: number;
  /** Líneas borradas dentro del nodo (o su subárbol). */
  removed: number;
  /** Hijos directos o descendientes con status added. */
  addedChildren: number;
  /** Descendientes con status modified. */
  modifiedChildren: number;
  /** Descendientes con status deleted. */
  deletedChildren: number;
  /** Aristas que entran o salen del subárbol. */
  deps: number;
  /** Archivos dentro del subárbol (solo directorios/repo). */
  files: number;
  /** Líneas totales del nodo (tamaño). */
  lines: number;
}

export interface DiffNode {
  id: string;
  kind: NodeKind;
  name: string;
  /** Ruta del archivo relativa al repo (para directorios, la ruta del directorio). */
  path: string;
  parentId: string | null;
  language?: string;
  /** Rango de líneas (1-based, inclusivo) en la versión head (o base si está borrado). */
  range?: { start: number; end: number };
  status: ChangeStatus;
  stats: NodeStats;
  signature?: string;
  exported?: boolean;
}

export type EdgeKind = 'import' | 'call' | 'extends';

export interface DiffEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  /** La arista toca al menos un nodo cambiado. */
  changed: boolean;
  /** Número de referencias que agrupa. */
  weight: number;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Líneas con prefijo '+', '-' o ' '. */
  lines: string[];
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: ChangeStatus;
  added: number;
  removed: number;
  hunks: Hunk[];
}

export interface Insight {
  id: string;
  score: number;
  reason: string;
}

export interface Cycle {
  files: string[];
}

export interface RuleViolation {
  rule: string;
  source: string;
  target: string;
}

export interface Insights {
  /** Símbolos o archivos por donde conviene entrar. */
  entryPoints: Insight[];
  /** Nodos por donde pasan más cambios (diff) o más dependencias (map). */
  hotspots: Insight[];
  /** Solo modo map: ciclos de imports entre archivos. */
  cycles?: Cycle[];
  /** Solo modo map: archivos sin aristas. */
  orphans?: string[];
  /** Violaciones de reglas de arquitectura declaradas en la configuración. */
  violations?: RuleViolation[];
  languages?: Record<string, number>;
  /** Escrito por la skill: recorrido de revisión en orden. */
  reviewTour?: { step: number; nodeId: string; why: string }[];
  /** Escrito por la skill: un resumen por nodo. */
  summaries?: Record<string, string>;
  /** Escrito por la skill: riesgos concretos. */
  risks?: { nodeId: string; risk: string }[];
}

export interface GraphMeta {
  schemaVersion: number;
  tool: string;
  mode: Mode;
  repo: string;
  root: string;
  base?: string;
  head: string;
  baseSha?: string;
  headSha?: string;
  pr?: { provider: 'github' | 'gitlab'; number: number; title: string; url: string; author?: string };
  generatedAt: string;
  durationMs?: number;
}

export interface DiffGraph {
  meta: GraphMeta;
  nodes: DiffNode[];
  edges: DiffEdge[];
  files: Record<string, FileDiff>;
  insights: Insights;
  /** Código fuente embebido (solo en export estático). */
  sources?: Record<string, string>;
}
