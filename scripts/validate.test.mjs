import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  validate, validateIntent, validateSpec, validateTask, validatePlan, validatePr, validateVerdict, validateCommitMsg, closingKeywords,
} from './validate.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'validate.mjs');
const SHA = 'c'.repeat(40);

const INTENT = '## Outcome\nA\n## Why\nB\n## Who benefits\nC\n## Success signals\nD\n## In scope\nE\n## Out of scope\nNone\n## Constraints\nG\n## Known unknowns\nNone\n';
const TASK = '<!-- jstack:task spec=#2 size=S -->\n## Description\nslice\n\n## Acceptance criteria\n- [ ] one\n- [ ] two\n\n## Verification steps\n1. open it\n\n## Dependencies\n- #3\n';
const PLAN = '<!-- jstack:plan -->\n## Plan\n**Goal**: g\n**Files**: a.js\n**Tests first**:\n- t1\n- t2\n**Steps**:\n1. a\n2. b\n**Risks**: none\n**Door**: two-way\n**New dependencies**: None\n**Existing tests changed**: None\n**Out of scope**: x\n';
const PR = '<!-- jstack:pr task=#9 -->\nTask: #9\n\n## Summary\ns\n\n## Evidence\ne\n\n## Merge danger\ntwo-way door: copy only\n';
const verdictText = ({ result = 'PASS', door = 'two-way', verify = 'machine', checks = 'PASS', review = 'PASS', verifier = 'PASS', security = 'PASS', tdoor = door, sha = SHA } = {}) =>
  `<!-- jstack:verdict sha=${sha} result=${result} door=${door} verify=${verify} -->\n## Prove: ${result}\n| Gate | Result |\n|---|---|\n| Checks | ${checks} |\n| Review | ${review} |\n| Verifier | ${verifier} |\n| Security | ${security} |\n| Door (reviewer) | ${tdoor} |\n`;

