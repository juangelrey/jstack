import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseConfig, loadConfig } from './checks.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'checks.mjs');

function repo(config) {
  const dir = mkdtempSync(join(tmpdir(), 'jstack-'));
  if (config !== undefined) {
    mkdirSync(join(dir, '.jstack'));
    writeFileSync(join(dir, '.jstack', 'config.yml'), config);
  }
  return dir;
}
function cli(dir) {
  const r = spawnSync(process.execPath, [script, '--cwd', dir], { encoding: 'utf8' });
  return { code: r.status, json: JSON.parse(r.stdout) };
}

test('parses scalars, lists and nested keys', () => {
  const c = parseConfig('version: 1\nchecks:\n  - npm test\n  - npm run lint\nlimits:\n  max_retries: 3\n  max_plan_steps: 10\n');
  assert.deepEqual(c, {
    version: '1',
    checks: ['npm test', 'npm run lint'],
    limits: { max_retries: '3', max_plan_steps: '10' },
  });
});

test('strips comments outside quotes only', () => {
  const c = parseConfig("# top\nrubric: .jstack/rubric.md   # trailing\nchecks:\n  - \"echo # hi\"   # c\n  - 'a # b'\n");
  assert.equal(c.rubric, '.jstack/rubric.md');
  assert.deepEqual(c.checks, ['echo # hi', 'a # b']);
});

test('empty keys become empty lists; CRLF ok', () => {
  const c = parseConfig('protected_paths:\r\nchecks:\r\n  - x\r\n');
  assert.deepEqual(c.protected_paths, []);
  assert.deepEqual(c.checks, ['x']);
});

test('nested ship key', () => {
  assert.equal(parseConfig('ship:\n  deploy_workflow: Deploy\n').ship.deploy_workflow, 'Deploy');
});

test('missing file gives empty config', () => {
  const dir = repo();
  assert.deepEqual(loadConfig(dir), {});
  rmSync(dir, { recursive: true });
});

test('cli passes when all checks exit 0', () => {
  const dir = repo('checks:\n  - node -e "console.log(1);process.exit(0)"\n  - node -e "process.exit(0)"\n');
  const { code, json } = cli(dir);
  assert.equal(code, 0);
  assert.equal(json.pass, true);
  assert.equal(json.results.length, 2);
  const r = json.results[0];
  assert.deepEqual(Object.keys(r).sort(), ['command', 'durationMs', 'exitCode', 'outputTail']);
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

test('cli: no checks declared', () => {
  for (const dir of [repo(), repo('version: 1\nchecks:\n')]) {
    const { code, json } = cli(dir);
    assert.notEqual(code, 0);
    assert.equal(json.pass, false);
    assert.match(json.results[0].outputTail, /no checks declared/);
    rmSync(dir, { recursive: true });
  }
});

test('outputTail keeps last 40 lines', () => {
  const dir = repo('checks:\n  - node -e "for(let i=1;i<=100;i++)console.log(i)"\n');
  const { json } = cli(dir);
  const lines = json.results[0].outputTail.split('\n');
  assert.equal(lines.length, 40);
  assert.equal(lines.at(-1), '100');
  rmSync(dir, { recursive: true });
});
