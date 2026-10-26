import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, newestVerdict, authorDoor, evaluate } from './automerge.mjs';

const SHA = 'abc123def456';
const granted = { autonomy: { ship_two_way: 'dark' } };

function pr(overrides = {}) {
  return {
    number: 7,
    body: '<!-- jstack:pr task=#3 -->\nTask: #3\n\n## Merge danger\ntwo-way door: copy change only\n',
    headRefOid: SHA,
    additions: 20,
    deletions: 5,
    files: [{ path: 'src/components/Header.tsx' }],
    comments: [{ body: `<!-- jstack:verdict sha=${SHA} result=PASS door=two-way -->\n## Prove: PASS` }],
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    mergeable: 'MERGEABLE',
    ...overrides,
  };
}

test('globToRegExp handles **, * and ?', () => {
  assert.ok(globToRegExp('**/package.json').test('package.json'));
  assert.ok(globToRegExp('**/package.json').test('apps/web/package.json'));
  assert.ok(globToRegExp('.github/**').test('.github/workflows/ci.yml'));
  assert.ok(globToRegExp('**/*auth*/**').test('src/Auth/login.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
  assert.ok(globToRegExp('src/?.ts').test('src/a.ts'));
});

test('newestVerdict takes the last marker', () => {
  const v = newestVerdict([
    `<!-- jstack:verdict sha=${SHA} result=FAIL door=one-way -->`,
    'unrelated',
    `<!-- jstack:verdict sha=${SHA} result=PASS door=two-way -->`,
  ]);
  assert.deepEqual(v, { sha: SHA, result: 'PASS', door: 'two-way' });
  assert.equal(newestVerdict(['nothing here']), null);
});

test('authorDoor reads the Merge danger section', () => {
  assert.equal(authorDoor('## Merge danger\ntwo-way door: x'), 'two-way');
  assert.equal(authorDoor('## Merge danger\n\n**one-way door**: x'), 'one-way');
  assert.equal(authorDoor('no section'), null);
});

test('eligible when every guard holds', () => {
  const r = evaluate(granted, pr(), '0');
  assert.deepEqual(r.reasons, []);
  assert.equal(r.eligible, true);
});

test('not granted by default', () => {
  assert.equal(evaluate({}, pr(), '0').eligible, false);
});

test('reviewer one-way, missing door, or stale verdict blocks', () => {
  const oneWay = pr({ comments: [{ body: `<!-- jstack:verdict sha=${SHA} result=PASS door=one-way -->` }] });
  assert.equal(evaluate(granted, oneWay, '0').eligible, false);
  const noDoor = pr({ comments: [{ body: `<!-- jstack:verdict sha=${SHA} result=PASS -->` }] });
  assert.equal(evaluate(granted, noDoor, '0').eligible, false);
  const stale = pr({ headRefOid: 'fff999' });
  assert.equal(evaluate(granted, stale, '0').eligible, false);
});

test('author one-way blocks', () => {
  assert.equal(evaluate(granted, pr({ body: '## Merge danger\none-way door: migration' }), '0').eligible, false);
});

test('human-only paths block, including config additions', () => {
  assert.equal(evaluate(granted, pr({ files: [{ path: 'package-lock.json' }] }), '0').eligible, false);
  assert.equal(evaluate(granted, pr({ files: [{ path: 'db/migrations/001.sql' }] }), '0').eligible, false);
  const cfg = { ...granted, human_paths: ['src/pricing/**'] };
  assert.equal(evaluate(cfg, pr({ files: [{ path: 'src/pricing/table.ts' }] }), '0').eligible, false);
});

test('size limit, default and configured', () => {
  assert.equal(evaluate(granted, pr({ additions: 150, deletions: 60 }), '0').eligible, false);
  const cfg = { autonomy: { ship_two_way: 'dark', max_lines: '500' } };
  assert.equal(evaluate(cfg, pr({ additions: 150, deletions: 60 }), '0').eligible, true);
  const bad = { autonomy: { ship_two_way: 'dark', max_lines: 'lots' } };
  assert.equal(evaluate(bad, pr(), '0').eligible, false);
});

test('behind trunk is flagged', () => {
  const r = evaluate(granted, pr(), '2');
  assert.equal(r.eligible, false);
  assert.equal(r.behind, true);
  assert.equal(evaluate(granted, pr(), '').eligible, false);
});

test('red or pending checks and conflicts block', () => {
  assert.equal(evaluate(granted, pr({ statusCheckRollup: [{ conclusion: 'FAILURE' }] }), '0').eligible, false);
  assert.equal(evaluate(granted, pr({ statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: '' }] }), '0').eligible, false);
  assert.equal(evaluate(granted, pr({ mergeable: 'CONFLICTING' }), '0').eligible, false);
});

test('no changed files fails closed', () => {
  assert.equal(evaluate(granted, pr({ files: [] }), '0').eligible, false);
});
