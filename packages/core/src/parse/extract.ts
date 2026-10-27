import { createRequire } from 'node:module';
import type { NodeKind } from '../schema.js';
import { LANGUAGES, type LanguageDef } from './languages.js';

const require = createRequire(import.meta.url);
// web-tree-sitter 0.20 es CommonJS.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Parser: any = require('web-tree-sitter');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;

export interface ParsedSymbol {
  name: string;
  /** Nombre calificado dentro del archivo: Clase.metodo */
  qualified: string;
  kind: NodeKind;
  start: number;
  end: number;
  signature: string;
  exported: boolean;
  parent?: string;
  extends: string[];
}

export interface CallRef {
  /** Símbolo calificado que hace la llamada; undefined = nivel de módulo. */
  from?: string;
  name: string;
  /** La llamada es this.x() / self.x() → preferir el miembro de la misma clase. */
  onSelf: boolean;
  line: number;
}

export interface ImportRef {
  spec: string;
  /** Nombres locales que introduce (para resolver llamadas). */
  names: { local: string; imported: string }[];
  /** Python: número de puntos del import relativo. */
  level?: number;
  wildcard?: boolean;
}

export interface ParsedFile {
  path: string;
  language: string;
  lines: number;
  symbols: ParsedSymbol[];
  imports: ImportRef[];
  calls: CallRef[];
  /** Java: package declarado. */
  packageName?: string;
  parseError?: string;
}

let initPromise: Promise<void> | null = null;
const loaded = new Map<string, unknown>();

async function getParser(lang: LanguageDef): Promise<TSNode> {
  if (!initPromise) initPromise = Parser.init();
  await initPromise;
  if (!loaded.has(lang.grammar)) {
    const wasm = require.resolve(`tree-sitter-wasms/out/tree-sitter-${lang.grammar}.wasm`);
    loaded.set(lang.grammar, await Parser.Language.load(wasm));
  }
  const p = new Parser();
  p.setLanguage(loaded.get(lang.grammar));
  return p;
}

export async function parseSource(path: string, source: string, lang: LanguageDef): Promise<ParsedFile> {
  const lines = source.length === 0 ? 0 : source.split('\n').length;
  const out: ParsedFile = { path, language: lang.id, lines, symbols: [], imports: [], calls: [] };
  let parser: TSNode;
  try {
    parser = await getParser(lang);
    const tree = parser.parse(source);
    const ctx: Ctx = { out, stack: [] };
    if (lang.family === 'js') walkJs(tree.rootNode, ctx);
    else if (lang.family === 'python') walkPy(tree.rootNode, ctx);
    else if (lang.family === 'java') walkJava(tree.rootNode, ctx);
    tree.delete?.();
  } catch (e) {
    out.parseError = (e as Error).message;
  } finally {
    parser?.delete?.();
  }
  return out;
}

export function languageById(id: string): LanguageDef | undefined {
  return LANGUAGES.find((l) => l.id === id);
}

// ───────────────────────── utilidades ─────────────────────────

interface Ctx {
  out: ParsedFile;
  stack: ParsedSymbol[];
}

const line = (n: TSNode) => n.startPosition.row + 1;
const endLine = (n: TSNode) => n.endPosition.row + 1;

