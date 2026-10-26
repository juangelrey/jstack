import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './lib.mjs';
import {
  labelTable, stateLabels, edgeError, parseTaskMarker, parsePrMarker, parseVerdict, parseDependencies,
  newestTrusted, isTaskPr, summarizeVerdicts, main, deploy,
} from './github.mjs';

const SHA = 'a'.repeat(40);
const TRUSTED = new Set(['alice', 'bob']);
const isTrusted = (l) => TRUSTED.has(l);
const TASK_BODY = '<!-- jstack:task spec=#2 size=S -->\n## Description\nx\n\n## Dependencies\n- #4\n- #5\n';

/** Trunk with no config, so labels use the default prefix. */
const TRUNK = { 'repo view --json defaultBranchRef': 'main\n', 'fetch origin main': '', 'ls-tree': '' };

/** Fake gh: `routes` maps a joined-args prefix to a value or function(args). */
function fake(routes, calls = []) {
  const exec = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    const key = args.join(' ');
    const perm = key.match(/^api repos\/\{owner\}\/\{repo\}\/collaborators\/([^/]+)\/permission/);
    if (perm) return TRUSTED.has(perm[1]) ? { code: 0, stdout: 'write\n', stderr: '' } : { code: 1, stdout: '', stderr: 'HTTP 404' };
    for (const [prefix, v] of Object.entries({ ...routes, ...TRUNK, ...routes })) {
      if (key.startsWith(prefix)) {
        const out = typeof v === 'function' ? v(args) : v;
        if (out instanceof Error) return { code: 1, stdout: '', stderr: out.message };
        return { code: 0, stdout: typeof out === 'string' ? out : JSON.stringify(out), stderr: '' };
      }
    }
    return { code: 1, stdout: '', stderr: `no route for ${key}` };
  };
  return makeCtx({ exec, cwd: '.' });
}

const issue = (labels, extra = {}) => ({
  number: 9, title: 'Task', body: TASK_BODY, labels: labels.map((name) => ({ name })),
  author: { login: 'alice' }, state: 'OPEN', comments: [], ...extra,
});
const at = (m) => `2026-10-26T10:${String(m).padStart(2, '0')}:00Z`;
const planComment = (m, login = 'alice') => ({ user: { login }, body: '<!-- jstack:plan -->\n## Plan', created_at: at(m), updated_at: at(m), html_url: `u${m}` });
const approvedEvent = (m, login = 'bob') => ({ event: 'labeled', label: { name: 'state: approved' }, actor: { login }, created_at: at(m) });

test('labels table has ten labels and eight state labels', () => {
  assert.equal(labelTable().length, 10);
  assert.deepEqual(stateLabels(), ['state: ready', 'state: planned', 'state: approved', 'state: implementing', 'state: proving', 'state: landed', 'state: deployed', 'state: blocked']);
  assert.equal(labelTable('flow')[0][0], 'flow: intent');
  assert.equal(labelTable('flow')[4][0], 'flow: approved');
});

