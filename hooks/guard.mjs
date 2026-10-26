#!/usr/bin/env node
// PreToolUse guard for jstack. Reads the hook JSON on stdin; exit 0 allows, exit 2 blocks (reason on stderr).
// Best effort and fast. On its own bugs it allows, unless the input clearly is a guarded command.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseConfig, matchingGlobs, BUILTIN_PROTECTED } from '../scripts/config.mjs';

export const REASONS = {
  approved: 'jstack:approved is human only: add it on GitHub',
  blocked: 'moving a task out of jstack:blocked is human only',
  bypass: 'never bypass signing or hooks',
  merge: 'merge with --match-head-commit <proven sha>',
};

/** Split a shell command into segments of tokens (quotes respected; ; && || | & ( ) ` newline split). */
export function segments(command) {
  const segs = [[]];
  let tok = null;
  const s = String(command);
  const push = () => { if (tok !== null) { segs.at(-1).push(tok); tok = null; } };
  const split = () => { push(); if (segs.at(-1).length) segs.push([]); };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      const end = j === -1 ? s.length : j;
      tok = (tok ?? '') + s.slice(i + 1, end);
      i = end;
    } else if (c === '"') {
      let v = '';
      let j = i + 1;
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === '\\' && j + 1 < s.length && '"\\$`'.includes(s[j + 1])) v += s[++j];
        else v += s[j];
      }
      tok = (tok ?? '') + v;
      i = j;
    } else if (c === '\\' && i + 1 < s.length) { tok = (tok ?? '') + s[++i]; }
    else if (/\s/.test(c) && c !== '\n') push();
    else if (';&|()`\n'.includes(c)) split();
    else if (c === '$' && s[i + 1] === '(') { split(); i++; }
    else tok = (tok ?? '') + c;
  }
  push();
  return segs.filter((x) => x.length);
}

const decode = (t) => String(t).replace(/%3a/gi, ':');
const base = (t) => basename(String(t).replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '');
/** Values given to any of `flags` (`--f v`, `--f=v`), comma-split and lowercased. */
function flagValues(tokens, flags) {
  const out = [];
  tokens.forEach((t, i) => {
    for (const f of flags) {
      if (t === f && i + 1 < tokens.length) out.push(tokens[i + 1]);
      else if (t.startsWith(`${f}=`)) out.push(t.slice(f.length + 1));
    }
  });
  return out.flatMap((v) => decode(v).split(',')).map((v) => v.trim().toLowerCase());
}

/** Reason to block one gh segment, or null. */
function checkGh(t) {
  const sub = t.filter((x) => !x.startsWith('-'));
  const adding = flagValues(t, sub.includes('create') ? ['--add-label', '--label', '-l'] : ['--add-label']);
  if (adding.includes('jstack:approved')) return REASONS.approved;
  if (flagValues(t, ['--remove-label']).includes('jstack:blocked')) return REASONS.blocked;
  const text = decode(t.join(' ')).toLowerCase();
  if (sub[0] === 'api') {
    const hasFields = t.some((x) => /^(-f|-F|--field|--raw-field|--input)(=|$)/.test(x));
    const method = flagValues(t, ['-X', '--method'])[0] ?? (hasFields ? 'post' : 'get');
    if (/labels/.test(text) && text.includes('jstack:approved') && ['post', 'put', 'patch'].includes(method)) return REASONS.approved;
    if (/labels/.test(text) && text.includes('jstack:blocked') && method === 'delete') return REASONS.blocked;
    if (/pulls\/\d+\/merge\b/.test(text) && !/\bsha=/.test(text)) return REASONS.merge;
  }
  if (sub[0] === 'pr' && sub[1] === 'merge' && !t.some((x) => x === '--match-head-commit' || x.startsWith('--match-head-commit='))) return REASONS.merge;
  return null;
}

const VALUE_FLAGS = new Set(['-m', '-F', '-C', '-c', '--message', '--file', '-t', '--template', '--author', '--date', '--trailer', '--reuse-message', '--fixup', '--squash']);

