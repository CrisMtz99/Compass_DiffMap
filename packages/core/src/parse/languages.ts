import { extname } from 'node:path';

export interface LanguageDef {
  id: string;
  /** Nombre del .wasm en tree-sitter-wasms/out (sin prefijo ni extensión). */
  grammar: string;
  extensions: string[];
  family: 'js' | 'python' | 'java';
}

/**
 * Lenguajes soportados. Para agregar uno nuevo:
 * 1. Agregar su definición aquí (el paquete tree-sitter-wasms ya trae go, rust, php, c_sharp, kotlin, ruby…).
 * 2. Agregar un extractor en extract.ts para su `family`.
 */
export const LANGUAGES: LanguageDef[] = [
  { id: 'typescript', grammar: 'typescript', extensions: ['.ts', '.mts', '.cts'], family: 'js' },
  { id: 'tsx', grammar: 'tsx', extensions: ['.tsx'], family: 'js' },
  { id: 'javascript', grammar: 'javascript', extensions: ['.js', '.jsx', '.mjs', '.cjs'], family: 'js' },
  { id: 'python', grammar: 'python', extensions: ['.py'], family: 'python' },
  { id: 'java', grammar: 'java', extensions: ['.java'], family: 'java' },
];

/** Archivos que no parseamos pero sí mostramos en el mapa (como hojas). */
export const PASSIVE_EXTENSIONS: Record<string, string> = {
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.less': 'less',
  '.json': 'json',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.md': 'markdown',
  '.sql': 'sql',
  '.xml': 'xml',
  '.gradle': 'gradle',
  '.toml': 'toml',
  '.sh': 'shell',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.go': 'go',
  '.rs': 'rust',
  '.php': 'php',
  '.cs': 'csharp',
  '.kt': 'kotlin',
  '.rb': 'ruby',
};

const BY_EXT = new Map<string, LanguageDef>();
for (const l of LANGUAGES) for (const e of l.extensions) BY_EXT.set(e, l);

export function languageFor(path: string, enabled: string[]): LanguageDef | undefined {
  const l = BY_EXT.get(extname(path).toLowerCase());
  return l && enabled.includes(l.id) ? l : undefined;
}

export function passiveLanguage(path: string): string | undefined {
  const base = path.split('/').pop() ?? '';
  if (base === 'Dockerfile') return 'docker';
  return PASSIVE_EXTENSIONS[extname(path).toLowerCase()];
}
