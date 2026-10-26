#!/usr/bin/env node
// Strict parser, schema and loader for .jstack/config.yml. Prints one JSON object when run directly.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defaultExec, emit, firstLine, isMain, makeCtx, parseArgs } from './lib.mjs';

/** Globs no phase may ever edit, whatever the config says. */
export const BUILTIN_PROTECTED = ['.jstack/**'];

const MODELS = ['haiku', 'sonnet', 'opus'];
const int = (min, def) => ({ type: 'int', min, def });
const str = (def = null) => ({ type: 'string', def });
const oneOf = (values, def) => ({ type: 'enum', values, def });

/** Schema: top-level key -> {kind, def} for lists/scalars, or {kind:'object', keys}. */
export const SCHEMA = {
  version: { kind: 'scalar', spec: { type: 'version', def: 1 } },
  setup: { kind: 'list' },
  checks: { kind: 'list' },
  protected_paths: { kind: 'list' },
  rubric: { kind: 'scalar', spec: str() },
  limits: {
    kind: 'object',
    keys: { max_retries: int(0, 3), max_plan_steps: int(1, 10), check_timeout_minutes: int(1, 15), max_open_prs: int(1, 1) },
  },
  ship: { kind: 'object', keys: { deploy_workflow: str() } },
  autonomy: { kind: 'object', keys: { ship_two_way: oneOf(['lit', 'dark'], 'lit'), max_lines: int(0, 200) } },
  human_paths: { kind: 'list' },
  models: {
    kind: 'object',
    keys: Object.fromEntries(['planner', 'reviewer', 'verifier', 'security-reviewer'].map((k) => [k, oneOf(MODELS, undefined)])),
  },
};

/** Remove a `#` comment that is outside quotes and starts a word. */
function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

