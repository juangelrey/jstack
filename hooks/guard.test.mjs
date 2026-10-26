import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkBash, checkEdit, decide, segments, REASONS } from './guard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'guard.mjs');

test('segments split on shell operators and respect quotes', () => {
  assert.deepEqual(segments(`a "b c" 'd;e' && f | g; h\\ i $(j k)`), [['a', 'b c', 'd;e'], ['f'], ['g'], ['h i'], ['j', 'k']]);
});

test('blocks adding jstack:approved in any common form', () => {
  for (const c of [
    'gh issue edit 5 --add-label jstack:approved',
    'gh issue edit 5 --add-label "bug,jstack:approved"',
    'gh issue edit 5 --add-label=jstack:approved',
    'gh pr edit 5 --add-label JSTACK:APPROVED',
    'gh issue create -t x -l jstack:approved',
    'gh api repos/o/r/issues/5/labels -f "labels[]=jstack:approved"',
    'gh api -X POST repos/o/r/issues/5/labels --raw-field labels[]=jstack%3Aapproved',
    'cd x && /usr/bin/gh issue edit 5 --add-label jstack:approved',
    'bash -c "gh issue edit 5 --add-label jstack:approved"',
  ]) assert.equal(checkBash(c), REASONS.approved, c);
});

test('allows reading or removing jstack:approved, and normal moves', () => {
  for (const c of [
    'gh issue edit 5 --remove-label jstack:planned --remove-label jstack:approved --add-label jstack:implementing',
    'gh issue list --label jstack:approved',
    'gh api repos/o/r/issues?labels=jstack:approved',
    'gh api -X DELETE repos/o/r/issues/5/labels/jstack:approved',
    'gh label create jstack:approved --force --color 0E8A16',
    'echo jstack:approved',
  ]) assert.equal(checkBash(c), null, c);
});

test('blocks removing jstack:blocked', () => {
  assert.equal(checkBash('gh issue edit 5 --remove-label jstack:blocked --add-label jstack:ready'), REASONS.blocked);
  assert.equal(checkBash('gh api -X DELETE repos/o/r/issues/5/labels/jstack%3Ablocked'), REASONS.blocked);
  assert.equal(checkBash('gh issue edit 5 --remove-label jstack:proving --add-label jstack:blocked'), null);
});

test('blocks bypassing signing or hooks', () => {
  for (const c of [
    'git commit --no-verify -m x',
    'git commit -nm "x"',
    'git -c commit.gpgsign=false commit -m x',
    'git commit --no-gpg-sign -m x',
    'git push --no-verify',
    'git config commit.gpgsign false',
    'git -c core.hooksPath=/dev/null commit -m x',
  ]) assert.equal(checkBash(c), REASONS.bypass, c);
  for (const c of ['git commit -m "no -n here"', 'git commit -am x', 'git commit -m -n', 'git push -u origin jstack/3-x', 'npm test -- --no-verify']) {
    assert.equal(checkBash(c), null, c);
  }
});

test('gh pr merge needs --match-head-commit', () => {
  assert.equal(checkBash('gh pr merge 5 --squash'), REASONS.merge);
  assert.equal(checkBash(`gh pr merge 5 --squash --match-head-commit ${'a'.repeat(40)}`), null);
  assert.equal(checkBash(`gh pr merge 5 --match-head-commit=${'a'.repeat(40)}`), null);
  assert.equal(checkBash('gh api -X PUT repos/o/r/pulls/5/merge'), REASONS.merge);
  assert.equal(checkBash('gh pr view 5'), null);
});

test('edit guard only applies on jstack/ branches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jstack-g-'));
  const fake = (branch) => (args) => (args[0] === 'symbolic-ref' ? `${branch}\n` : `${dir.replace(/\\/g, '/')}\n`);
  const read = () => 'protected_paths:\n  - .github/workflows/**\n';
  mkdirSync(join(dir, '.jstack'));
  writeFileSync(join(dir, '.jstack', 'config.yml'), '');
  assert.equal(checkEdit(join(dir, '.jstack', 'config.yml'), fake('jstack/3-x'), read), 'protected path: .jstack/config.yml');
  assert.equal(checkEdit(join(dir, '.github', 'workflows', 'ci.yml'), fake('jstack/3-x'), read), 'protected path: .github/workflows/ci.yml');
  assert.equal(checkEdit(join(dir, 'src', 'a.ts'), fake('jstack/3-x'), read), null);
  assert.equal(checkEdit(join(dir, '.jstack', 'config.yml'), fake('main'), read), null);
  assert.equal(checkEdit(join(dir, '.jstack', 'config.yml'), () => null, read), null);
  rmSync(dir, { recursive: true });
});

test('edit guard against a real git worktree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jstack-g-'));
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('checkout', '-q', '-b', 'jstack/7-thing');
  mkdirSync(join(dir, '.jstack'));
  writeFileSync(join(dir, '.jstack', 'config.yml'), 'protected_paths: [secret/**]\n');
  const payload = (file) => JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file, content: 'x' }, cwd: dir });
  assert.deepEqual(decide(payload(join(dir, 'secret', 'new', 'k.txt'))), { code: 2, reason: 'protected path: secret/new/k.txt' });
  assert.deepEqual(decide(payload('src/ok.ts')), { code: 0 });
  rmSync(dir, { recursive: true, force: true });
});

test('decide: internal errors allow, unless clearly guarded', () => {
  assert.deepEqual(decide('not json'), { code: 0 });
  assert.deepEqual(decide(JSON.stringify({ tool_name: 'Read', tool_input: {} })), { code: 0 });
  const broken = '{"tool_name": "Bash", "tool_input": {"command": "gh issue edit 1 --add-label jstack:approved"';
  assert.equal(decide(broken).code, 2);
});

test('cli exits 2 with a one-line reason, 0 otherwise', () => {
  const run = (obj) => spawnSync(process.execPath, [script], { input: JSON.stringify(obj), encoding: 'utf8' });
  let r = run({ tool_name: 'Bash', tool_input: { command: 'gh pr merge 3' }, cwd: here });
  assert.equal(r.status, 2);
  assert.equal(r.stderr.trim(), REASONS.merge);
  r = run({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: here });
  assert.equal(r.status, 0);
});

test('hooks.json wires the guard for Bash and edit tools', () => {
  const h = JSON.parse(readFileSync(join(here, 'hooks.json'), 'utf8'));
  const pre = h.hooks.PreToolUse;
  assert.deepEqual(pre.map((x) => x.matcher), ['Bash', 'Edit|Write|MultiEdit|NotebookEdit']);
  for (const m of pre) assert.equal(m.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs"');
});
