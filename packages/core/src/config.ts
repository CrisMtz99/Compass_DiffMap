import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ArchitectureRule {
  /** Nombre legible de la regla. */
  name: string;
  /** Glob de los archivos origen. */
  from: string;
  /** Glob de los archivos que el origen no puede importar. */
  disallow: string;
}

export interface CompassConfig {
  /** Rama/commit base para el modo diff. */
  base: string;
  /** Commit head. 'WORKTREE' = cambios sin commitear incluidos. */
  head: string;
  include: string[];
  exclude: string[];
  /** Lenguajes a analizar (ids de languages.ts). */
  languages: string[];
  /** Carpetas raíz de código para resolver imports absolutos de Python/Java. */
  sourceRoots: string[];
  tsconfig: string;
  maxFiles: number;
  maxFileBytes: number;
  scoring: { hotspotTop: number; entryTop: number; weightLines: number; weightEdges: number };
  rules: ArchitectureRule[];
  github: { tokenEnv: string; repo?: string };
  gitlab: { url?: string; projectId?: string | number; tokenEnv: string };
  output: string;
  port: number;
}

export const DEFAULT_CONFIG: CompassConfig = {
  base: 'origin/main',
  head: 'WORKTREE',
  include: ['**/*'],
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/out/**',
    '**/target/**',
    '**/.next/**',
    '**/coverage/**',
    '**/vendor/**',
    '**/__pycache__/**',
    '**/.venv/**',
    '**/venv/**',
    '**/*.min.js',
    '**/*.d.ts',
    '**/.compass/**',
  ],
  languages: ['typescript', 'tsx', 'javascript', 'python', 'java'],
  sourceRoots: ['.', 'src', 'src/main/java', 'lib', 'app'],
  tsconfig: 'tsconfig.json',
  maxFiles: 8000,
  maxFileBytes: 512_000,
  scoring: { hotspotTop: 6, entryTop: 10, weightLines: 0.3, weightEdges: 0.7 },
  rules: [],
  github: { tokenEnv: 'GITHUB_TOKEN' },
  gitlab: { tokenEnv: 'GITLAB_TOKEN' },
  output: '.compass',
  port: 4777,
};

export const CONFIG_FILES = ['compass.config.json', '.compassrc.json'];

export function loadConfig(root: string, overrides: Partial<CompassConfig> = {}): CompassConfig {
  let fileCfg: Partial<CompassConfig> = {};
  for (const name of CONFIG_FILES) {
    const p = join(root, name);
    if (existsSync(p)) {
      fileCfg = JSON.parse(readFileSync(p, 'utf8'));
      break;
    }
  }
  const merged: CompassConfig = {
    ...DEFAULT_CONFIG,
    ...fileCfg,
    ...stripUndefined(overrides),
    scoring: { ...DEFAULT_CONFIG.scoring, ...(fileCfg.scoring ?? {}), ...(overrides.scoring ?? {}) },
    github: { ...DEFAULT_CONFIG.github, ...(fileCfg.github ?? {}) },
    gitlab: { ...DEFAULT_CONFIG.gitlab, ...(fileCfg.gitlab ?? {}) },
  };
  // Los excludes del usuario se suman a los default, no los reemplazan.
  if (fileCfg.exclude) merged.exclude = [...new Set([...DEFAULT_CONFIG.exclude, ...fileCfg.exclude])];
  return merged;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
