import { dirname, join, normalize } from 'node:path/posix';
import type { ImportRef, ParsedFile } from './extract.js';

export interface ResolvedImport {
  target: string;
  imp: ImportRef;
  /** Java: visibilidad implícita del mismo paquete (no es un import escrito). */
  implicit?: boolean;
}

const JS_EXT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export interface TsPaths {
  baseUrl: string;
  paths: Record<string, string[]>;
}

/** Lee compilerOptions.baseUrl y paths de un tsconfig (tolera comentarios y comas finales). */
export function parseTsconfig(text: string | undefined, tsconfigDir: string): TsPaths | undefined {
  if (!text) return undefined;
  try {
    const clean = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:"'])\/\/.*$/gm, '$1')
      .replace(/,(\s*[}\]])/g, '$1');
    const json = JSON.parse(clean);
    const co = json.compilerOptions ?? {};
    if (!co.paths && !co.baseUrl) return undefined;
    return { baseUrl: normalize(join(tsconfigDir, co.baseUrl ?? '.')), paths: co.paths ?? {} };
  } catch {
    return undefined;
  }
}

export class Resolver {
  private files: Set<string>;
  private javaIndex = new Map<string, string>();
  private javaPackages = new Map<string, string[]>();

  private tsByDir = new Map<string, TsPaths>();

  /** El tsconfig más cercano que define alias para este archivo (subiendo carpetas hasta la raíz). */
  private tsFor(file: string): TsPaths | undefined {
    let d = dirname(file);
    for (;;) {
      const key = d === '.' ? '' : d;
      const hit = this.tsByDir.get(key);
      if (hit) return hit;
      if (!key) return undefined;
      d = dirname(d);
    }
  }

  /** Paquetes del propio repo (monorepo): nombre → directorio. */
  private workspace = new Map<string, { dir: string; entries: string[] }>();