function signatureOf(n: TSNode): string {
  const first = String(n.text).split('\n')[0];
  let s = first.replace(/\s*[{:]\s*$/, '').trim();
  if (s.length > 140) s = s.slice(0, 137) + '…';
  return s;
}

function addSymbol(ctx: Ctx, n: TSNode, name: string, kind: NodeKind, exported: boolean, ext: string[] = []): ParsedSymbol {
  const parent = ctx.stack[ctx.stack.length - 1];
  const sym: ParsedSymbol = {
    name,
    qualified: parent ? `${parent.qualified}.${name}` : name,
    kind,
    start: line(n),
    end: endLine(n),
    signature: signatureOf(n),
    exported,
    parent: parent?.qualified,
    extends: ext,
  };
  // Evita duplicados exactos (sobrecargas Java / TS): agrega sufijo.
  let q = sym.qualified;
  let i = 2;
  while (ctx.out.symbols.some((s) => s.qualified === q)) q = `${sym.qualified}~${i++}`;
  sym.qualified = q;
  ctx.out.symbols.push(sym);
  return sym;
}

function within(ctx: Ctx, sym: ParsedSymbol, fn: () => void) {
  ctx.stack.push(sym);
  try {
    fn();
  } finally {
    ctx.stack.pop();
  }
}

function addCall(ctx: Ctx, name: string | undefined, onSelf: boolean, n: TSNode) {
  if (!name) return;
  const from = ctx.stack[ctx.stack.length - 1]?.qualified;
  ctx.out.calls.push({ from, name, onSelf, line: line(n) });
}

const unquote = (s: string) => s.replace(/^['"`]|['"`]$/g, '');

// ───────────────────────── JS / TS ─────────────────────────

function isExportedJs(n: TSNode): boolean {
  const p = n.parent;
  if (!p) return false;
  if (p.type === 'export_statement') return true;
  // const f = () => {} dentro de export const
  if (p.type === 'lexical_declaration' || p.type === 'variable_declaration') return p.parent?.type === 'export_statement';
  return false;
}

function heritageJs(n: TSNode): string[] {
  const res: string[] = [];
  for (const c of n.namedChildren) {
    if (c.type === 'class_heritage') {
      for (const h of c.namedChildren) {
        if (h.type === 'extends_clause' || h.type === 'implements_clause') {
          for (const v of h.namedChildren) {
            const id = v.type === 'identifier' || v.type === 'type_identifier' ? v.text : v.childForFieldName?.('name')?.text ?? v.namedChildren?.[0]?.text;
            if (id) res.push(String(id).split('<')[0]);
          }
        } else if (h.type === 'identifier' || h.type === 'member_expression') {
          // JS: class_heritage → extends identifier
          res.push(String(h.text));
        }
      }
    }
  }
  return res;
}

function calleeNameJs(fn: TSNode): { name?: string; onSelf: boolean } {
  if (!fn) return { onSelf: false };
  if (fn.type === 'identifier') return { name: fn.text, onSelf: false };
  if (fn.type === 'member_expression') {
    const prop = fn.childForFieldName('property');
    const obj = fn.childForFieldName('object');
    return { name: prop?.text, onSelf: obj?.type === 'this' };
  }
  return { onSelf: false };
}

function walkJs(node: TSNode, ctx: Ctx) {
  const t = node.type;
  switch (t) {
    case 'import_statement': {
      const src = node.childForFieldName('source');
      if (src) {
        const imp: ImportRef = { spec: unquote(src.text), names: [] };
        const clause = node.namedChildren.find((c: TSNode) => c.type === 'import_clause');
        if (clause) {
          for (const c of clause.namedChildren) {
            if (c.type === 'identifier') imp.names.push({ local: c.text, imported: 'default' });
            else if (c.type === 'namespace_import') {
              const id = c.namedChildren.find((x: TSNode) => x.type === 'identifier');
              if (id) imp.names.push({ local: id.text, imported: '*' });
            } else if (c.type === 'named_imports') {
              for (const s of c.namedChildren) {
                if (s.type !== 'import_specifier') continue;
                const nm = s.childForFieldName('name')?.text;
                const alias = s.childForFieldName('alias')?.text;
                if (nm) imp.names.push({ local: alias ?? nm, imported: nm });
              }
            }
          }
        }
        ctx.out.imports.push(imp);
      }
      return;
    }
    case 'export_statement': {
      const src = node.childForFieldName('source');
      if (src) ctx.out.imports.push({ spec: unquote(src.text), names: [] });
      break;
    }
    case 'class_declaration':
    case 'abstract_class_declaration':
    case 'class': {
      const name = node.childForFieldName('name')?.text ?? (node.parent?.type === 'variable_declarator' ? node.parent.childForFieldName('name')?.text : undefined);
      if (name) {
        const sym = addSymbol(ctx, node, name, 'class', isExportedJs(node) || isExportedJs(node.parent ?? node), heritageJs(node));
        within(ctx, sym, () => node.namedChildren.forEach((c: TSNode) => walkJs(c, ctx)));
        return;
      }
      break;
    }
    case 'interface_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        addSymbol(ctx, node, name, 'interface', isExportedJs(node));
        return; // las firmas de interfaces no tienen llamadas
      }
      break;
    }
    case 'enum_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (name) addSymbol(ctx, node, name, 'enum', isExportedJs(node));
      return;
    }
    case 'type_alias_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (name) addSymbol(ctx, node, name, 'type', isExportedJs(node));
      return;
    }
    case 'function_declaration':
    case 'generator_function_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        const kind: NodeKind = ctx.stack.length && ctx.stack[ctx.stack.length - 1].kind === 'class' ? 'method' : 'function';
        const sym = addSymbol(ctx, node, name, kind, isExportedJs(node));
        within(ctx, sym, () => node.namedChildren.forEach((c: TSNode) => walkJs(c, ctx)));
        return;
      }
      break;
    }
    case 'variable_declarator': {
      const nameNode = node.childForFieldName('name');
      const value = node.childForFieldName('value');
      const isFn = value && ['arrow_function', 'function', 'function_expression', 'generator_function'].includes(value.type);
      // Solo funciones de nivel módulo o de clase (no closures dentro de funciones).
      const inFn = ctx.stack.some((s) => s.kind === 'function' || s.kind === 'method');
      if (nameNode?.type === 'identifier' && isFn && !inFn) {
        const sym = addSymbol(ctx, node.parent ?? node, nameNode.text, 'function', isExportedJs(node.parent ?? node));
        within(ctx, sym, () => walkJs(value, ctx));
        return;
      }
      if (value?.type === 'call_expression') {
        // require('x')
        const fn = value.childForFieldName('function');
        const args = value.childForFieldName('arguments');
        if (fn?.text === 'require' && args?.namedChildren?.[0]?.type === 'string') {
          const imp: ImportRef = { spec: unquote(args.namedChildren[0].text), names: [] };
          if (nameNode?.type === 'identifier') imp.names.push({ local: nameNode.text, imported: '*' });
          else if (nameNode?.type === 'object_pattern') {
            for (const p of nameNode.namedChildren) {
              const id = p.type === 'shorthand_property_identifier_pattern' ? p.text : p.childForFieldName?.('value')?.text;
              const key = p.type === 'shorthand_property_identifier_pattern' ? p.text : p.childForFieldName?.('key')?.text;
              if (id && key) imp.names.push({ local: id, imported: key });
            }
          }
          ctx.out.imports.push(imp);
          return;
        }
      }
      break;
    }
    case 'method_definition': {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        const sym = addSymbol(ctx, node, name, 'method', true);
        within(ctx, sym, () => node.namedChildren.forEach((c: TSNode) => walkJs(c, ctx)));
        return;
      }
      break;
    }
    case 'public_field_definition':
    case 'field_definition': {
      const nameNode = node.childForFieldName('name') ?? node.childForFieldName('property');
      const value = node.childForFieldName('value');
      if (nameNode) {
        const isFn = value && ['arrow_function', 'function', 'function_expression'].includes(value.type);
        const sym = addSymbol(ctx, node, nameNode.text, isFn ? 'method' : 'property', true);
        if (value) within(ctx, sym, () => walkJs(value, ctx));
        return;
      }
      break;
    }
    case 'call_expression': {
      const fn = node.childForFieldName('function');
      if (fn?.type === 'import') {
        const arg = node.childForFieldName('arguments')?.namedChildren?.[0];
        if (arg?.type === 'string') ctx.out.imports.push({ spec: unquote(arg.text), names: [] });
      } else if (fn?.text === 'require') {
        const arg = node.childForFieldName('arguments')?.namedChildren?.[0];
        if (arg?.type === 'string') ctx.out.imports.push({ spec: unquote(arg.text), names: [] });
      } else {
        const c = calleeNameJs(fn);
        addCall(ctx, c.name, c.onSelf, node);
      }
      break;
    }
    case 'new_expression': {
      const ctor = node.childForFieldName('constructor');
      if (ctor?.type === 'identifier') addCall(ctx, ctor.text, false, node);
      break;
    }
  }
  for (const c of node.namedChildren) walkJs(c, ctx);
}

