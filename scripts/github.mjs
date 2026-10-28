#!/usr/bin/env node
// GitHub state machine for jstack: labels, task state, approval, plans, PRs, verdicts, deploys.
// Run from the target repo. Prints one JSON object; exits 0 iff ok. Only trusted authors count.
import { charterReasons, driftReasons } from './charter.mjs';
import { loadConfig } from './config.mjs';
import { emit, firstLine, isMain, makeCtx, parseArgs, sleep as realSleep, toInt } from './lib.mjs';

/** Default state label prefix (`labels.prefix` in the config): labels read `state: approved`. */
export const DEFAULT_PREFIX = 'state';

/** Task states, in label order, with color and meaning. */
const STATE_TABLE = [
  ['ready', 'C5DEF5', 'Task cut, no plan yet'],
  ['planned', 'FBCA04', 'Plan posted, waiting for approval'],
  ['approved', '0E8A16', 'Plan approved by a human'],
  ['implementing', 'D93F0B', 'Being implemented'],
  ['proving', 'BFD4F2', 'PR open, under Prove'],
  ['landed', 'C2E0C6', 'Merged, not yet deployed'],
  ['deployed', '0B6623', 'Running in production'],
  ['blocked', 'B60205', 'Needs a human decision'],
];
export const STATES = STATE_TABLE.map(([s]) => s);

/** The label for a state under a prefix. */
export const stateLabel = (state, prefix = DEFAULT_PREFIX) => `${prefix}: ${state}`;
export const stateLabels = (prefix = DEFAULT_PREFIX) => STATES.map((s) => stateLabel(s, prefix));

/** Every jstack label under a prefix: [name, color, meaning]. */
export function labelTable(prefix = DEFAULT_PREFIX) {
  return [
    [stateLabel('intent', prefix), '5319E7', 'Confirmed intent'],
    [stateLabel('spec', prefix), '1D76DB', 'Spec parent issue'],
    ...STATE_TABLE.map(([s, color, meaning]) => [stateLabel(s, prefix), color, meaning]),
  ];
}

/** Machine-allowed edges; `blocked` is reachable from anything except blocked. */
export const EDGES = [
  ['ready', 'planned'], ['approved', 'implementing'], ['implementing', 'proving'],
  ['proving', 'implementing'], ['proving', 'landed'], ['landed', 'deployed'],
];

/** Why a machine may not move from -> to, or null when allowed. */
export function edgeError(from, to) {
  if (!STATES.includes(from)) return `unknown state ${from}`;
  if (!STATES.includes(to)) return `unknown state ${to}`;
  if (to === 'approved') return 'approved is human only: add the label on GitHub';
  if (from === 'blocked') return 'moving a task out of blocked is human only';
  if (to === 'blocked') return null;
  return EDGES.some(([a, b]) => a === from && b === to) ? null : `edge ${from} -> ${to} is not allowed`;
}

const prefixOf = (ctx) => ctx.prefix ?? DEFAULT_PREFIX;
const short = (s) => String(s ?? '').replace(/^[^:]*:\s*/, '');

// ---------- markers ----------

