import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, newestVerdict, authorDoor, evaluate, checksState, run } from './automerge.mjs';
import { parseConfig } from './config.mjs';

const SHA = 'a1'.repeat(20);
const cfg = (text) => parseConfig(text).config;
const granted = cfg('autonomy:\n  ship_two_way: dark\n');
const isTrusted = (l) => l === 'alice' || l === 'bob';
const verdictBody = (extra = '', sha = SHA) => `<!-- jstack:verdict sha=${sha} result=PASS door=two-way verify=machine${extra} -->\n## Prove: PASS`;

function pr(overrides = {}) {
  return {
    number: 7,
    title: 'Header copy',
    body: '<!-- jstack:pr task=#3 -->\nTask: #3\n\n## Merge danger\ntwo-way door: copy change only\n',
    headRefOid: SHA,
    headRefName: 'jstack/3-header-copy',
    baseRefName: 'main',
    state: 'OPEN',
    isDraft: false,
    isCrossRepository: false,
    author: { login: 'alice' },
    additions: 20,
    deletions: 5,
    changedFiles: 1,
    comments: [{ author: { login: 'bob' }, body: verdictBody(), createdAt: '2026-10-26T10:00:00Z' }],
    statusCheckRollup: [{ __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    mergeable: 'MERGEABLE',
    ...overrides,
  };
}
const facts = (overrides = {}) => ({ behindBy: '0', defaultBranch: 'main', files: [{ filename: 'src/components/Header.tsx' }], isTrusted, ...overrides });
const why = (c, p, f) => evaluate(c, p, f).reasons.join(' | ');

test('globToRegExp handles **, * and ?', () => {
  assert.ok(globToRegExp('**/package.json').test('package.json'));
  assert.ok(globToRegExp('**/package.json').test('apps/web/package.json'));
  assert.ok(globToRegExp('.github/**').test('.github/workflows/ci.yml'));
  assert.ok(globToRegExp('**/*auth*/**').test('src/Auth/login.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
  assert.ok(globToRegExp('src/?.ts').test('src/a.ts'));
});

test('newestVerdict takes the last trusted marker', () => {
  const c = (login, body, m) => ({ author: { login }, body, createdAt: `2026-10-26T10:0${m}:00Z` });
  const v = newestVerdict([
    c('bob', `<!-- jstack:verdict sha=${SHA} result=FAIL door=one-way verify=machine -->`, 1),
    c('bob', 'unrelated', 2),
    c('bob', verdictBody(), 3),
    c('mallory', `<!-- jstack:verdict sha=${SHA} result=FAIL door=one-way -->`, 4),
  ], isTrusted);
  assert.deepEqual(v, { sha: SHA, result: 'PASS', door: 'two-way', verify: 'machine' });
  assert.equal(newestVerdict([c('bob', 'nothing', 1)], isTrusted), null);
});

test('authorDoor reads the Merge danger section', () => {
  assert.equal(authorDoor('## Merge danger\ntwo-way door: x'), 'two-way');
  assert.equal(authorDoor('## Merge danger\n\n**one-way door**: x'), 'one-way');
  assert.equal(authorDoor('no section'), null);
});

test('eligible when every guard holds', () => {
  const r = evaluate(granted, pr(), facts());
  assert.deepEqual(r.reasons, []);
  assert.equal(r.eligible, true);
  assert.equal(r.task, 3);
});

test('not granted by default', () => {
  assert.match(why(cfg(''), pr(), facts()), /not granted/);
});

test('PR shape guards', () => {
  assert.match(why(granted, pr({ state: 'MERGED' }), facts()), /not open/);
  assert.match(why(granted, pr({ isDraft: true }), facts()), /draft/);
  assert.match(why(granted, pr({ baseRefName: 'dev' }), facts()), /default branch/);
  assert.match(why(granted, pr(), facts({ defaultBranch: undefined })), /default branch/);
  assert.match(why(granted, pr({ isCrossRepository: true }), facts()), /fork/);
  assert.match(why(granted, pr({ author: { login: 'mallory' } }), facts()), /not a trusted/);
  assert.match(why(granted, pr({ body: '## Merge danger\ntwo-way door: x' }), facts()), /no <!-- jstack:pr/);
  assert.match(why(granted, pr({ headRefName: 'feature/x' }), facts()), /not jstack\/3-/);
  assert.match(why(granted, pr({ headRefName: 'jstack/3-revert' }), facts()), /revert/);
});

test('untrusted verdicts are ignored', () => {
  const spoof = pr({ comments: [{ author: { login: 'mallory' }, body: verdictBody(), createdAt: '2026-10-26T10:00:00Z' }] });
  assert.match(why(granted, spoof, facts()), /no trusted verdict/);
});

test('reviewer one-way, missing door, missing verify, human verify, or stale verdict blocks', () => {
  const v = (body) => pr({ comments: [{ author: { login: 'bob' }, body, createdAt: '2026-10-26T10:00:00Z' }] });
  assert.match(why(granted, v(`<!-- jstack:verdict sha=${SHA} result=PASS door=one-way verify=machine -->`), facts()), /reviewer/);
  assert.match(why(granted, v(`<!-- jstack:verdict sha=${SHA} result=PASS -->`), facts()), /reviewer/);
  assert.match(why(granted, v(`<!-- jstack:verdict sha=${SHA} result=PASS door=two-way -->`), facts()), /verify is not machine/);
  assert.match(why(granted, v(`<!-- jstack:verdict sha=${SHA} result=PASS door=two-way verify=human -->`), facts()), /verify is not machine/);
  assert.match(why(granted, pr({ headRefOid: 'f'.repeat(40) }), facts()), /current head/);
});

test('author one-way blocks', () => {
  assert.match(why(granted, pr({ body: '<!-- jstack:pr task=#3 -->\n## Merge danger\none-way door: migration' }), facts()), /author/);
});

test('human-only paths block, including builtin protected, config additions and renames', () => {
  assert.match(why(granted, pr(), facts({ files: [{ filename: 'package-lock.json' }] })), /human-only/);
  assert.match(why(granted, pr(), facts({ files: [{ filename: 'db/migrations/001.sql' }] })), /human-only/);
  const c = cfg('autonomy:\n  ship_two_way: dark\nhuman_paths:\n  - src/pricing/**\n');
  assert.match(why(c, pr(), facts({ files: [{ filename: 'src/pricing/table.ts' }] })), /human-only/);
  assert.match(why(c, pr(), facts({ files: [{ filename: 'src/x.ts', previous_filename: 'src/pricing/x.ts' }] })), /src\/pricing\/x\.ts/);
  assert.ok(granted.protected_paths.includes('.jstack/**'));
});

test('size limit, default and configured', () => {
  assert.match(why(granted, pr({ additions: 150, deletions: 60 }), facts()), /over the 200/);
  const big = cfg('autonomy:\n  ship_two_way: dark\n  max_lines: 500\n');
  assert.equal(evaluate(big, pr({ additions: 150, deletions: 60 }), facts()).eligible, true);
});

test('behind trunk is flagged; unknown fails closed', () => {
  const r = evaluate(granted, pr(), facts({ behindBy: '2' }));
  assert.equal(r.eligible, false);
  assert.equal(r.behind, true);
  assert.equal(evaluate(granted, pr(), facts({ behindBy: '' })).eligible, false);
});

test('checks: empty, pending, red; mergeable', () => {
  let r = evaluate(granted, pr({ statusCheckRollup: [] }), facts());
  assert.deepEqual([r.eligible, r.pending], [false, true]);
  assert.match(r.reasons[0], /no GitHub checks reported/);
  r = evaluate(granted, pr({ statusCheckRollup: [{ name: 'ci', status: 'IN_PROGRESS', conclusion: '' }] }), facts());
  assert.deepEqual([r.eligible, r.pending], [false, true]);
  r = evaluate(granted, pr({ statusCheckRollup: [{ name: 'ci', status: 'COMPLETED', conclusion: 'FAILURE' }] }), facts());
  assert.deepEqual([r.eligible, r.pending], [false, false]);
  r = evaluate(granted, pr({ mergeable: 'UNKNOWN' }), facts());
  assert.deepEqual([r.eligible, r.pending], [false, true]);
  assert.match(why(granted, pr({ mergeable: 'CONFLICTING' }), facts()), /not mergeable/);
  assert.equal(checksState([{ __typename: 'StatusContext', context: 'x', state: 'PENDING' }]).state, 'pending');
  assert.equal(checksState([{ __typename: 'StatusContext', context: 'x', state: 'ERROR' }]).state, 'red');
  assert.equal(checksState([{ name: 'a', status: 'COMPLETED', conclusion: 'SKIPPED' }, { context: 'b', state: 'SUCCESS' }]).state, 'green');
});

test('no or mismatched changed files fails closed', () => {
  assert.match(why(granted, pr(), facts({ files: [] })), /could not read changed files/);
  assert.match(why(granted, pr({ changedFiles: 2 }), facts()), /read 1 changed files/);
});

/** Fake gh/git for run(). `state` is mutable so polls can change. */
function fakeExec(state) {
  return (cmd, args) => {
    const key = args.join(' ');
    const ok = (v) => ({ code: 0, stdout: typeof v === 'string' ? v : JSON.stringify(v), stderr: '' });
    const perm = key.match(/collaborators\/([^/]+)\/permission/);
    if (perm) return isTrusted(perm[1]) ? ok('write') : { code: 1, stdout: '', stderr: '404' };
    if (key.startsWith('repo view')) return ok('main\n');
    if (cmd === 'git' && args[0] === 'fetch') return ok('');
    if (cmd === 'git' && args[0] === 'ls-tree') return ok('.jstack/config.yml\n');
    if (cmd === 'git' && args[0] === 'show') return ok(state.config ?? 'autonomy:\n  ship_two_way: dark\n');
    if (key.startsWith('pr view')) { state.views = (state.views ?? 0) + 1; return ok(state.pr()); }
    if (key.startsWith('api repos/{owner}/{repo}/pulls/7/files')) return ok([{ filename: 'src/a.ts' }]);
    if (key.includes('/compare/')) return ok('0\n');
    return { code: 1, stdout: '', stderr: `no route ${cmd} ${key}` };
  };
}

test('run reads trunk config and waits while only pending reasons remain', async () => {
  let clock = 0;
  const state = { pr: () => pr(state.views < 3 ? { statusCheckRollup: [] } : {}) };
  const r = await run(7, { cwd: '.', exec: fakeExec(state), waitSec: 480, sleep: async (ms) => { clock += ms; }, now: () => clock });
  assert.deepEqual(r.reasons, []);
  assert.equal(r.eligible, true);
  assert.equal(state.views, 3);

  clock = 0;
  const stuck = { pr: () => pr({ mergeable: 'UNKNOWN' }) };
  const s = await run(7, { cwd: '.', exec: fakeExec(stuck), waitSec: 60, sleep: async (ms) => { clock += ms; }, now: () => clock });
  assert.equal(s.eligible, false);
  assert.equal(stuck.views, 4);

  const noWait = { pr: () => pr({ statusCheckRollup: [] }) };
  await run(7, { cwd: '.', exec: fakeExec(noWait) });
  assert.equal(noWait.views, 1);

  const red = { pr: () => pr({ mergeable: 'UNKNOWN', isDraft: true }) };
  await run(7, { cwd: '.', exec: fakeExec(red), waitSec: 480, sleep: async () => {} });
  assert.equal(red.views, 1);
});

test('run: config errors make it ineligible', async () => {
  const state = { config: 'autonomy:\n  ship_two_way: yes\n', pr: () => pr() };
  const r = await run(7, { cwd: '.', exec: fakeExec(state) });
  assert.equal(r.eligible, false);
  assert.match(r.reasons[0], /^config: autonomy.ship_two_way/);
});