// ───────────────────────── Python ─────────────────────────

function walkPy(node: TSNode, ctx: Ctx) {
  switch (node.type) {
    case 'import_statement': {
      for (const c of node.namedChildren) {
        if (c.type === 'dotted_name') ctx.out.imports.push({ spec: c.text, names: [{ local: c.text.split('.')[0], imported: '*' }] });
        else if (c.type === 'aliased_import') {
          const nm = c.childForFieldName('name')?.text;
          const alias = c.childForFieldName('alias')?.text;
          if (nm) ctx.out.imports.push({ spec: nm, names: [{ local: alias ?? nm, imported: '*' }] });
        }
      }
      return;
    }
    case 'import_from_statement': {
      const mod = node.childForFieldName('module_name');
      if (!mod) return;
      let spec = mod.text as string;
      let level = 0;
      if (mod.type === 'relative_import') {
        const m = /^(\.+)(.*)$/.exec(spec);
        level = m ? m[1].length : 0;
        spec = m ? m[2] : spec;
      }
      const imp: ImportRef = { spec, names: [], level };
      for (const c of node.namedChildren) {
        if (c === mod || c.id === mod.id) continue;
        if (c.type === 'wildcard_import') imp.wildcard = true;
        else if (c.type === 'dotted_name') imp.names.push({ local: c.text, imported: c.text });
        else if (c.type === 'aliased_import') {
          const nm = c.childForFieldName('name')?.text;
          const alias = c.childForFieldName('alias')?.text;
          if (nm) imp.names.push({ local: alias ?? nm, imported: nm });
        }
      }
      ctx.out.imports.push(imp);
      return;
    }
    case 'class_definition': {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        const supers = node.childForFieldName('superclasses');
        const ext = supers ? supers.namedChildren.filter((s: TSNode) => s.type === 'identifier' || s.type === 'attribute').map((s: TSNode) => String(s.text).split('.').pop()) : [];
        const sym = addSymbol(ctx, wrap(node), name, 'class', !name.startsWith('_'), ext);
        within(ctx, sym, () => node.namedChildren.forEach((c: TSNode) => walkPy(c, ctx)));
        return;
      }
      break;
    }
    case 'function_definition': {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        const parent = ctx.stack[ctx.stack.length - 1];
        const inFn = ctx.stack.some((s) => s.kind === 'function' || s.kind === 'method');
        if (inFn) break; // funciones anidadas cuentan como parte de su padre
        const kind: NodeKind = parent?.kind === 'class' ? 'method' : 'function';
        const sym = addSymbol(ctx, wrap(node), name, kind, !name.startsWith('_') || name.startsWith('__'));
        within(ctx, sym, () => node.namedChildren.forEach((c: TSNode) => walkPy(c, ctx)));
        return;
      }
      break;
    }
    case 'call': {
      const fn = node.childForFieldName('function');
      if (fn?.type === 'identifier') addCall(ctx, fn.text, false, node);
      else if (fn?.type === 'attribute') {
        const obj = fn.childForFieldName('object');
        addCall(ctx, fn.childForFieldName('attribute')?.text, obj?.text === 'self' || obj?.text === 'cls', node);
      }
      break;
    }
  }
  for (const c of node.namedChildren) walkPy(c, ctx);
}

