import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ChangeStatus, FileDiff, Hunk } from '../schema.js';

/** Ref especial: el árbol de trabajo actual (incluye cambios sin commitear y archivos nuevos). */
export const WORKTREE = 'WORKTREE';

export class Git {
  constructor(public readonly root: string) {}

  run(args: string[], opts: { allowFail?: boolean } = {}): string {
    try {
      // quotePath=false: rutas no ASCII (año.ts) tal cual, no "a\303\261o.ts"
      return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
        cwd: this.root,
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      if (opts.allowFail) return '';
      const err = e as { stderr?: string; message: string };
      throw new Error(`git ${args.join(' ')} falló: ${err.stderr?.trim() || err.message}`);
    }
  }

  static findRoot(cwd: string): string {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
  }

  isRepo(): boolean {
    return this.run(['rev-parse', '--is-inside-work-tree'], { allowFail: true }).trim() === 'true';
  }

  hasCommits(): boolean {
    return this.run(['rev-parse', '--verify', 'HEAD'], { allowFail: true }).trim().length > 0;
  }

  resolve(ref: string): string | undefined {
    if (ref === WORKTREE) return undefined;
    const out = this.run(['rev-parse', '--verify', `${ref}^{commit}`], { allowFail: true }).trim();
    return out || undefined;
  }

  refExists(ref: string): boolean {
    return ref === WORKTREE || !!this.resolve(ref);
  }

  /** Merge-base entre base y head (para comparar como lo hace un PR: base...head). */
  mergeBase(base: string, head: string): string {
    const h = head === WORKTREE ? 'HEAD' : head;
    const mb = this.run(['merge-base', base, h], { allowFail: true }).trim();
    return mb || base;
  }

