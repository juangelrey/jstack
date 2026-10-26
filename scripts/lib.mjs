// Shared helpers for jstack scripts: process execution, gh access, trust, args, output.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Default timeout for one gh/git call, in ms. */
export const CALL_TIMEOUT_MS = 120_000;

/** Run a program without a shell. Never throws: returns {code, stdout, stderr}; 124 on timeout. */
export function defaultExec(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    input: opts.input,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: opts.timeoutMs ?? CALL_TIMEOUT_MS,
    windowsHide: true,
  });
  if (r.error) {
    const timedOut = r.error.code === 'ETIMEDOUT';
    return { code: timedOut ? 124 : 1, stdout: r.stdout || '', stderr: `${r.stderr || ''}${r.error.message}` };
  }
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** First line of an error's message, for reasons. */
export const firstLine = (err) => String(err?.message ?? err).trim().split('\n')[0];

/** Promise-based sleep on an in-process timer. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Parse multiple concatenated top-level JSON values (as `gh api --paginate` emits) and flatten arrays. */
export function parseJsonStream(text) {
  const s = String(text).trim();
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [v];
  } catch { /* fall through to scanning */ }
  const out = [];
  let depth = 0, start = -1, inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '[' || c === '{') { if (depth++ === 0) start = i; }
    else if (c === ']' || c === '}') {
      if (--depth === 0) {
        const v = JSON.parse(s.slice(start, i + 1));
        if (Array.isArray(v)) out.push(...v); else out.push(v);
      }
    }
  }
  if (depth !== 0 || inStr) throw new Error('truncated JSON from gh');
  return out;
}

/** Build a context with gh/git helpers on top of an injectable exec. */
export function makeCtx({ exec = defaultExec, cwd = process.cwd() } = {}) {
  const run = (cmd, args) => {
    const r = exec(cmd, args, { cwd });
    if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.code}): ${String(r.stderr || r.stdout).trim().split('\n')[0]}`);
    return r.stdout;
  };
  const gh = (args) => run('gh', args);
  const ghJson = (args) => JSON.parse(gh(args));
  const ghPaginated = (path) => parseJsonStream(gh(['api', path, '--paginate']));
  const permissions = new Map();
  /** Repo permission of a login, or null when unknown/untrusted. Cached per process. */
  const permission = (login) => {
    const l = String(login ?? '');
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(l)) return null;
    if (!permissions.has(l)) {
      const r = exec('gh', ['api', `repos/{owner}/{repo}/collaborators/${l}/permission`, '--jq', '.permission'], { cwd });
      permissions.set(l, r.code === 0 ? r.stdout.trim() : null);
    }
    return permissions.get(l);
  };
  const isTrusted = (login) => ['admin', 'maintain', 'write'].includes(permission(login));
  return { exec, cwd, run, gh, ghJson, ghPaginated, permission, isTrusted };
}

/** Parse `cmd --key value --flag` style argv into {_: positionals, key: value|true}. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

/** True when the module at `url` is the process entry point. */
export const isMain = (url) => Boolean(process.argv[1]) && url === pathToFileURL(resolve(process.argv[1])).href;

/** Print exactly one JSON object and set the exit code (0 iff ok). */
export function emit(obj, ok) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  process.exitCode = ok ? 0 : 1;
}

/** Positive integer from a CLI value, or null. */
export function toInt(v) {
  return typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : typeof v === 'number' && Number.isInteger(v) ? v : null;
}