/** Incluye decoradores en el rango del símbolo. */
function wrap(n: TSNode): TSNode {
  return n.parent?.type === 'decorated_definition' ? n.parent : n;
}

// ───────────────────────── Java ─────────────────────────

function hasModifier(n: TSNode, mod: string): boolean {
  const mods = n.namedChildren.find((c: TSNode) => c.type === 'modifiers');
  return !!mods && String(mods.text).split(/\s+/).includes(mod);
}

function walkJava(node: TSNode, ctx: Ctx) {
  switch (node.type) {
    case 'package_declaration': {
      const id = node.namedChildren.find((c: TSNode) => c.type === 'scoped_identifier' || c.type === 'identifier');
      if (id) ctx.out.packageName = id.text;
      return;
    }
    case 'import_declaration': {
      const text = String(node.text).replace(/^import\s+/, '').replace(/^static\s+/, '').replace(/;\s*$/, '').trim();
      const wildcard = text.endsWith('.*');
      const spec = wildcard ? text.slice(0, -2) : text;
      const last = spec.split('.').pop()!;
      ctx.out.imports.push({ spec, wildcard, names: wildcard ? [] : [{ local: last, imported: last }] });
      return;
    }
    case 'class_declaration':
    case 'interface_declaration':
    case 'enum_declaration':
    case 'record_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        const kind: NodeKind = node.type === 'interface_declaration' ? 'interface' : node.type === 'enum_declaration' ? 'enum' : 'class';
        const ext: string[] = [];
        const sup = node.childForFieldName('superclass');
        if (sup) ext.push(String(sup.text).replace(/^extends\s+/, '').split('<')[0]);
        const ifs = node.childForFieldName('interfaces');
        if (ifs) for (const m of String(ifs.text).replace(/^implements\s+/, '').split(',')) ext.push(m.trim().split('<')[0]);
        const sym = addSymbol(ctx, node, name, kind, hasModifier(node, 'public'), ext.filter(Boolean));
        within(ctx, sym, () => node.namedChildren.forEach((c: TSNode) => walkJava(c, ctx)));
        return;
      }
      break;
    }
    case 'method_declaration':
    case 'constructor_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (name) {
        const sym = addSymbol(ctx, node, name, 'method', hasModifier(node, 'public'));
        within(ctx, sym, () => node.namedChildren.forEach((c: TSNode) => walkJava(c, ctx)));
        return;
      }
      break;
    }
    case 'field_declaration': {
      const decl = node.childForFieldName('declarator');
      const name = decl?.childForFieldName('name')?.text;
      if (name) {
        const sym = addSymbol(ctx, node, name, 'property', hasModifier(node, 'public'));
        within(ctx, sym, () => node.namedChildren.forEach((c: TSNode) => walkJava(c, ctx)));
        return;
      }
      break;
    }
    case 'method_invocation': {
      const obj = node.childForFieldName('object');
      addCall(ctx, node.childForFieldName('name')?.text, !obj || obj.type === 'this', node);
      break;
    }
    case 'object_creation_expression': {
      const ty = node.childForFieldName('type');
      if (ty) addCall(ctx, String(ty.text).split('<')[0].split('.').pop(), false, node);
      break;
    }
  }
  for (const c of node.namedChildren) walkJava(c, ctx);
}
