import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseConfig, loadConfig, defaultConfig, globToRegExp, BUILTIN_PROTECTED } from './config.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'config.mjs');

test('parses lists, flow lists, nested keys; numbers are numbers', () => {
  const { config, errors } = parseConfig(
    'version: 1\nsetup: [npm ci]\nchecks:\n  - npm test\n  - npm run lint\nlimits:\n  max_retries: 2\n  max_plan_steps: 10\nmodels:\n  planner: opus\n  security-reviewer: haiku\n',
  );
  assert.deepEqual(errors, []);
  assert.equal(config.version, 1);
  assert.deepEqual(config.setup, ['npm ci']);
  assert.deepEqual(config.checks, ['npm test', 'npm run lint']);
  assert.deepEqual(config.limits, { max_retries: 2, max_plan_steps: 10, check_timeout_minutes: 15, max_open_prs: 1 });
  assert.deepEqual(config.models, { planner: 'opus', 'security-reviewer': 'haiku' });
});

test('defaults cover every key', () => {
  const d = defaultConfig();
  assert.deepEqual(d, {
    version: 1, setup: [], checks: [], protected_paths: [...BUILTIN_PROTECTED], protected_paths_configured: [], rubric: null,
    limits: { max_retries: 3, max_plan_steps: 10, check_timeout_minutes: 15, max_open_prs: 1 },
    ship: { deploy_workflow: null }, autonomy: { ship_two_way: 'lit', max_lines: 200 }, human_paths: [], labels: { prefix: 'state' }, models: {},
  });
  assert.deepEqual(parseConfig('').config, d);
});

test('builtin protected paths are always included', () => {
  const { config } = parseConfig('protected_paths:\n  - .github/workflows/**\n');
  assert.deepEqual(config.protected_paths, ['.jstack/**', '.github/workflows/**']);
  assert.deepEqual(config.protected_paths_configured, ['.github/workflows/**']);
});

test('strips comments outside quotes only; flow quotes', () => {
  const { config, errors } = parseConfig("# top\nrubric: .jstack/rubric.md   # trailing\nchecks:\n  - \"echo # hi\"   # c\n  - 'a # b'\nhuman_paths: [a, \"b, c\", 'd']\n");
  assert.deepEqual(errors, []);
  assert.equal(config.rubric, '.jstack/rubric.md');
  assert.deepEqual(config.checks, ['echo # hi', 'a # b']);
  assert.deepEqual(config.human_paths, ['a', 'b, c', 'd']);
});

test('empty keys become defaults; CRLF ok', () => {
  const { config, errors } = parseConfig('protected_paths:\r\nchecks:\r\n  - x\r\nlimits:\r\n');
  assert.deepEqual(errors, []);
  assert.deepEqual(config.protected_paths_configured, []);
  assert.deepEqual(config.checks, ['x']);
  assert.equal(config.limits.max_retries, 3);
});

test('every kind of error is reported, never skipped', () => {
  const cases = {
    '\tchecks:\n': /tab indentation/,
    'checks:\n\t- x\n': /tab indentation/,
    'what is this\n': /cannot parse/,
    'bogus: 1\n': /unknown key bogus/,
    'limits:\n  nope: 1\n': /unknown key limits.nope/,
    'checks: npm test\n': /checks: list expected/,
    'rubric:\n  - a\n': /rubric: scalar expected/,
    'limits: 3\n': /limits: object expected/,
    'limits:\n  - 3\n': /limits: object expected/,
    'checks:\n  a: b\n': /checks: list expected/,
    'checks:\n  - a\n  b: c\n': /not an object/,
    'version: 2\n': /version: must be 1/,
    'limits:\n  max_retries: -1\n': /integer expected/,
    'limits:\n  max_plan_steps: 0\n': />= 1/,
    'limits:\n  max_retries: "3"\n': /integer expected/,
    'autonomy:\n  ship_two_way: grey\n': /lit\|dark/,
    'models:\n  planner: gpt\n': /haiku\|sonnet\|opus/,
    'checks: [a, b\n': /unterminated/,
    'rubric: "abc\n': /unterminated quote/,
    'checks:\n  -\n': /empty list item/,
    'checks: [a]\n  - b\n': /not a list/,
    '  - a\n': /before any key/,
    'checks: []\nchecks: []\n': /duplicate key/,
    'limits:\n  max_retries: [1]\n': /scalar expected/,
  };
  for (const [text, re] of Object.entries(cases)) {
    const { errors } = parseConfig(text);
    assert.ok(errors.some((e) => re.test(e)), `${JSON.stringify(text)} -> ${JSON.stringify(errors)}`);
  }
});

test('worktree load: missing file gives defaults, found false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jstack-'));
  const r = loadConfig({ cwd: dir, source: 'worktree' });
  assert.equal(r.ok, true);
  assert.equal(r.found, false);
  assert.deepEqual(r.config, defaultConfig());
  rmSync(dir, { recursive: true });
});

test('trunk load: missing file is not an error; other git errors are', () => {
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  const missing = (cmd, args) => (cmd === 'gh' ? ok('main') : args[0] === 'ls-tree' ? ok('') : ok());
  const r = loadConfig({ source: 'trunk', exec: missing });
  assert.deepEqual([r.ok, r.found, r.ref], [true, false, 'origin/main']);
  const broken = (cmd) => (cmd === 'gh' ? ok('main') : { code: 128, stdout: '', stderr: 'fatal: bad' });
  const b = loadConfig({ source: 'trunk', exec: broken });
  assert.equal(b.ok, false);
  assert.match(b.errors[0], /fatal: bad/);
  const noGh = () => ({ code: 1, stdout: '', stderr: 'not logged in' });
  assert.equal(loadConfig({ source: 'trunk', exec: noGh }).ok, false);
});

test('cli --worktree prints one JSON object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jstack-'));
  mkdirSync(join(dir, '.jstack'));
  writeFileSync(join(dir, '.jstack', 'config.yml'), 'checks: [npm test]\nlimits:\n  max_retries: x\n');
  const r = spawnSync(process.execPath, [script, '--cwd', dir, '--worktree'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  const json = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(json).sort(), ['config', 'errors', 'found', 'ok', 'ref', 'source']);
  assert.equal(json.found, true);
  assert.match(json.errors[0], /max_retries/);
  rmSync(dir, { recursive: true });
});

test('globToRegExp handles **, * and ?', () => {
  assert.ok(globToRegExp('**/package.json').test('package.json'));
  assert.ok(globToRegExp('**/package.json').test('apps/web/package.json'));
  assert.ok(globToRegExp('.jstack/**').test('.jstack/config.yml'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
  assert.ok(globToRegExp('src/?.ts').test('src/a.ts'));
});