/** Reason to block one git segment, or null. */
function checkGit(t) {
  const low = t.map((x) => x.toLowerCase());
  if (low.some((x) => x === '--no-verify' || x === '--no-gpg-sign' || /commit\.gpgsign\s*=\s*(false|0|no|off)/.test(x) || x.includes('core.hookspath'))) return REASONS.bypass;
  const cfg = low.indexOf('config');
  if (cfg > -1 && low.includes('commit.gpgsign') && ['false', '0', 'no', 'off'].includes(low[low.indexOf('commit.gpgsign') + 1])) return REASONS.bypass;
  const ci = t.indexOf('commit');
  if (ci > -1) {
    for (let i = ci + 1; i < t.length; i++) {
      if (VALUE_FLAGS.has(t[i])) { i++; continue; }
      if (/^-[A-Za-z]+$/.test(t[i]) && t[i].includes('n')) return REASONS.bypass;
    }
  }
  return null;
}

/** Reason to block a Bash command, or null. Re-checks quoted inner commands (bash -c "..."). */
export function checkBash(command, depth = 0) {
  for (const seg of segments(command)) {
    const gi = seg.findIndex((x) => base(x) === 'gh');
    if (gi > -1) { const r = checkGh(seg.slice(gi + 1)); if (r) return r; }
    const ti = seg.findIndex((x) => base(x) === 'git');
    if (ti > -1) { const r = checkGit(seg.slice(ti + 1)); if (r) return r; }
    if (depth < 3) {
      for (const tok of seg) {
        if (/\s/.test(tok) && /\b(gh|git)\b/.test(tok)) { const r = checkBash(tok, depth + 1); if (r) return r; }
      }
    }
  }
  return null;
}

/** Run git without a shell, short timeout. Returns stdout or null. */
function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 5000, windowsHide: true });
  return r.status === 0 ? r.stdout : null;
}

/** Reason to block an edit of `file` (absolute), or null. `gitFn(args, cwd)` returns stdout or null. */
export function checkEdit(file, gitFn = git, read = (p) => readFileSync(p, 'utf8')) {
  let dir = dirname(file);
  while (!existsSync(dir)) { const up = dirname(dir); if (up === dir) return null; dir = up; }
  const branch = gitFn(['symbolic-ref', '--short', '-q', 'HEAD'], dir)?.trim();
  if (!branch?.startsWith('jstack/')) return null;
  const top = gitFn(['rev-parse', '--show-toplevel'], dir)?.trim();
  if (!top) return null;
  const rel = relative(resolve(top), resolve(file)).replace(/\\/g, '/');
  if (!rel || rel.startsWith('../') || isAbsolute(rel)) return null;
  let globs = BUILTIN_PROTECTED;
  const cfgFile = join(top, '.jstack', 'config.yml');
  try { if (existsSync(cfgFile)) globs = parseConfig(read(cfgFile)).config.protected_paths; } catch { /* builtin only */ }
  return matchingGlobs(rel, globs).length ? `protected path: ${rel}` : null;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const GUARDED = /jstack:approved|jstack%3aapproved|jstack:blocked|jstack%3ablocked|--no-verify|--no-gpg-sign|gpgsign|hookspath|pr\s+merge|\/merge/i;

/** Decide for one hook payload (raw stdin text). Returns {code, reason}. */
export function decide(raw, deps = {}) {
  try {
    const input = JSON.parse(raw);
    const ti = input.tool_input ?? {};
    if (input.tool_name === 'Bash') {
      const reason = checkBash(String(ti.command ?? ''));
      return reason ? { code: 2, reason } : { code: 0 };
    }
    if (EDIT_TOOLS.has(input.tool_name)) {
      const p = ti.file_path ?? ti.notebook_path ?? ti.path;
      if (typeof p !== 'string' || !p) return { code: 0 };
      const reason = checkEdit(resolve(input.cwd ?? process.cwd(), p), deps.git, deps.read);
      return reason ? { code: 2, reason } : { code: 0 };
    }
    return { code: 0 };
  } catch (err) {
    if (/"tool_name"\s*:\s*"Bash"/.test(raw) && GUARDED.test(raw)) return { code: 2, reason: `jstack guard failed on a guarded command: ${String(err.message).split('\n')[0]}` };
    return { code: 0 };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  const r = decide(raw);
  if (r.code === 2) process.stderr.write(`${r.reason}\n`, () => process.exit(2));
  else process.exit(0);
}