test('state labels follow labels.prefix from the trunk config', async () => {
  const routes = { 'issue view 9': issue(['flow: ready']), 'ls-tree': '.jstack/config.yml\n', 'show origin/main:.jstack/config.yml': 'version: 1\nlabels:\n  prefix: flow\n' };
  let r = await main(['state', '--task', '9'], fake(routes));
  assert.equal(r.ok, true);
  assert.equal(r.state, 'ready');
  r = await main(['state', '--task', '9'], fake({ ...routes, 'show origin/main:.jstack/config.yml': 'labels:\n  prefix: "a,b"\n' }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /labels.prefix/);
});

test('edge rules', () => {
  assert.equal(edgeError('ready', 'planned'), null);
  assert.equal(edgeError('proving', 'implementing'), null);
  assert.equal(edgeError('landed', 'blocked'), null);
  assert.match(edgeError('planned', 'approved'), /human only/);
  assert.match(edgeError('blocked', 'ready'), /human only/);
  assert.match(edgeError('ready', 'implementing'), /not allowed/);
  assert.match(edgeError('planned', 'planned'), /not allowed/);
  assert.match(edgeError('nope', 'ready'), /unknown/);
});

test('marker parsers', () => {
  assert.deepEqual(parseTaskMarker(TASK_BODY), { spec: 2, size: 'S' });
  assert.equal(parseTaskMarker('<!-- jstack:task spec=#2 size=XL -->'), null);
  assert.equal(parsePrMarker('<!-- jstack:pr task=#12 -->\nTask: #12'), 12);
  assert.equal(parsePrMarker('<!--jstack:pr task=#12-->'), null);
  assert.deepEqual(parseVerdict(`<!-- jstack:verdict sha=${SHA} result=PASS door=two-way verify=machine -->`), { sha: SHA, result: 'PASS', door: 'two-way', verify: 'machine' });
  assert.deepEqual(parseVerdict(`<!-- jstack:verdict sha=${SHA} result=FAIL -->`), { sha: SHA, result: 'FAIL', door: null, verify: null });
  assert.deepEqual(parseDependencies(TASK_BODY), [4, 5]);
  assert.deepEqual(parseDependencies('## Dependencies\nNone\n## Next\n#7'), []);
  assert.deepEqual(parseDependencies('## Dependencies\n- None\n'), []);
  assert.equal(parseDependencies('## Description\n#3'), null);
});

test('newestTrusted ignores untrusted comments', () => {
  const cs = [
    { author: { login: 'alice' }, body: 'A <!-- jstack:plan -->', createdAt: at(1) },
    { author: { login: 'mallory' }, body: 'M <!-- jstack:plan -->', createdAt: at(5) },
  ];
  assert.match(newestTrusted(cs, isTrusted, (c) => c.body.includes('jstack:plan')).body, /^A/);
});

test('isTaskPr filters', () => {
  const p = { body: '<!-- jstack:pr task=#3 -->', headRefName: 'jstack/3-x', isCrossRepository: false, author: { login: 'alice' } };
  assert.ok(isTaskPr(p, 3, isTrusted));
  assert.ok(isTaskPr(p, null, isTrusted));
  assert.ok(!isTaskPr(p, 4, isTrusted));
  assert.ok(!isTaskPr({ ...p, headRefName: 'jstack/3-revert' }, 3, isTrusted));
  assert.ok(!isTaskPr({ ...p, headRefName: 'feature/3-x' }, 3, isTrusted));
  assert.ok(!isTaskPr({ ...p, isCrossRepository: true }, 3, isTrusted));
  assert.ok(!isTaskPr({ ...p, author: { login: 'mallory' } }, 3, isTrusted));
});

test('summarizeVerdicts: newest trusted, FAILs since newest trusted block', () => {
  const v = (m, result, login = 'alice') => ({ author: { login }, body: `<!-- jstack:verdict sha=${SHA} result=${result} door=two-way verify=machine -->`, createdAt: at(m) });
  const prc = [v(1, 'FAIL'), v(3, 'FAIL'), v(5, 'FAIL'), v(6, 'PASS', 'mallory'), v(7, 'FAIL', 'mallory')];
  const tc = [{ author: { login: 'alice' }, body: '<!-- jstack:blocked phase=prove -->', createdAt: at(2) },
    { author: { login: 'mallory' }, body: '<!-- jstack:blocked phase=prove -->', createdAt: at(4) }];
  const r = summarizeVerdicts(prc, tc, isTrusted);
  assert.equal(r.verdict.result, 'FAIL');
  assert.equal(r.verdict.createdAt, at(5));
  assert.equal(r.failCount, 2);
  assert.equal(summarizeVerdicts(prc, null, isTrusted).failCount, 3);
});

test('state: single label, untrusted author, missing marker, multiple labels', async () => {
  let r = await main(['state', '--task', '9'], fake({ 'issue view 9': issue(['state: ready', 'bug']) }));
  assert.equal(r.ok, true);
  assert.equal(r.state, 'ready');
  assert.deepEqual(r.task, { number: 9, title: 'Task', spec: 2, size: 'S', dependencies: [4, 5], open: true });
  r = await main(['state', '--task', '9'], fake({ 'issue view 9': issue(['state: ready'], { author: { login: 'mallory' } }) }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /not a trusted/);
  r = await main(['state', '--task', '9'], fake({ 'issue view 9': issue(['state: ready'], { body: 'hi' }) }));
  assert.match(r.reason, /marker/);
  r = await main(['state', '--task', '9'], fake({ 'issue view 9': issue(['state: ready', 'state: proving']) }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /state: ready, state: proving/);
  r = await main(['state', '--task', '9'], fake({ 'issue view 9': issue([]) }));
  assert.match(r.reason, /none/);
});

test('approval: valid only after newest trusted plan, by a trusted actor', async () => {
  const routes = (comments, events) => ({
    'api repos/{owner}/{repo}/issues/9/comments': comments,
    'api repos/{owner}/{repo}/issues/9/events': events,
  });
  let r = await main(['approval', '--task', '9'], fake(routes([planComment(1)], [approvedEvent(2)])));
  assert.equal(r.ok, true);
  assert.equal(r.by, 'bob');
  assert.equal(r.planUrl, 'u1');
  r = await main(['approval', '--task', '9'], fake(routes([planComment(1), planComment(3)], [approvedEvent(2)])));
  assert.equal(r.ok, false);
  assert.match(r.reason, /after the approval/);
  // untrusted newer plan does not invalidate; untrusted approver does not count
  r = await main(['approval', '--task', '9'], fake(routes([planComment(1), planComment(3, 'mallory')], [approvedEvent(2)])));
  assert.equal(r.ok, true);
  r = await main(['approval', '--task', '9'], fake(routes([planComment(1)], [approvedEvent(2, 'mallory')])));
  assert.equal(r.ok, false);
  // plan edited after approval
  const edited = { ...planComment(1), updated_at: at(4) };
  r = await main(['approval', '--task', '9'], fake(routes([edited], [approvedEvent(2)])));
  assert.equal(r.ok, false);
  r = await main(['approval', '--task', '9'], fake(routes([], [approvedEvent(2)])));
  assert.match(r.reason, /no trusted plan/);
  // paginated output: concatenated arrays
  const paged = JSON.stringify([planComment(1)]) + JSON.stringify([]);
  r = await main(['approval', '--task', '9'], fake(routes(paged, [approvedEvent(2)])));
  assert.equal(r.ok, true);
});

test('state: planned+approved needs a valid approval', async () => {
  const base = { 'issue view 9': issue(['state: planned', 'state: approved']), 'api repos/{owner}/{repo}/issues/9/comments': [planComment(1)] };
  let r = await main(['state', '--task', '9'], fake({ ...base, 'api repos/{owner}/{repo}/issues/9/events': [approvedEvent(2)] }));
  assert.equal(r.ok, true);
  assert.equal(r.state, 'approved');
  r = await main(['state', '--task', '9'], fake({ ...base, 'api repos/{owner}/{repo}/issues/9/events': [approvedEvent(2, 'mallory')] }));
  assert.equal(r.ok, false);
  assert.equal(r.state, 'planned');
});

test('move: refuses human-only edges, verifies state, one edit, re-reads', async () => {
  let r = await main(['move', '--task', '9', '--from', 'planned', '--to', 'approved'], fake({}));
  assert.match(r.reason, /human only/);
  r = await main(['move', '--task', '9', '--from', 'blocked', '--to', 'ready'], fake({}));
  assert.match(r.reason, /human only/);

  const calls = [];
  let labels = ['state: planned', 'state: approved'];
  const ctx = fake({
    'issue view 9': () => issue(labels),
    'issue edit 9': () => { labels = ['state: implementing']; return ''; },
    'api repos/{owner}/{repo}/issues/9/comments': [planComment(1)],
    'api repos/{owner}/{repo}/issues/9/events': [approvedEvent(2)],
  }, calls);
  r = await main(['move', '--task', '9', '--from', 'approved', '--to', 'implementing'], ctx);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.labels, ['state: implementing']);
  const edits = calls.filter((c) => c.startsWith('gh issue edit'));
  assert.deepEqual(edits, ['gh issue edit 9 --remove-label state: planned --remove-label state: approved --add-label state: implementing']);

  r = await main(['move', '--task', '9', '--from', 'ready', '--to', 'planned'], fake({ 'issue view 9': issue(['state: proving']) }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /not ready/);

  // edit did not stick
  r = await main(['move', '--task', '9', '--from', 'ready', '--to', 'planned'], fake({ 'issue view 9': issue(['state: ready']), 'issue edit 9': '' }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /after edit/);
});

test('pr / openprs filter candidates', async () => {
  const mk = (number, task, extra = {}) => ({
    number, url: `p${number}`, title: 't', body: `<!-- jstack:pr task=#${task} -->`, headRefName: `jstack/${task}-x`,
    headRefOid: SHA, baseRefName: 'main', state: 'OPEN', isDraft: false, isCrossRepository: false, author: { login: 'alice' }, mergeCommit: null, ...extra,
  });
  const list = [mk(1, 3), mk(2, 3, { author: { login: 'mallory' } }), mk(4, 5), mk(6, 3, { headRefName: 'jstack/3-revert' })];
  let r = await main(['pr', '--task', '3'], fake({ 'pr list --state open': list }));
  assert.equal(r.ok, true);
  assert.equal(r.pr.number, 1);
  r = await main(['pr', '--task', '7'], fake({ 'pr list --state open': list }));
  assert.deepEqual([r.ok, r.pr], [true, null]);
  r = await main(['pr', '--task', '3'], fake({ 'pr list --state open': [...list, mk(8, 3)] }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /#8, #1/);
  r = await main(['pr', '--task', '3', '--state', 'merged'], fake({ 'pr list --state merged': [mk(1, 3, { mergeCommit: { oid: SHA } }), mk(8, 3, { mergeCommit: { oid: 'b'.repeat(40) } })] }));
  assert.equal(r.pr.number, 8);
  assert.equal(r.pr.mergeCommit, 'b'.repeat(40));
  r = await main(['openprs'], fake({ 'pr list --state open': list }));
  assert.deepEqual(r.prs, [{ number: 1, task: 3 }, { number: 4, task: 5 }]);
});

test('plan returns newest trusted plan and feedback after it', async () => {
  const c = (m, login, body) => ({ author: { login }, body, createdAt: at(m), url: `c${m}` });
  const comments = [c(1, 'alice', 'early feedback'), c(2, 'alice', '<!-- jstack:plan -->\nP'), c(3, 'mallory', 'x'), c(4, 'bob', 'change step 2'), c(5, 'alice', '<!-- jstack:blocked phase=x -->')];
  const r = await main(['plan', '--task', '9'], fake({ 'issue view 9 --json comments': { comments } }));
  assert.equal(r.ok, true);
  assert.equal(r.plan.url, 'c2');
  assert.deepEqual(r.feedback.map((f) => f.body), ['change step 2']);
  const none = await main(['plan', '--task', '9'], fake({ 'issue view 9 --json comments': { comments: [comments[0]] } }));
  assert.equal(none.plan, null);
  assert.equal(none.feedback.length, 1);
});

test('verdict command', async () => {
  const comments = [{ author: { login: 'alice' }, body: `<!-- jstack:verdict sha=${SHA} result=PASS door=two-way verify=human -->`, createdAt: at(1) }];
  const r = await main(['verdict', '--pr', '5'], fake({ 'pr view 5 --json comments': { comments } }));
  assert.equal(r.ok, true);
  assert.equal(r.verdict.verify, 'human');
  assert.equal(r.failCount, 0);
});

test('deploy polls until success, failure, none or pending', async () => {
  let clock = 0;
  const opts = { workflow: 'Deploy', sha: SHA, sleep: async (ms) => { clock += ms; }, now: () => clock };
  let n = 0;
  let r = await deploy(fake({
    'run list': () => (n++ < 2 ? [] : [{ databaseId: 7, status: 'in_progress', conclusion: '', url: 'r7' }]),
    'run view 7': { status: 'completed', conclusion: 'success', url: 'r7' },
  }), opts);
  assert.deepEqual([r.ok, r.status, r.runId], [true, 'success', 7]);
  clock = 0;
  r = await deploy(fake({ 'run list': [{ databaseId: 7, status: 'completed', conclusion: 'failure', url: 'r7' }] }), opts);
  assert.deepEqual([r.ok, r.status], [false, 'failure']);
  clock = 0;
  r = await deploy(fake({ 'run list': [] }), opts);
  assert.equal(r.status, 'none');
  assert.ok(clock <= 300_000);
  clock = 0;
  r = await deploy(fake({ 'run list': [{ databaseId: 7, status: 'queued', url: 'r7' }], 'run view 7': { status: 'in_progress', conclusion: '' } }), opts);
  assert.deepEqual([r.ok, r.status], [false, 'pending']);
  assert.ok(clock <= 540_000);
  r = await deploy(fake({}), opts);
  assert.deepEqual([r.ok, r.status], [false, 'error']);
});

test('labels and trusted commands', async () => {
  const calls = [];
  const r = await main(['labels'], fake({ 'label create': '' }, calls));
  assert.equal(r.ok, true);
  const created = calls.filter((c) => c.startsWith('gh label create'));
  assert.equal(created.length, 10);
  assert.ok(created[0].includes('--force --color 5319E7'));
  assert.ok(created[4].startsWith('gh label create state: approved '));
  assert.deepEqual(await main(['trusted', '--user', 'alice'], fake({})), { ok: true, permission: 'write' });
  assert.deepEqual(await main(['trusted', '--user', 'mallory'], fake({})), { ok: false, permission: null });
  assert.equal((await main(['bogus'], fake({}))).ok, false);
  assert.equal((await main(['state'], fake({}))).ok, false);
});

test('trust is cached per login', async () => {
  const calls = [];
  const ctx = fake({}, calls);
  ctx.isTrusted('alice'); ctx.isTrusted('alice'); ctx.isTrusted('bad login!');
  assert.equal(calls.length, 1);
});