test('intent: all sections, in order, non-empty', () => {
  assert.deepEqual(validateIntent(INTENT), []);
  assert.match(validateIntent(INTENT.replace('## Why\nB\n', '')).join(), /missing section ## Why/);
  assert.match(validateIntent(INTENT.replace('## Why\nB', '## Why\n')).join(), /Why is empty/);
  const swapped = INTENT.replace('## Outcome\nA\n## Why\nB\n', '## Why\nB\n## Outcome\nA\n');
  assert.match(validateIntent(swapped).join(), /out of order/);
  assert.match(validateIntent(`${INTENT}## Why\nagain\n`).join(), /appears 2 times/);
});

test('spec: marker, tasks lines, draft', () => {
  const spec = '<!-- jstack:spec intent=#1 -->\n## Spec\nbehavior\n\n## Tasks\n- [ ] #3 First\n- [x] #4 Second\n';
  assert.deepEqual(validateSpec(spec), []);
  const empty = '<!-- jstack:spec intent=#1 -->\n## Spec\nbehavior\n\n## Tasks\n';
  assert.match(validateSpec(empty).join(), /--draft/);
  assert.deepEqual(validateSpec(empty, { draft: true }), []);
  assert.match(validateSpec(spec.replace('#4 Second', 'Second')).join(), /bad task line/);
  assert.match(validateSpec(spec.replace('<!-- jstack:spec intent=#1 -->', '')).join(), /marker/);
});

test('task: marker, size L, sections, deps', () => {
  assert.deepEqual(validateTask(TASK), []);
  assert.deepEqual(validateTask(TASK, { known: [3] }), []);
  assert.match(validateTask(TASK, { known: [4] }).join(), /#3 is not a known/);
  assert.match(validateTask(TASK.replace('size=S', 'size=L')).join(), /--allow-l/);
  assert.deepEqual(validateTask(TASK.replace('size=S', 'size=L'), { allowL: true }), []);
  assert.match(validateTask(TASK.replace('- [ ] one\n- [ ] two', 'one')).join(), /at least one/);
  assert.match(validateTask(TASK.replace('1. open it', 'open it')).join(), /numbered/);
  assert.deepEqual(validateTask(TASK.replace('- #3', 'None')), []);
  assert.match(validateTask(TASK.replace('- #3', 'task three')).join(), /bad dependency/);
  const big = TASK.replace('- [ ] one', Array.from({ length: 8 }, (_, i) => `- [ ] c${i}`).join('\n'));
  assert.match(validateTask(big).join(), /too big/);
});

test('plan: marker, fields, steps, tests vs criteria, length', () => {
  assert.deepEqual(validatePlan(PLAN, { maxSteps: 10, taskText: TASK }), []);
  assert.match(validatePlan(PLAN, { maxSteps: 1, taskText: TASK }).join(), /must be 1\.\.1/);
  assert.match(validatePlan(`x\n${PLAN}`, { maxSteps: 10, taskText: TASK }).join(), /first line/);
  assert.match(validatePlan(PLAN.replace('**Risks**: none\n', ''), { maxSteps: 10, taskText: TASK }).join(), /missing Risks/);
  assert.match(validatePlan(PLAN.replace('- t2\n', ''), { maxSteps: 10, taskText: TASK }).join(), /fewer than/);
  const semi = PLAN.replace('**Tests first**:\n- t1\n- t2\n', '**Tests first**: t1; t2\n');
  assert.deepEqual(validatePlan(semi, { maxSteps: 10, taskText: TASK }), []);
  const headings = '<!-- jstack:plan -->\n## Goal\ng\n## Files\nf\n## Tests first\n1. a\n2. b\n## Steps\n1. s\n## Risks\nr\n## Door\ntwo-way door\n## New dependencies\nNone\n## Existing tests changed\nNone\n## Out of scope\no\n';
  assert.deepEqual(validatePlan(headings, { maxSteps: 3, taskText: TASK }), []);
  assert.match(validatePlan(PLAN.replace('two-way', 'maybe'), { maxSteps: 10, taskText: TASK }).join(), /Door must start/);
  assert.match(validatePlan(PLAN.replace('**Door**: two-way\n', ''), { maxSteps: 10, taskText: TASK }).join(), /missing Door/);
  const long = PLAN + 'x\n'.repeat(260);
  assert.match(validatePlan(long, { maxSteps: 10, taskText: TASK }).join(), /over 250/);
});

test('pr: marker, Task line, sections, door, no closing keywords', () => {
  assert.deepEqual(validatePr(PR, { task: 9 }), []);
  assert.match(validatePr(PR, { task: 8 }).join(), /marker/);
  assert.match(validatePr(PR.replace('two-way door', 'probably fine'), { task: 9 }).join(), /Merge danger must start/);
  assert.match(validatePr(PR.replace('## Summary\ns', '## Summary\nFixes #9'), { task: 9 }).join(), /closing keyword/);
  assert.match(validatePr(PR, { task: 9, title: 'resolves #12: x' }).join(), /closing keyword/);
  assert.deepEqual(validatePr(PR.replace('two-way door', 'one-way door'), { task: 9 }), []);
});

test('closing keywords', () => {
  assert.deepEqual(closingKeywords('Closes #1, fixed: #2, Resolve o/r#3, fixes https://github.com/o/r/issues/4'), ['Closes #1', 'fixed: #2', 'Resolve o/r#3', 'fixes https://github.com/o/r/issues/4']);
  assert.deepEqual(closingKeywords('Task: #1, fixing the closest #2 thing, prefix #3'), []);
  assert.deepEqual(validateCommitMsg('feat: x (#3)'), []);
  assert.equal(validateCommitMsg('fix: x\n\nfixes #3').length, 1);
});

test('verdict: marker, sha, table, consistency', () => {
  assert.deepEqual(validateVerdict(verdictText(), { sha: SHA }), []);
  assert.match(validateVerdict(verdictText(), { sha: 'd'.repeat(40) }).join(), /is not/);
  assert.match(validateVerdict(verdictText({ review: 'FAIL' }), { sha: SHA }).join(), /imply FAIL/);
  assert.deepEqual(validateVerdict(verdictText({ result: 'FAIL', review: 'FAIL' }), { sha: SHA }), []);
  assert.match(validateVerdict(verdictText({ result: 'FAIL', checks: 'ERROR' }), { sha: SHA }).join(), /imply ERROR/);
  assert.deepEqual(validateVerdict(verdictText({ verify: 'human', verifier: 'PASS+HUMAN' }), { sha: SHA }), []);
  assert.match(validateVerdict(verdictText({ verifier: 'PASS+HUMAN' }), { sha: SHA }).join(), /verify=machine/);
  assert.deepEqual(validateVerdict(verdictText({ verifier: 'PASS+NOTES' }), { sha: SHA }), []);
  assert.match(validateVerdict(verdictText({ tdoor: 'one-way' }), { sha: SHA }).join(), /door/);
  assert.match(validateVerdict(verdictText().replace(/\| Security.*\n/, ''), { sha: SHA }).join(), /missing table row Security/);
  assert.match(validateVerdict(verdictText().replace(' verify=machine', ''), { sha: SHA }).join(), /marker/);
  assert.match(validateVerdict(verdictText(), { sha: 'abc' }).join(), /40-hex/);
});

test('cli prints one JSON object; missing file fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jstack-v-'));
  const f = join(dir, 'pr.md');
  writeFileSync(f, PR);
  let r = spawnSync(process.execPath, [script, 'pr', '--file', f, '--task', '9'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, errors: [] });
  r = spawnSync(process.execPath, [script, 'pr', '--file', join(dir, 'nope.md'), '--task', '9'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).ok, false);
  assert.equal(validate(['bogus', '--file', f]).ok, false);
  const files = { 'p.md': PLAN, 't.md': TASK };
  assert.equal(validate(['plan', '--file', 'p.md', '--max-steps', '5', '--task-file', 't.md'], (x) => files[x]).ok, true);
  assert.equal(validate(['task', '--file', 't.md', '--known', '3,4'], (x) => files[x]).ok, true);
  rmSync(dir, { recursive: true });
});