  /** Lista de archivos en un ref, o en el árbol de trabajo (tracked + untracked no ignorados). */
  listFiles(ref: string): string[] {
    if (ref === WORKTREE) {
      const out = this.run(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
      const all = out.split('\0').filter(Boolean);
      // ls-files --cached incluye archivos borrados en el worktree; los filtramos.
      return [...new Set(all)].filter((f) => {
        try {
          return statSync(join(this.root, f)).isFile();
        } catch {
          return false;
        }
      });
    }
    return this.run(['ls-tree', '-r', '--name-only', '-z', ref]).split('\0').filter(Boolean);
  }

  readFile(ref: string, path: string): string | undefined {
    if (ref === WORKTREE) {
      try {
        return readFileSync(join(this.root, path), 'utf8');
      } catch {
        return undefined;
      }
    }
    try {
      return execFileSync('git', ['show', `${ref}:${path}`], {
        cwd: this.root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return undefined;
    }
  }

  fileSize(ref: string, path: string): number {
    if (ref === WORKTREE) {
      try {
        return statSync(join(this.root, path)).size;
      } catch {
        return 0;
      }
    }
    const out = this.run(['cat-file', '-s', `${ref}:${path}`], { allowFail: true }).trim();
    return Number(out) || 0;
  }

  /** Diff base→head con hunks de contexto 0, detectando renombres. */
  diff(base: string, head: string): FileDiff[] {
    const args = ['diff', '--no-color', '--no-ext-diff', '--unified=0', '-M', '--src-prefix=a/', '--dst-prefix=b/', base];
    if (head !== WORKTREE) args.push(head);
    const out = this.run(args);
    const diffs = parseUnifiedDiff(out);
    if (head === WORKTREE) {
      // Archivos nuevos sin trackear: git diff no los ve.
      const untracked = this.run(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
      for (const f of untracked) {
        if (diffs.some((d) => d.path === f)) continue;
        const text = this.readFile(WORKTREE, f);
        if (text === undefined) continue;
        const lines = splitLines(text);
        diffs.push({
          path: f,
          status: 'added',
          added: lines.length,
          removed: 0,
          hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: lines.map((l) => '+' + l) }],
        });
      }
    }
    return diffs;
  }

  /**
   * Lee muchos archivos de un ref con un solo proceso (`git cat-file --batch`).
   * Devuelve path → contenido (undefined si no existe o supera maxBytes).
   */
  readMany(ref: string, files: string[], maxBytes = Infinity): Map<string, string | undefined> {
    const out = new Map<string, string | undefined>();
    if (ref === WORKTREE) {
      for (const f of files) out.set(f, this.fileSize(ref, f) > maxBytes ? undefined : this.readFile(ref, f));
      return out;
    }
    const CHUNK = 2000;
    for (let i = 0; i < files.length; i += CHUNK) {
      const part = files.slice(i, i + CHUNK);
      const res = spawnSync('git', ['cat-file', '--batch'], {
        cwd: this.root,
        input: part.map((f) => `${ref}:${f}`).join('\n') + '\n',
        maxBuffer: 1024 * 1024 * 1024,
      });
      const buf = res.stdout;
      let pos = 0;
      for (const f of part) {
        const nl = buf.indexOf(10, pos);
        if (nl < 0) break;
        const header = buf.subarray(pos, nl).toString();
        pos = nl + 1;
        const m = /^[0-9a-f]+ (\w+) (\d+)$/.exec(header);
        if (!m) {
          out.set(f, undefined); // "missing"
          continue;
        }
        const size = Number(m[2]);
        const body = buf.subarray(pos, pos + size);
        pos += size + 1;
        out.set(f, m[1] === 'blob' && size <= maxBytes ? body.toString('utf8') : undefined);
      }
    }
    return out;
  }

  remoteUrl(): string | undefined {
    return this.run(['remote', 'get-url', 'origin'], { allowFail: true }).trim() || undefined;
  }

  fetch(remote: string, refspec: string): void {
    this.run(['fetch', '--no-tags', remote, refspec]);
  }
}

export function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Ruta tal como la escribe git: si tiene comillas, `\` o caracteres de control (o no es ASCII
 * con quotePath activo), va entre comillas con escapes de C y bytes UTF-8 en octal.
 */
export function unquotePath(p: string): string {
  if (p.length < 2 || !p.startsWith('"') || !p.endsWith('"')) return p;
  const esc: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
  const bytes: number[] = [];
  for (let i = 1; i < p.length - 1; i++) {
    if (p[i] !== '\\') {
      bytes.push(...Buffer.from(p[i], 'utf8'));
      continue;
    }
    const n = p[++i];
    if (/[0-7]/.test(n)) {
      bytes.push(parseInt(p.slice(i, i + 3), 8));
      i += 2;
    } else bytes.push(esc[n] ?? n.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Parser de `git diff` unificado. */
export function parseUnifiedDiff(out: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | null = null;
  let hunk: Hunk | null = null;
  const lines = out.split('\n');
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git ("(?:[^"\\]|\\.)*"|a\/.*) ("(?:[^"\\]|\\.)*"|b\/.*)$/.exec(line);
      const a = m ? unquotePath(m[1]).slice(2) : '';
      const b = m ? unquotePath(m[2]).slice(2) : '';
      cur = { path: b, status: 'modified', added: 0, removed: 0, hunks: [] };
      if (a !== b) cur.oldPath = a;
      files.push(cur);
      hunk = null;
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('new file mode')) cur.status = 'added';
    else if (line.startsWith('deleted file mode')) cur.status = 'deleted';
    else if (line.startsWith('rename from ')) cur.oldPath = unquotePath(line.slice('rename from '.length));
    else if (line.startsWith('rename to ')) cur.path = unquotePath(line.slice('rename to '.length));
    else if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      // las rutas ya salen del encabezado diff --git
    } else if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m) {
        hunk = {
          oldStart: Number(m[1]),
          oldLines: m[2] === undefined ? 1 : Number(m[2]),
          newStart: Number(m[3]),
          newLines: m[4] === undefined ? 1 : Number(m[4]),
          lines: [],
        };
        cur.hunks.push(hunk);
      }
    } else if (hunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      hunk.lines.push(line);
      if (line.startsWith('+')) cur.added++;
      else if (line.startsWith('-')) cur.removed++;
    }
  }
  return files.filter((f) => f.path);
}

/** Conjunto de líneas (head) agregadas, y posiciones (head) donde hubo borrados. */
export function changedLineSets(fd: FileDiff): { addedNew: Set<number>; removedOld: Set<number>; deletionPoints: number[] } {
  const addedNew = new Set<number>();
  const removedOld = new Set<number>();
  const deletionPoints: number[] = [];
  for (const h of fd.hunks) {
    let n = h.newStart;
    let o = h.oldStart;
    let sawRemoval = false;
    for (const l of h.lines) {
      if (l.startsWith('+')) addedNew.add(n++);
      else if (l.startsWith('-')) {
        removedOld.add(o++);
        sawRemoval = true;
      } else {
        n++;
        o++;
      }
    }
    // En un hunk de solo borrado, newStart es la línea anterior al borrado (convención de git).
    if (sawRemoval) deletionPoints.push(Math.max(1, h.newStart));
  }
  return { addedNew, removedOld, deletionPoints };
}

export function statusFromLetter(s: string): ChangeStatus {
  if (s === 'A') return 'added';
  if (s === 'D') return 'deleted';
  return 'modified';
}
