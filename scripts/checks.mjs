#!/usr/bin/env node
// Runs the `setup` then `checks` commands from .jstack/config.yml and prints one JSON object.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { defaultExec, emit, isMain, parseArgs } from './lib.mjs';
import { loadConfig } from './config.mjs';

export { parseConfig, loadConfig } from './config.mjs';

const MAX_KEEP = 1024 * 1024;

/** Last `n` lines of text, CRLF-normalized. */
export function tail(text, n = 40) {
  return String(text).replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n').slice(-n).join('\n');
}

/** Find Git Bash next to git on Windows. Returns a path or null. Never picks System32/WSL bash. */
export function findGitBash(exec = defaultExec, exists = existsSync) {
  const r = exec('git', ['--exec-path'], {});
  if (r.code !== 0) return null;
  let dir = resolve(r.stdout.trim());
  for (let i = 0; i < 6; i++) {
    for (const rel of ['bin/bash.exe', 'usr/bin/bash.exe']) {
      const p = join(dir, rel);
      if (!/system32/i.test(p) && exists(p)) return p;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** How to run a command with POSIX sh semantics: {file, args(cmd), shellWarning?}. */
export function resolveShell({ platform = process.platform, exec = defaultExec, exists = existsSync } = {}) {
  if (platform !== 'win32') return { file: '/bin/sh', args: (c) => ['-c', c] };
  const bash = findGitBash(exec, exists);
  if (bash) return { file: bash, args: (c) => ['-c', c] };
  return { file: null, args: null, shellWarning: 'Git Bash not found; ran commands with the default Windows shell' };
}

/** Kill a process and its children, best effort. */
function killTree(child) {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

/** Run one command; resolves {exitCode, durationMs, outputTail}. exitCode 124 on timeout. */
export function runCommand(command, { cwd, shell, timeoutMs }) {
  return new Promise((done) => {
    const t0 = Date.now();
    let out = '';
    let timedOut = false;
    let finished = false;
    const add = (d) => { out += d; if (out.length > MAX_KEEP) out = out.slice(-MAX_KEEP); };
    const opts = { cwd, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] };
    let child;
    try {
      child = shell.file ? spawn(shell.file, shell.args(command), opts) : spawn(command, { ...opts, shell: true });
    } catch (err) {
      done({ exitCode: 1, durationMs: 0, outputTail: tail(String(err.message)) });
      return;
    }
    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(grace);
      if (timedOut) add(`\n[jstack] timed out after ${Math.round(timeoutMs / 1000)}s and was killed`);
      done({ exitCode: timedOut ? 124 : code ?? 1, durationMs: Date.now() - t0, outputTail: tail(out) });
    };
    let grace;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      grace = setTimeout(() => finish(124), 5000);
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', add);
    child.stderr.setEncoding('utf8').on('data', add);
    child.on('error', (err) => { add(String(err.message)); finish(1); });
    child.on('close', (code) => finish(code));
  });
}

/**
 * Load config (trunk by default) and run setup then checks from `cwd`.
 * Options: configSource 'trunk'|'worktree', exec (for gh/git), timeoutMs override, shell override.
 */
export async function runChecks({ cwd, configSource = 'trunk', exec = defaultExec, timeoutMs, shell } = {}) {
  const loaded = loadConfig({ cwd, source: configSource, exec });
  const base = { configSource };
  if (!loaded.ok) {
    return {
      ...base, pass: false,
      results: [{ phase: 'config', command: '(config)', exitCode: 1, durationMs: 0, outputTail: loaded.errors.join('\n') }],
    };
  }
  const { setup, checks, limits } = loaded.config;
  if (checks.length === 0) {
    return { ...base, pass: false, results: [{ phase: 'check', command: '(none)', exitCode: 1, durationMs: 0, outputTail: 'no checks declared' }] };
  }
  const sh = shell ?? resolveShell({ exec });
  if (sh.shellWarning) base.shellWarning = sh.shellWarning;
  const limit = timeoutMs ?? limits.check_timeout_minutes * 60_000;
  const results = [];
  for (const command of setup) {
    const r = await runCommand(command, { cwd, shell: sh, timeoutMs: limit });
    results.push({ phase: 'setup', command, ...r });
    if (r.exitCode !== 0) return { ...base, pass: false, results };
  }
  for (const command of checks) {
    results.push({ phase: 'check', command, ...(await runCommand(command, { cwd, shell: sh, timeoutMs: limit })) });
  }
  return { ...base, pass: results.every((r) => r.exitCode === 0), results };
}

if (isMain(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const cwd = resolve(typeof a.cwd === 'string' ? a.cwd : process.cwd());
  runChecks({ cwd, configSource: a['config-worktree'] ? 'worktree' : 'trunk' })
    .then((r) => emit(r, r.pass))
    .catch((err) => emit({ pass: false, configSource: null, results: [{ phase: 'config', command: '(internal)', exitCode: 1, durationMs: 0, outputTail: String(err.message) }] }, false));
}
