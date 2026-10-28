import { test } from 'node:test';
import assert from 'node:assert/strict';
import { charterReasons, driftReasons, planFacts, planPaths } from './charter.mjs';
import { defaultConfig } from './config.mjs';

const TASK = '<!-- jstack:task spec=#2 size=S -->\n## Description\nslice\n\n## Acceptance criteria\n- [ ] one\n\n## Verification steps\n1. run it\n\n## Dependencies\nNone\n';
const PLAN = '<!-- jstack:plan -->\n## Plan\n**Goal**: g\n**Files**:\n- `src/greet.js`\n- `test/greet.test.js` (new)\n**Tests first**:\n- greets: one\n**Steps**:\n1. a\n**Risks**: none\n**Door**: two-way\n**New dependencies**: None\n**Existing tests changed**: None\n**Out of scope**: x\n';
const dark = (autonomy = {}) => {
  const c = defaultConfig();
  c.autonomy = { ...c.autonomy, plan: 'dark', ...autonomy };
  return c;
};
const input = (over = {}) => ({ config: dark(), task: { size: 'S', body: TASK }, plan: { body: PLAN }, feedback: [], ...over });

test('planPaths: backticks, else lines and commas without notes', () => {
  assert.deepEqual(planPaths('- `src/a.js`\n- `./test/a.test.js` (new)'), ['src/a.js', 'test/a.test.js']);
  assert.deepEqual(planPaths('src/a.js, src/b.js'), ['src/a.js', 'src/b.js']);
  assert.deepEqual(planPaths('- src/a.js (new)\n- src\\b.js: change'), ['src/a.js', 'src/b.js']);
});

test('planFacts: reads the declared fields, null when missing', () => {
  assert.deepEqual(planFacts(PLAN), { files: ['src/greet.js', 'test/greet.test.js'], door: 'two-way', addsDependencies: false, testsChanged: [] });
  const bare = planFacts('<!-- jstack:plan -->\n**Goal**: g\n');
  assert.deepEqual(bare, { files: null, door: null, addsDependencies: null, testsChanged: null });
  assert.deepEqual(planFacts(PLAN.replace('**Existing tests changed**: None', '**Existing tests changed**: `test/old.test.js`')).testsChanged, ['test/old.test.js']);
});

test('charter approves a small, two-way, self-contained plan only when dark', () => {
  assert.deepEqual(charterReasons(input()), []);
  assert.match(charterReasons(input({ config: defaultConfig() })).join(), /autonomy.plan is lit/);
});

test('charter needs a human for size, feedback, invalid plans and missing plans', () => {
  assert.match(charterReasons(input({ task: { size: 'M', body: TASK } })).join(), /size M is over autonomy.plan_max_size S/);
  assert.deepEqual(charterReasons(input({ config: dark({ plan_max_size: 'M' }), task: { size: 'M', body: TASK } })), []);
  assert.match(charterReasons(input({ task: { size: null, body: TASK } })).join(), /size is unknown/);
  assert.match(charterReasons(input({ feedback: [{ body: 'use a class' }] })).join(), /feedback/);
  assert.match(charterReasons(input({ plan: { body: PLAN.replace('**Goal**: g\n', '') } })).join(), /plan: missing Goal/);
  assert.match(charterReasons(input({ plan: null })).join(), /no trusted plan/);
});

test('charter needs a human for one-way doors, dependencies, test edits and human paths', () => {
  assert.match(charterReasons(input({ plan: { body: PLAN.replace('two-way', 'one-way') } })).join(), /door is one-way/);
  assert.match(charterReasons(input({ plan: { body: PLAN.replace('**New dependencies**: None', '**New dependencies**: lodash') } })).join(), /adds dependencies/);
  assert.match(charterReasons(input({ plan: { body: PLAN.replace('**Existing tests changed**: None', '**Existing tests changed**: `test/old.test.js`') } })).join(), /changes existing tests: test\/old.test.js/);
  assert.match(charterReasons(input({ plan: { body: PLAN.replace('src/greet.js', 'src/auth/login.js') } })).join(), /human-only paths: src\/auth\/login.js/);
  assert.match(charterReasons(input({ plan: { body: PLAN.replace('src/greet.js', 'package.json') } })).join(), /human-only paths: package.json/);
  const cfg = dark();
  cfg.human_paths = ['src/core/**'];
  assert.match(charterReasons(input({ config: cfg, plan: { body: PLAN.replace('src/greet.js', 'src/core/x.js') } })).join(), /human-only paths: src\/core\/x.js/);
});

test('drift: clean when the diff stays inside Files', () => {
  assert.deepEqual(driftReasons(PLAN, [{ filename: 'src/greet.js', status: 'modified' }, { filename: 'test/greet.test.js', status: 'added' }]), []);
  const globbed = PLAN.replace('- `src/greet.js`', '- `src/**`');
  assert.deepEqual(driftReasons(globbed, [{ filename: 'src/a/b.js', status: 'added' }]), []);
});

test('drift: undeclared files, renames and undeclared test edits', () => {
  assert.match(driftReasons(PLAN, [{ filename: 'src/other.js', status: 'modified' }]).join(), /not in the plan: src\/other.js/);
  assert.match(driftReasons(PLAN, [{ filename: 'src/greet.js', previous_filename: 'src/hello.js', status: 'renamed' }]).join(), /not in the plan: src\/hello.js/);
  assert.match(driftReasons(PLAN, [{ filename: 'test/greet.test.js', status: 'modified' }]).join(), /existing tests the plan did not declare: test\/greet.test.js/);
  const declared = PLAN.replace('**Existing tests changed**: None', '**Existing tests changed**: `test/greet.test.js`');
  assert.deepEqual(driftReasons(declared, [{ filename: 'test/greet.test.js', status: 'modified' }]), []);
});

test('drift fails closed on unreadable input', () => {
  assert.match(driftReasons('<!-- jstack:plan -->\n', [{ filename: 'a', status: 'added' }]).join(), /no Files/);
  assert.match(driftReasons(PLAN, []).join(), /could not read/);
  assert.match(driftReasons(PLAN, [{ status: 'added' }]).join(), /could not read/);
});