/** Parse `<!-- jstack:task spec=#N size=S -->`. */
export function parseTaskMarker(body) {
  const m = String(body).match(/<!--\s*jstack:task\s+spec=#(\d+)\s+size=(XS|S|M|L)\s*-->/);
  return m ? { spec: Number(m[1]), size: m[2] } : null;
}

/** Task number in a `<!-- jstack:pr task=#N -->` marker, or null. */
export function parsePrMarker(body) {
  const m = String(body).match(/<!-- jstack:pr task=#(\d+) -->/);
  return m ? Number(m[1]) : null;
}

/** Parse a verdict marker. door/verify are null when absent (old markers). */
export function parseVerdict(body) {
  const m = String(body).match(
    /<!--\s*jstack:verdict\s+sha=([0-9a-fA-F]{7,40})\s+result=(PASS|FAIL|ERROR)(?:\s+door=(one-way|two-way))?(?:\s+verify=(machine|human))?\s*-->/,
  );
  return m ? { sha: m[1].toLowerCase(), result: m[2], door: m[3] ?? null, verify: m[4] ?? null } : null;
}

export const PLAN_MARKER = '<!-- jstack:plan -->';
export const hasBlockedMarker = (body) => /<!--\s*jstack:blocked\s+phase=[\w-]+\s*-->/.test(String(body));
export const hasAnyMarker = (body) => /<!--\s*jstack:/.test(String(body));

/** `## Dependencies` refs: [] for None, null when the section is missing. */
export function parseDependencies(body) {
  const m = String(body).match(/^##\s*Dependencies\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  if (!m) return null;
  const text = m[1].trim();
  if (/^(?:[-*]\s*)?None\.?$/i.test(text)) return [];
  return [...new Set([...text.matchAll(/#(\d+)/g)].map((x) => Number(x[1])))];
}

// ---------- comments and trust ----------

/** Normalize a gh (GraphQL-ish) or REST comment to {author, body, createdAt, updatedAt, url}. */
export function normComment(c) {
  return {
    author: c.author?.login ?? c.user?.login ?? null,
    body: String(c.body ?? ''),
    createdAt: c.createdAt ?? c.created_at ?? null,
    updatedAt: c.updatedAt ?? c.updated_at ?? c.lastEditedAt ?? null,
    url: c.url ?? c.html_url ?? null,
  };
}

const time = (t) => { const n = Date.parse(t); return Number.isFinite(n) ? n : NaN; };
/** Latest of created/updated, for "newer than" comparisons. */
const touched = (c) => Math.max(time(c.createdAt), Number.isFinite(time(c.updatedAt)) ? time(c.updatedAt) : -Infinity);

/** Trusted comments sorted oldest -> newest, optionally filtered. */
export function trustedComments(comments, isTrusted, pred = () => true) {
  return comments.map(normComment)
    .filter((c) => c.author && isTrusted(c.author) && Number.isFinite(time(c.createdAt)) && pred(c))
    .sort((a, b) => time(a.createdAt) - time(b.createdAt));
}

/** Newest trusted comment matching pred, or null. */
export function newestTrusted(comments, isTrusted, pred) {
  return trustedComments(comments, isTrusted, pred).at(-1) ?? null;
}

// ---------- PR candidates ----------

/** True when a PR is a jstack PR for task n (or any task when n is null), by a trusted author. */
export function isTaskPr(pr, n, isTrusted) {
  const task = parsePrMarker(pr.body);
  if (task === null || (n !== null && task !== n)) return false;
  const head = String(pr.headRefName ?? '');
  if (!head.startsWith(`jstack/${task}-`) || head === `jstack/${task}-revert`) return false;
  if (pr.isCrossRepository !== false) return false;
  return isTrusted(pr.author?.login);
}

// ---------- commands ----------

/** Read a task issue and compute its state (without approval check). */
function readTask(ctx, n) {
  const issue = ctx.ghJson(['issue', 'view', String(n), '--json', 'number,title,body,labels,author,state,comments']);
  const labels = (issue.labels ?? []).map((l) => l.name);
  const marker = parseTaskMarker(issue.body);
  const deps = parseDependencies(issue.body);
  const task = {
    number: issue.number, title: issue.title, spec: marker?.spec ?? null, size: marker?.size ?? null,
    dependencies: deps ?? [], open: issue.state === 'OPEN',
  };
  let reason = null;
  if (!ctx.isTrusted(issue.author?.login)) reason = `task author ${issue.author?.login} is not a trusted collaborator`;
  else if (!marker) reason = 'task body has no <!-- jstack:task spec=#N size=XS|S|M|L --> marker';
  else if (deps === null) reason = 'task body has no ## Dependencies section';
  const states = labels.filter((l) => stateLabels(prefixOf(ctx)).includes(l)).map(short);
  let candidate = null;
  if (states.length === 1) candidate = states[0];
  else if (states.length === 2 && states.includes('planned') && states.includes('approved')) candidate = 'approved';
  else if (!reason) reason = `expected exactly one state label, found: ${states.length ? states.map((s) => stateLabel(s, prefixOf(ctx))).join(', ') : 'none'}`;
  return { issue, labels, task, candidate, reason };
}

/** `approval --task N`: approval label by a trusted actor after the newest trusted plan. */
export function approval(ctx, n) {
  const fail = (reason, extra = {}) => ({ ok: false, valid: false, by: null, at: null, planUrl: null, reason, ...extra });
  try {
    const comments = ctx.ghPaginated(`repos/{owner}/{repo}/issues/${n}/comments`);
    const plan = newestTrusted(comments, ctx.isTrusted, (c) => c.body.includes(PLAN_MARKER));
    const events = ctx.ghPaginated(`repos/{owner}/{repo}/issues/${n}/events`);
    const approvals = events
      .filter((e) => e.event === 'labeled' && e.label?.name === stateLabel('approved', prefixOf(ctx)) && ctx.isTrusted(e.actor?.login))
      .sort((a, b) => time(a.created_at) - time(b.created_at));
    const ev = approvals.at(-1);
    if (!plan) return fail('no trusted plan comment');
    const base = { planUrl: plan.url };
    if (!ev) return fail(`${stateLabel('approved', prefixOf(ctx))} was not added by a trusted collaborator`, base);
    const at = time(ev.created_at);
    if (!(at > touched(plan))) return fail('the newest plan was posted or edited after the approval: re-approve it', { ...base, by: ev.actor.login, at: ev.created_at });
    return { ok: true, valid: true, by: ev.actor.login, at: ev.created_at, planUrl: plan.url, reason: null };
  } catch (err) {
    return fail(`could not read approval: ${firstLine(err)}`);
  }
}

/** `state --task N`. */
export function state(ctx, n) {
  try {
    const t = readTask(ctx, n);
    const out = { ok: false, state: t.candidate, labels: t.labels, task: t.task };
    if (t.reason) return { ...out, reason: t.reason };
    if (t.candidate === 'approved') {
      const a = approval(ctx, n);
      if (a.valid) return { ...out, ok: true, approval: a };
      const c = charter(ctx, t);
      if (c.reasons.length === 0) return { ...out, ok: true, approval: c.approval };
      return { ...out, state: 'planned', approval: a, reason: `approval not valid: ${a.reason}` };
    }
    if (t.candidate === 'planned' && ctx.config?.autonomy?.plan === 'dark') {
      const c = charter(ctx, t);
      if (c.reasons.length === 0) return { ...out, ok: true, state: 'approved', approval: c.approval };
      return { ...out, ok: true, charter: { reasons: c.reasons } };
    }
    return { ...out, ok: true };
  } catch (err) {
    return { ok: false, state: null, labels: [], task: null, reason: `could not read task: ${firstLine(err)}` };
  }
}

/** `move --task N --from X --to Y`. */
export function move(ctx, n, from, to, phase = null) {
  const f = short(from), t = short(to);
  const out = { ok: false, from: f, to: t, phase, labels: [] };
  const edge = edgeError(f, t);
  if (edge) return { ...out, reason: edge };
  const s = state(ctx, n);
  out.labels = s.labels;
  const current = s.ok ? s.state : s.approval && s.state === 'planned' ? 'planned' : null;
  if (current !== f) return { ...out, reason: `task is not ${f}: ${s.ok ? `it is ${s.state}` : s.reason}` };
  try {
    const args = ['issue', 'edit', String(n)];
    for (const l of s.labels.filter((x) => stateLabels(prefixOf(ctx)).includes(x))) args.push('--remove-label', l);
    args.push('--add-label', stateLabel(t, prefixOf(ctx)));
    ctx.gh(args);
    const after = readTask(ctx, n);
    const states = after.labels.filter((x) => stateLabels(prefixOf(ctx)).includes(x));
    if (states.length !== 1 || states[0] !== stateLabel(t, prefixOf(ctx))) return { ...out, labels: after.labels, reason: `labels after edit are ${states.join(', ') || 'none'}` };
    return { ok: true, from: f, to: t, phase, labels: after.labels };
  } catch (err) {
    return { ...out, reason: `could not move: ${firstLine(err)}` };
  }
}

/** Newest trusted plan and the trusted unmarked feedback after it. Pure. */
export function planAndFeedback(comments, isTrusted) {
  const p = newestTrusted(comments, isTrusted, (c) => c.body.includes(PLAN_MARKER));
  const since = p ? time(p.createdAt) : -Infinity;
  const feedback = trustedComments(comments, isTrusted, (c) => !hasAnyMarker(c.body) && time(c.createdAt) > since)
    .map(({ author, createdAt, body, url }) => ({ author, createdAt, body, url }));
  return { plan: p ? { url: p.url, createdAt: p.createdAt, author: p.author, body: p.body } : null, feedback };
}

/** Charter check for a task read by readTask: {reasons, approval}. Empty reasons: the charter approves the plan. */
function charter(ctx, t) {
  const { plan: p, feedback } = planAndFeedback(t.issue.comments ?? [], ctx.isTrusted);
  const reasons = charterReasons({ config: ctx.config, task: { size: t.task.size, body: t.issue.body }, plan: p, feedback });
  return { reasons, approval: { valid: true, by: 'charter', at: p?.createdAt ?? null, planUrl: p?.url ?? null, reason: null } };
}

/** `plan --task N`: newest trusted plan and the trusted unmarked feedback after it. */
export function plan(ctx, n) {
  try {
    const issue = ctx.ghJson(['issue', 'view', String(n), '--json', 'comments']);
    return { ok: true, ...planAndFeedback(issue.comments ?? [], ctx.isTrusted) };
  } catch (err) {
    return { ok: false, plan: null, feedback: [], reason: `could not read comments: ${firstLine(err)}` };
  }
}

const PR_FIELDS = 'number,url,title,body,headRefName,headRefOid,baseRefName,state,isDraft,isCrossRepository,author,mergeCommit';
const slimPr = (p) => ({
  number: p.number, url: p.url, title: p.title, headRefName: p.headRefName, headRefOid: p.headRefOid,
  baseRefName: p.baseRefName, state: p.state, isDraft: p.isDraft, author: p.author?.login ?? null,
  mergeCommit: p.mergeCommit?.oid ?? null, task: parsePrMarker(p.body),
});

/** List PRs in a state. */
function listPrs(ctx, st) {
  return ctx.ghJson(['pr', 'list', '--state', st, '--limit', st === 'open' ? '100' : '500', '--json', PR_FIELDS]);
}

/** `pr --task N [--state open|merged|all]`. */
export function pr(ctx, n, st = 'open') {
  if (!['open', 'merged', 'all'].includes(st)) return { ok: false, pr: null, reason: `bad --state ${st}` };
  try {
    const c = listPrs(ctx, st).filter((p) => isTaskPr(p, n, ctx.isTrusted)).sort((a, b) => b.number - a.number);
    if (st === 'open' && c.length > 1) return { ok: false, pr: null, reason: `more than one open PR for task #${n}: ${c.map((p) => `#${p.number}`).join(', ')}` };
    return { ok: true, pr: c.length ? slimPr(c[0]) : null };
  } catch (err) {
    return { ok: false, pr: null, reason: `could not list PRs: ${firstLine(err)}` };
  }
}

/** `openprs`: every open jstack PR by a trusted author. */
export function openprs(ctx) {
  try {
    const prs = listPrs(ctx, 'open').filter((p) => isTaskPr(p, null, ctx.isTrusted)).map((p) => ({ number: p.number, task: parsePrMarker(p.body) }));
    return { ok: true, prs };
  } catch (err) {
    return { ok: false, prs: [], reason: `could not list PRs: ${firstLine(err)}` };
  }
}

/** Newest trusted verdict and the FAIL count since the newest trusted block. Pure. */
export function summarizeVerdicts(prComments, taskComments, isTrusted) {
  const verdicts = trustedComments(prComments, isTrusted, (c) => parseVerdict(c.body) !== null);
  const v = verdicts.at(-1);
  const block = taskComments ? newestTrusted(taskComments, isTrusted, (c) => hasBlockedMarker(c.body)) : null;
  const since = block ? time(block.createdAt) : -Infinity;
  const failCount = verdicts.filter((c) => parseVerdict(c.body).result === 'FAIL' && time(c.createdAt) > since).length;
  return { verdict: v ? { ...parseVerdict(v.body), author: v.author, createdAt: v.createdAt, url: v.url } : null, failCount };
}

/** `verdict --pr P [--task N]`. */
export function verdict(ctx, p, n = null) {
  try {
    const prc = ctx.ghJson(['pr', 'view', String(p), '--json', 'comments']).comments ?? [];
    const tc = n === null ? null : ctx.ghJson(['issue', 'view', String(n), '--json', 'comments']).comments ?? [];
    return { ok: true, ...summarizeVerdicts(prc, tc, ctx.isTrusted) };
  } catch (err) {
    return { ok: false, verdict: null, failCount: null, reason: `could not read verdicts: ${firstLine(err)}` };
  }
}

/** `drift --task N --pr P --sha S`: files the PR changed outside its plan. ok means it was read; clean means no drift. */
export function drift(ctx, n, p, sha) {
  const fail = (reason) => ({ ok: false, clean: false, reasons: [], reason });
  try {
    const head = ctx.ghJson(['pr', 'view', String(p), '--json', 'headRefOid']).headRefOid;
    if (String(head).toLowerCase() !== String(sha).toLowerCase()) return fail('head moved');
    const { plan: pl } = plan(ctx, n);
    if (!pl) return fail('no trusted plan');
    const files = ctx.ghPaginated(`repos/{owner}/{repo}/pulls/${p}/files`);
    const reasons = driftReasons(pl.body, files);
    return { ok: true, clean: reasons.length === 0, reasons, planUrl: pl.url };
  } catch (err) {
    return fail(`could not read the PR: ${firstLine(err)}`);
  }
}

/** `deploy --workflow W --sha S`: wait for the deploy run of a commit. */
export async function deploy(ctx, { workflow, sha, timeoutSec = 540, appearSec = 300, sleep = realSleep, now = Date.now, pollMs = 15_000 }) {
  const t0 = now();
  const res = (status, extra = {}) => ({ ok: status === 'success', status, runId: null, url: null, conclusion: null, ...extra });
  try {
    let run = null;
    for (;;) {
      const runs = ctx.ghJson(['run', 'list', '--workflow', workflow, '--commit', sha, '--json', 'databaseId,status,conclusion,url']);
      run = runs.sort((a, b) => b.databaseId - a.databaseId)[0] ?? null;
      if (run) break;
      if (now() - t0 + pollMs > appearSec * 1000) return res('none', { reason: `no ${workflow} run for ${sha} appeared within ${appearSec}s` });
      await sleep(pollMs);
    }
    for (;;) {
      if (run.status === 'completed') {
        const ok = run.conclusion === 'success';
        return res(ok ? 'success' : 'failure', { runId: run.databaseId, url: run.url, conclusion: run.conclusion });
      }
      if (now() - t0 + pollMs > timeoutSec * 1000) return res('pending', { runId: run.databaseId, url: run.url, reason: 'still running: call again' });
      await sleep(pollMs);
      run = { databaseId: run.databaseId, ...ctx.ghJson(['run', 'view', String(run.databaseId), '--json', 'status,conclusion,url']) };
    }
  } catch (err) {
    return res('error', { reason: `could not read deploy runs: ${firstLine(err)}` });
  }
}

/** `labels`: create or update every jstack label. */
export function labels(ctx) {
  const failed = [];
  const table = labelTable(prefixOf(ctx));
  for (const [name, color, desc] of table) {
    try { ctx.gh(['label', 'create', name, '--force', '--color', color, '--description', desc]); } catch (err) { failed.push(`${name}: ${firstLine(err)}`); }
  }
  return { ok: failed.length === 0, labels: table.map(([name, color, description]) => ({ name, color, description })), ...(failed.length ? { reason: failed.join('; ') } : {}) };
}

/** `trusted --user L`. */
export function trusted(ctx, login) {
  const permission = ctx.permission(login);
  return { ok: ['admin', 'maintain', 'write'].includes(permission), permission };
}

const USAGE = 'usage: github.mjs labels | state --task N | approval --task N | plan --task N | drift --task N --pr P --sha S | move --task N --from X --to Y [--phase P] | pr --task N [--state open|merged|all] | openprs | verdict --pr P [--task N] | deploy --workflow W --sha S [--timeout SEC] [--appear SEC] | trusted --user L';

/** Dispatch a CLI command. Returns a result object with `ok`. */
export async function main(argv, ctx = makeCtx()) {
  const a = parseArgs(argv);
  const cmd = a._[0];
  const task = toInt(a.task);
  const need = (v, name) => { if (v === null || v === undefined || v === true) throw new Error(`missing or bad --${name}`); return v; };
  try {
    if (['labels', 'state', 'approval', 'move'].includes(cmd) && ctx.prefix === undefined) {
      const cfg = loadConfig({ cwd: ctx.cwd, exec: ctx.exec });
      if (!cfg.ok) return { ok: false, reason: `config: ${cfg.errors.join('; ')}` };
      ctx.prefix = cfg.config.labels.prefix;
      ctx.config = cfg.config;
    }
    switch (cmd) {
      case 'labels': return labels(ctx);
      case 'state': return state(ctx, need(task, 'task'));
      case 'approval': return approval(ctx, need(task, 'task'));
      case 'plan': return plan(ctx, need(task, 'task'));
      case 'drift': {
        const sha = need(a.sha, 'sha');
        if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('bad --sha: full 40-hex sha');
        return drift(ctx, need(task, 'task'), need(toInt(a.pr), 'pr'), sha);
      }
      case 'move': return move(ctx, need(task, 'task'), need(a.from, 'from'), need(a.to, 'to'), typeof a.phase === 'string' ? a.phase : null);
      case 'pr': return pr(ctx, need(task, 'task'), typeof a.state === 'string' ? a.state : 'open');
      case 'openprs': return openprs(ctx);
      case 'verdict': return verdict(ctx, need(toInt(a.pr), 'pr'), task);
      case 'deploy': {
        const sha = need(a.sha, 'sha');
        if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error('bad --sha');
        return await deploy(ctx, {
          workflow: need(typeof a.workflow === 'string' ? a.workflow : null, 'workflow'), sha,
          timeoutSec: a.timeout === undefined ? 540 : need(toInt(a.timeout), 'timeout'),
          appearSec: a.appear === undefined ? 300 : need(toInt(a.appear), 'appear'),
        });
      }
      case 'trusted': return trusted(ctx, need(typeof a.user === 'string' ? a.user : null, 'user'));
      default: return { ok: false, reason: USAGE };
    }
  } catch (err) {
    return { ok: false, reason: `${firstLine(err)}. ${USAGE}` };
  }
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((r) => emit(r, r.ok), (err) => emit({ ok: false, reason: firstLine(err) }, false));
}