  constructor(
    allFiles: Iterable<string>,
    parsed: Map<string, ParsedFile>,
    private sourceRoots: string[],
    ts?: TsPaths | Map<string, TsPaths>,
    packageJsons: Map<string, string> = new Map(),
  ) {
    this.files = new Set(allFiles);
    // tsconfig por directorio (monorepos: cada paquete tiene sus alias, p. ej. "@/*" en packages/web)
    if (ts instanceof Map) this.tsByDir = ts;
    else if (ts) this.tsByDir.set('', ts);
    for (const [path, text] of packageJsons) {
      try {
        const pkg = JSON.parse(text);
        if (!pkg.name) continue;
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        const raw = [pkg.source, pkg.types, pkg.typings, pkg.module, pkg.main, typeof pkg.exports === 'string' ? pkg.exports : pkg.exports?.['.']?.import ?? pkg.exports?.['.']?.default]
          .filter((x): x is string => typeof x === 'string');
        // dist/index.js → src/index.ts (los fuentes, no el build)
        const entries = [...raw.map((r) => r.replace(/^\.\//, '').replace(/^(dist|build|lib|out)\//, 'src/').replace(/\.d\.ts$/, '.ts')), 'src/index', 'index'];
        this.workspace.set(pkg.name, { dir, entries });
      } catch {
        /* package.json inválido */
      }
    }
    for (const pf of parsed.values()) {
      if (pf.language !== 'java') continue;
      const cls = pf.path.split('/').pop()!.replace(/\.java$/, '');
      const fq = pf.packageName ? `${pf.packageName}.${cls}` : cls;
      this.javaIndex.set(fq, pf.path);
      const pkg = pf.packageName ?? '';
      if (!this.javaPackages.has(pkg)) this.javaPackages.set(pkg, []);
      this.javaPackages.get(pkg)!.push(pf.path);
    }
  }

  resolve(pf: ParsedFile): ResolvedImport[] {
    const res: ResolvedImport[] = [];
    for (const imp of pf.imports) {
      const targets = this.resolveOne(pf, imp);
      for (const t of targets) if (t !== pf.path) res.push({ target: t, imp });
    }
    // Java: clases del mismo paquete son visibles sin import.
    if (pf.language === 'java') {
      const same = this.javaPackages.get(pf.packageName ?? '') ?? [];
      for (const t of same) {
        if (t === pf.path) continue;
        const cls = t.split('/').pop()!.replace(/\.java$/, '');
        res.push({ target: t, implicit: true, imp: { spec: `${pf.packageName ?? ''}.${cls}`, names: [{ local: cls, imported: cls }] } });
      }
    }
    return res;
  }

  private resolveOne(pf: ParsedFile, imp: ImportRef): string[] {
    if (pf.language === 'python') return this.resolvePy(pf, imp);
    if (pf.language === 'java') return this.resolveJava(imp);
    const r = this.resolveJs(pf.path, imp.spec);
    return r ? [r] : [];
  }

  private tryFile(base: string): string | undefined {
    const b = normalize(base).replace(/^\.\//, '');
    if (this.files.has(b)) return b;
    // './x.js' escrito en TS apunta a './x.ts'
    const noExt = b.replace(/\.(js|jsx|mjs|cjs)$/, '');
    for (const e of JS_EXT) if (this.files.has(noExt + e)) return noExt + e;
    for (const e of JS_EXT) if (this.files.has(`${b}/index${e}`)) return `${b}/index${e}`;
    return undefined;
  }

  private resolveJs(from: string, spec: string): string | undefined {
    if (spec.startsWith('.')) return this.tryFile(join(dirname(from), spec));
    if (spec.startsWith('/')) return this.tryFile(spec.slice(1));
    const ts = this.tsFor(from);
    if (ts) {
      for (const [pattern, targets] of Object.entries(ts.paths)) {
        const star = pattern.indexOf('*');
        let rest: string | undefined;
        if (star < 0) rest = pattern === spec ? '' : undefined;
        else {
          const pre = pattern.slice(0, star);
          const post = pattern.slice(star + 1);
          if (spec.startsWith(pre) && spec.endsWith(post)) rest = spec.slice(pre.length, spec.length - post.length);
        }
        if (rest === undefined) continue;
        for (const t of targets) {
          const hit = this.tryFile(join(ts.baseUrl, t.replace('*', rest)));
          if (hit) return hit;
        }
      }
      const viaBase = this.tryFile(join(ts.baseUrl, spec));
      if (viaBase) return viaBase;
    }
    // paquete del mismo monorepo: @org/pkg o @org/pkg/sub/ruta
    const parts = spec.split('/');
    const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    const ws = this.workspace.get(name);
    if (ws) {
      const sub = spec.slice(name.length).replace(/^\//, '');
      if (sub) return this.tryFile(join(ws.dir, sub)) ?? this.tryFile(join(ws.dir, 'src', sub));
      for (const e of ws.entries) {
        const hit = this.tryFile(join(ws.dir, e));
        if (hit) return hit;
      }
    }
    return undefined; // paquete externo (node_modules)
  }

  private pyModule(base: string): string | undefined {
    const b = normalize(base).replace(/^\.\//, '');
    if (this.files.has(`${b}.py`)) return `${b}.py`;
    if (this.files.has(`${b}/__init__.py`)) return `${b}/__init__.py`;
    return undefined;
  }

  private resolvePy(pf: ParsedFile, imp: ImportRef): string[] {
    const modPath = imp.spec.replace(/\./g, '/');
    const out: string[] = [];
    let bases: string[];
    if (imp.level && imp.level > 0) {
      let d = dirname(pf.path);
      for (let i = 1; i < imp.level; i++) d = dirname(d);
      bases = [d];
    } else {
      bases = this.sourceRoots;
    }
    for (const root of bases) {
      const base = modPath ? join(root, modPath) : root;
      const mod = this.pyModule(base);
      // from pkg import modulo → cada nombre puede ser un submódulo
      let anySub = false;
      for (const n of imp.names) {
        const sub = this.pyModule(join(base, n.imported));
        if (sub) {
          out.push(sub);
          anySub = true;
        }
      }
      if (mod && (!anySub || imp.names.length > 0)) out.push(mod);
      if (out.length) break;
    }
    return [...new Set(out)];
  }

  private resolveJava(imp: ImportRef): string[] {
    if (imp.wildcard) return this.javaPackages.get(imp.spec) ?? [];
    const hit = this.javaIndex.get(imp.spec);
    if (hit) return [hit];
    // import estático: paquete.Clase.metodo
    const parent = imp.spec.split('.').slice(0, -1).join('.');
    const p = this.javaIndex.get(parent);
    return p ? [p] : [];
  }
}