/** Parse one scalar token. Returns {value, quoted} or throws on bad quoting. */
function scalar(raw) {
  const s = raw.trim();
  if (s[0] === '"' || s[0] === "'") {
    const q = s[0];
    if (s.length < 2 || s.at(-1) !== q) throw new Error(`unterminated quote in ${s}`);
    const inner = s.slice(1, -1);
    if (q === '"') {
      if (/(^|[^\\])(\\\\)*"/.test(inner)) throw new Error(`stray quote in ${s}`);
      return { value: inner.replace(/\\(["\\])/g, '$1'), quoted: true };
    }
    if (inner.replace(/''/g, '').includes("'")) throw new Error(`stray quote in ${s}`);
    return { value: inner.replace(/''/g, "'"), quoted: true };
  }
  if (s.startsWith('[') || s.startsWith('{')) throw new Error(`unexpected ${s[0]} in ${s}`);
  return { value: s, quoted: false };
}

/** Split a flow list `[a, "b, c"]` into scalars. */
function flowList(raw) {
  const s = raw.trim();
  if (!s.endsWith(']')) throw new Error(`unterminated flow list ${s}`);
  const inner = s.slice(1, -1);
  if (!inner.trim()) return [];
  const parts = [];
  let q = null, cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) {
      if (c === '\\' && q === '"') { cur += c + (inner[++i] ?? ''); continue; }
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === ',') { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (q) throw new Error(`unterminated quote in ${s}`);
  parts.push(cur);
  return parts.map((p) => {
    if (!p.trim()) throw new Error(`empty item in ${s}`);
    return scalar(p);
  });
}

/** Tokenize the YAML subset into {key: node}. Node: {type:'scalar'|'list'|'object'|'empty', ...}. */
export function parseRaw(text) {
  const raw = {};
  const errors = [];
  let key = null;
  String(text).split(/\r?\n/).forEach((rawLine, idx) => {
    const n = idx + 1;
    const lead = rawLine.match(/^[ \t]*/)[0];
    if (lead.includes('\t')) { errors.push(`line ${n}: tab indentation`); return; }
    let line;
    try { line = stripComment(rawLine).replace(/\s+$/, ''); } catch { line = rawLine; }
    if (!line.trim()) return;
    const indent = lead.length;
    const body = line.trim();
    try {
      if (indent === 0) {
        const m = body.match(/^([A-Za-z0-9_-]+):(?:\s+(.*))?$/);
        if (!m) throw new Error(`cannot parse "${body}"`);
        const [, k, v] = m;
        if (k in raw) throw new Error(`duplicate key ${k}`);
        key = k;
        if (v === undefined || v === '') raw[k] = { type: 'empty', line: n };
        else if (v.trim().startsWith('[')) raw[k] = { type: 'list', items: flowList(v), flow: true, line: n };
        else raw[k] = { type: 'scalar', ...scalar(v), line: n };
        return;
      }
      if (key === null) throw new Error(`indented line before any key: "${body}"`);
      const node = raw[key];
      if (body === '-' || body.startsWith('- ')) {
        if (node.type === 'empty') Object.assign(node, { type: 'list', items: [] });
        if (node.type !== 'list' || node.flow) throw new Error(`list item under ${key}, which is not a list`);
        const item = body.slice(1).trim();
        if (!item) throw new Error(`empty list item under ${key}`);
        node.items.push(scalar(item));
        return;
      }
      const m = body.match(/^([A-Za-z0-9_-]+):(?:\s+(.*))?$/);
      if (!m) throw new Error(`cannot parse "${body}"`);
      if (node.type === 'empty') Object.assign(node, { type: 'object', entries: {} });
      if (node.type !== 'object') throw new Error(`nested key ${m[1]} under ${key}, which is not an object`);
      if (m[1] in node.entries) throw new Error(`duplicate key ${key}.${m[1]}`);
      const v = m[2];
      if (v !== undefined && /^\s*[[{]/.test(v)) throw new Error(`${key}.${m[1]}: scalar expected`);
      node.entries[m[1]] = v === undefined || v === '' ? { value: '', quoted: false, empty: true } : scalar(v);
    } catch (err) {
      errors.push(`line ${n}: ${err.message}`);
    }
  });
  return { raw, errors };
}

/** Coerce one scalar against a spec. Returns {value} or {error}. */
function coerce(name, s, spec) {
  const v = s.value;
  const isNull = !s.quoted && (s.empty || v === '' || v === 'null' || v === '~');
  if (spec.type === 'version') {
    return !s.quoted && v === '1' ? { value: 1 } : { error: `${name}: must be 1` };
  }
  if (spec.type === 'int') {
    if (s.quoted || !/^\d+$/.test(v)) return { error: `${name}: integer expected, got "${v}"` };
    const n = Number(v);
    return n < spec.min ? { error: `${name}: must be >= ${spec.min}` } : { value: n };
  }
  if (spec.type === 'string') return isNull ? { value: null } : { value: v };
  if (spec.type === 'enum') {
    return spec.values.includes(v) ? { value: v } : { error: `${name}: must be one of ${spec.values.join('|')}, got "${v}"` };
  }
  return { error: `${name}: unsupported` };
}

/** Defaults for every key, before derived keys. */
function baseDefaults() {
  const c = {};
  for (const [k, s] of Object.entries(SCHEMA)) {
    if (s.kind === 'list') c[k] = [];
    else if (s.kind === 'scalar') c[k] = s.spec.def;
    else c[k] = Object.fromEntries(Object.entries(s.keys).filter(([, v]) => v.def !== undefined).map(([n, v]) => [n, v.def]));
  }
  return c;
}

/** Effective defaults for every key. */
export const defaultConfig = () => finalize(baseDefaults());

/** Add derived keys: builtin protected paths. */
function finalize(c) {
  c.protected_paths_configured = c.protected_paths;
  c.protected_paths = [...BUILTIN_PROTECTED, ...c.protected_paths.filter((p) => !BUILTIN_PROTECTED.includes(p))];
  return c;
}

/** Strictly parse and validate config text. Returns {config, errors}; config always has every key. */
export function parseConfig(text) {
  const { raw, errors } = parseRaw(text);
  const c = baseDefaults();
  for (const [k, node] of Object.entries(raw)) {
    const s = SCHEMA[k];
    if (!s) { errors.push(`unknown key ${k}`); continue; }
    if (s.kind === 'list') {
      if (node.type === 'empty') c[k] = [];
      else if (node.type !== 'list') errors.push(`${k}: list expected`);
      else {
        const bad = node.items.filter((i) => !i.value.trim());
        if (bad.length) errors.push(`${k}: empty item`);
        else c[k] = node.items.map((i) => i.value);
      }
    } else if (s.kind === 'scalar') {
      if (node.type === 'list' || node.type === 'object') { errors.push(`${k}: scalar expected`); continue; }
      const r = coerce(k, node.type === 'empty' ? { value: '', empty: true } : node, s.spec);
      if (r.error) errors.push(r.error); else c[k] = r.value;
    } else {
      if (node.type === 'empty') continue;
      if (node.type !== 'object') { errors.push(`${k}: object expected`); continue; }
      for (const [n, v] of Object.entries(node.entries)) {
        const spec = s.keys[n];
        if (!spec) { errors.push(`unknown key ${k}.${n}`); continue; }
        const r = coerce(`${k}.${n}`, v, spec);
        if (r.error) errors.push(r.error); else if (r.value !== null || spec.type === 'string') c[k][n] = r.value;
      }
    }
  }
  return { config: finalize(c), errors };
}

/**
 * Load the config. source 'trunk' (default) reads origin/<default branch>; 'worktree' reads <cwd>/.jstack/config.yml.
 * Returns {ok, source, ref, found, errors, config}.
 */
export function loadConfig({ cwd = process.cwd(), source = 'trunk', exec = defaultExec } = {}) {
  const fail = (ref, msg) => ({ ok: false, source, ref, found: false, errors: [msg], config: defaultConfig() });
  let text;
  let ref;
  if (source === 'worktree') {
    ref = 'worktree';
    const file = join(cwd, '.jstack', 'config.yml');
    if (!existsSync(file)) return { ok: true, source, ref, found: false, errors: [], config: defaultConfig() };
    try { text = readFileSync(file, 'utf8'); } catch (err) { return fail(ref, `cannot read ${file}: ${firstLine(err)}`); }
  } else if (source === 'trunk') {
    const ctx = makeCtx({ exec, cwd });
    try {
      const branch = ctx.gh(['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']).trim();
      if (!/^[\w./-]+$/.test(branch)) throw new Error(`bad default branch "${branch}"`);
      ref = `origin/${branch}`;
      ctx.run('git', ['fetch', 'origin', branch, '--quiet']);
      const listed = ctx.run('git', ['ls-tree', '--name-only', ref, '--', '.jstack/config.yml']).trim();
      if (!listed) return { ok: true, source, ref, found: false, errors: [], config: defaultConfig() };
      text = ctx.run('git', ['show', `${ref}:.jstack/config.yml`]);
    } catch (err) {
      return fail(ref ?? null, `cannot read trunk config: ${firstLine(err)}`);
    }
  } else return fail(null, `unknown source ${source}`);
  const { config, errors } = parseConfig(text);
  return { ok: errors.length === 0, source, ref, found: true, errors, config };
}

/** Convert a glob (`**`, `*`, `?`) to an anchored, case-insensitive RegExp over forward-slash paths. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

/** Globs from `globs` matching a forward-slash path. */
export function matchingGlobs(path, globs) {
  const p = String(path).replace(/\\/g, '/').replace(/^\.\//, '');
  return globs.filter((g) => globToRegExp(g).test(p));
}

if (isMain(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const cwd = resolve(typeof a.cwd === 'string' ? a.cwd : process.cwd());
  const r = loadConfig({ cwd, source: a.worktree ? 'worktree' : 'trunk' });
  emit(r, r.ok);
}
