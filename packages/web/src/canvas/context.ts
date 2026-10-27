import { createContext, useContext } from 'react';
import type { DiffGraph } from '@compass/core';
import type { Index } from '../model/view';

export interface Trace {
  nodeId: string;
  dir: 'callers' | 'deps';
  /** ids visibles relacionados (incluye el propio). */
  related: Set<string>;
  edges: Set<string>;
}

export interface CanvasCtx {
  graph: DiffGraph;
  idx: Index;
  hover: string | null;
  setHover: (id: string | null) => void;
  trace: Trace | null;
  explore: (id: string) => void;
  showTrace: (id: string, dir: 'callers' | 'deps') => void;
  select: (id: string) => void;
  selected: string | null;
  /** Nodos en el recorrido de la skill: id → número de paso. */
  tourSteps: Map<string, number>;
}

export const Ctx = createContext<CanvasCtx | null>(null);
export const useCanvas = () => useContext(Ctx)!;
