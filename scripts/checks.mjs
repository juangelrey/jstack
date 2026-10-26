#!/usr/bin/env node
// Runs the `checks` commands from .jstack/config.yml and prints one JSON object.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

function scalar(raw) {
  const s = raw.trim();
  if (s.length >= 2 && s[0] === '"' && s.at(-1) === '"') {
    return s.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (s.length >= 2 && s[0] === "'" && s.at(-1) === "'") return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/** Parse the contract's YAML subset. Scalars stay strings. */
export function parseConfig(text) {
  const out = {};
  let key = null;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = stripComment(rawLine).replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indent = line.match(/^ */)[0].length;
    const body = line.trim();
    if (body.startsWith('- ') || body === '-') {
      if (key === null) continue;
      if (!Array.isArray(out[key])) out[key] = [];
      out[key].push(scalar(body.slice(1)));
      continue;
    }
    const m = body.match(/^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/);
    if (!m) continue;
    const [, k, v] = m;
    if (indent === 0) {
      key = k;
      out[k] = v === undefined || v === '' ? null : scalar(v);
    } else if (key !== null) {
      if (out[key] === null || Array.isArray(out[key])) out[key] = {};
      if (typeof out[key] === 'object') out[key][k] = v === undefined ? '' : scalar(v);
    }
  }
  for (const k of Object.keys(out)) if (out[k] === null) out[k] = [];
  return out;
}

/** Read <cwd>/.jstack/config.yml. Returns {} if missing. */
export function loadConfig(cwd) {
  const file = join(cwd, '.jstack', 'config.yml');
  return existsSync(file) ? parseConfig(readFileSync(file, 'utf8')) : {};
}

function tail(text, n = 40) {
  return text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n').slice(-n).join('\n');
}

export function runChecks(cwd) {
  const checks = loadConfig(cwd).checks;
  if (!Array.isArray(checks) || checks.length === 0) {
    return {
      pass: false,
      results: [{ command: '(none)', exitCode: 1, durationMs: 0, outputTail: 'no checks declared' }],
    };
  }
  const results = checks.map((command) => {
    const t0 = Date.now();
    const r = spawnSync(command, { cwd, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const exitCode = r.status ?? 1;
    const out = (r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error.message) : '');
    return { command, exitCode, durationMs: Date.now() - t0, outputTail: tail(out) };
  });
  return { pass: results.every((r) => r.exitCode === 0), results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const i = process.argv.indexOf('--cwd');
  const cwd = resolve(i > -1 && process.argv[i + 1] ? process.argv[i + 1] : process.cwd());
  const report = runChecks(cwd);
  process.stdout.write(JSON.stringify(report) + '\n');
  process.exit(report.pass ? 0 : 1);
}
