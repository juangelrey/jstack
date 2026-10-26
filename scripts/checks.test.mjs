import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runChecks, findGitBash, resolveShell } from './checks.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'checks.mjs');

function repo(config) {
  const dir = mkdtempSync(join(tmpdir(), 'jstack-'));
  if (config !== undefined) {
    mkdirSync(join(dir, '.jstack'));
    writeFileSync(join(dir, '.jstack', 'config.yml'), config);
  }
  return dir;
}
function cli(dir, extra = ['--config-worktree']) {
  const r = spawnSync(process.execPath, [script, '--cwd', dir, ...extra], { encoding: 'utf8' });
  return { code: r.status, json: JSON.parse(r.stdout) };
}

test('cli passes when all checks exit 0', () => {
  const dir = repo('checks:\n  - node -e "console.log(1);process.exit(0)"\n  - node -e "process.exit(0)"\n');
  const { code, json } = cli(dir);
  assert.equal(code, 0);
  assert.equal(json.pass, true);
  assert.equal(json.configSource, 'worktree');
  assert.equal(json.results.length, 2);
  const r = json.results[0];
  assert.deepEqual(Object.keys(r).sort(), ['command', 'durationMs', 'exitCode', 'outputTail', 'phase']);
  assert.equal(r.phase, 'check');
  assert.equal(r.exitCode, 0);
  assert.equal(r.outputTail, '1');
  rmSync(dir, { recursive: true });
});

test('cli fails when a check exits 1, still runs the rest', () => {
  const dir = repo('checks:\n  - node -e "process.exit(1)"\n  - node -e "process.exit(0)"\n');
  const { code, json } = cli(dir);
  assert.notEqual(code, 0);
  assert.equal(json.pass, false);
  assert.deepEqual(json.results.map((r) => r.exitCode), [1, 0]);
  rmSync(dir, { recursive: true });
});

test('commands get POSIX sh semantics', () => {
  const dir = repo("checks:\n  - test -n \"$HOME\" && X=ok && echo $X | tr a-z A-Z\n");
  const { code, json } = cli(dir);
  assert.equal(code, 0, json.results[0].outputTail);
  assert.equal(json.results[0].outputTail, 'OK');
  rmSync(dir, { recursive: true });
});

test('setup runs first; failing setup skips checks', () => {
  const ok = repo('setup:\n  - node -e "console.log(\'s\')"\nchecks:\n  - node -e "process.exit(0)"\n');
  let { code, json } = cli(ok);
  assert.equal(code, 0);
  assert.deepEqual(json.results.map((r) => r.phase), ['setup', 'check']);
  const bad = repo('setup: [node -e "process.exit(3)"]\nchecks:\n  - node -e "process.exit(0)"\n');
  ({ code, json } = cli(bad));
  assert.notEqual(code, 0);
  assert.deepEqual(json.results.map((r) => [r.phase, r.exitCode]), [['setup', 3]]);
  rmSync(ok, { recursive: true });
  rmSync(bad, { recursive: true });
});

test('cli: no checks declared', () => {
  for (const dir of [repo(), repo('version: 1\nchecks:\n')]) {
    const { code, json } = cli(dir);
    assert.notEqual(code, 0);
    assert.equal(json.pass, false);
    assert.equal(json.results[0].command, '(none)');
    assert.match(json.results[0].outputTail, /no checks declared/);
    rmSync(dir, { recursive: true });
  }
});

test('config errors fail closed', () => {
  const dir = repo('checks: npm test\nbogus: 1\n');
  const { code, json } = cli(dir);
  assert.notEqual(code, 0);
  assert.equal(json.results.length, 1);
  assert.equal(json.results[0].phase, 'config');
  assert.equal(json.results[0].command, '(config)');
  assert.match(json.results[0].outputTail, /list expected/);
  assert.match(json.results[0].outputTail, /unknown key bogus/);
  rmSync(dir, { recursive: true });
});

test('outputTail keeps last 40 lines', () => {
  const dir = repo('checks:\n  - node -e "for(let i=1;i<=100;i++)console.log(i)"\n');
  const { json } = cli(dir);
  const lines = json.results[0].outputTail.split('\n');
  assert.equal(lines.length, 40);
  assert.equal(lines.at(-1), '100');
  rmSync(dir, { recursive: true });
});

test('timeout kills the command and reports 124', async () => {
  const dir = repo('checks:\n  - node -e "setTimeout(()=>{},60000)"\n  - node -e "process.exit(0)"\n');
  const r = await runChecks({ cwd: dir, configSource: 'worktree', timeoutMs: 1500 });
  assert.equal(r.pass, false);
  assert.equal(r.results[0].exitCode, 124);
  assert.match(r.results[0].outputTail, /timed out/);
  assert.equal(r.results[1].exitCode, 0);
  rmSync(dir, { recursive: true });
});

test('trunk config is read from origin/<default> via gh and git', async () => {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'gh') return { code: 0, stdout: 'main\n', stderr: '' };
    if (args[0] === 'fetch') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'ls-tree') return { code: 0, stdout: '.jstack/config.yml\n', stderr: '' };
    if (args[0] === 'show') return { code: 0, stdout: 'checks:\n  - node -e "process.exit(0)"\n', stderr: '' };
    return { code: 1, stdout: '', stderr: 'unexpected' };
  };
  const dir = repo('checks:\n  - node -e "process.exit(1)"\n');
  const r = await runChecks({ cwd: dir, exec, shell: resolveShell() });
  assert.equal(r.configSource, 'trunk');
  assert.equal(r.pass, true);
  assert.ok(calls.includes('git show origin/main:.jstack/config.yml'));
  rmSync(dir, { recursive: true });
});

test('trunk config git failure fails closed', async () => {
  const exec = (cmd) => (cmd === 'gh' ? { code: 0, stdout: 'main', stderr: '' } : { code: 128, stdout: '', stderr: 'fatal: no remote' });
  const r = await runChecks({ cwd: tmpdir(), exec });
  assert.equal(r.pass, false);
  assert.equal(r.results[0].phase, 'config');
  assert.match(r.results[0].outputTail, /no remote/);
});

test('findGitBash walks up from git --exec-path and ignores System32', () => {
  const exec = () => ({ code: 0, stdout: 'C:/Program Files/Git/mingw64/libexec/git-core\n', stderr: '' });
  const seen = [];
  const exists = (p) => { seen.push(p); return /Git[\\/]bin[\\/]bash\.exe$/.test(p); };
  const found = findGitBash(exec, exists);
  assert.match(found, /Git[\\/]bin[\\/]bash\.exe$/);
  const sys = () => ({ code: 0, stdout: 'C:/Windows/System32\n', stderr: '' });
  assert.equal(findGitBash(sys, (p) => /system32/i.test(p)), null);
  assert.equal(findGitBash(() => ({ code: 1, stdout: '', stderr: '' }), () => true), null);
  const warn = resolveShell({ platform: 'win32', exec: sys, exists: () => false });
  assert.ok(warn.shellWarning);
});
