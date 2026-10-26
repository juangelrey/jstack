#!/usr/bin/env node
// Decides whether a proven PR may merge without a human (ADR-0008) and prints one JSON object.
// Fails closed: anything it cannot evaluate makes the PR ineligible. Only trusted authors count.
import { resolve } from 'node:path';
import { defaultExec, emit, firstLine, isMain, makeCtx, parseArgs, sleep as realSleep, toInt } from './lib.mjs';
import { globToRegExp, loadConfig } from './config.mjs';
import { parsePrMarker, parseVerdict, trustedComments } from './github.mjs';

export { globToRegExp } from './config.mjs';

/** Paths that always need a human, on top of protected_paths and human_paths. Matched case-insensitively. */
export const DEFAULT_HUMAN_PATHS = [
  // dependency manifests and lockfiles
  '**/package.json', '**/package-lock.json', '**/npm-shrinkwrap.json', '**/yarn.lock', '**/pnpm-lock.yaml',
  '**/bun.lock*', '**/requirements*.txt', '**/pyproject.toml', '**/poetry.lock', '**/Pipfile*',
  '**/go.mod', '**/go.sum', '**/Cargo.toml', '**/Cargo.lock', '**/Gemfile*', '**/*.gemspec',
  '**/pom.xml', '**/build.gradle*', '**/composer.*',
  // migrations
  '**/*migrat*', '**/*migrat*/**',
  // auth, security, secrets, payments
  '**/*auth*', '**/*auth*/**', '**/*security*', '**/*security*/**', '**/*secret*', '**/*secret*/**',
  '**/*payment*', '**/*payment*/**', '**/*billing*', '**/*billing*/**', '**/.env*',
  // infra, CI and the factory's own config
  '.github/**', '.jstack/**', '**/Dockerfile*', '**/docker-compose*', '**/*.tf', '**/infra/**',
  '**/terraform/**', '**/k8s/**', '**/helm/**',
];

export const DEFAULT_MAX_LINES = 200;

const asList = (v) => (Array.isArray(v) ? v : []);

/** Newest trusted jstack verdict on the PR, or null. Untrusted verdicts are ignored. */
export function newestVerdict(comments, isTrusted) {
  const c = trustedComments(asList(comments), isTrusted, (x) => parseVerdict(x.body) !== null).at(-1);
  return c ? parseVerdict(c.body) : null;
}

/** The author's door from the PR body's `## Merge danger` section: 'two-way', 'one-way' or null. */
export function authorDoor(body) {
  const m = String(body).match(/##\s*Merge danger\s*\r?\n+\s*(?:[-*]\s*)?\**\s*(two-way|one-way)/i);
  return m ? m[1].toLowerCase() : null;
}

/** Classify the status rollup: {state: 'green'|'pending'|'red'|'empty', bad: [names]}. */
export function checksState(rollup) {
  const items = asList(rollup);
  if (items.length === 0) return { state: 'empty', bad: [] };
  const ok = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
  const red = [], pending = [];
  for (const c of items) {
    const name = c.name || c.context || '?';
    const isStatus = c.__typename === 'StatusContext' || (c.state !== undefined && c.conclusion === undefined);
    if (isStatus) {
      const s = String(c.state || '').toUpperCase();
      if (s === 'PENDING' || s === 'EXPECTED') pending.push(name); else if (!ok.has(s)) red.push(name);
    } else if (String(c.status || '').toUpperCase() !== 'COMPLETED' && !c.conclusion) pending.push(name);
    else if (!ok.has(String(c.conclusion || '').toUpperCase())) red.push(name);
  }
  if (red.length) return { state: 'red', bad: red };
  if (pending.length) return { state: 'pending', bad: pending };
  return { state: 'green', bad: [] };
}

/**
 * Pure decision. `config` is the effective config (config.mjs), `pr` is the `gh pr view --json` object,
 * `facts` = {behindBy, defaultBranch, files: [{filename, previous_filename}], isTrusted(login)}.
 * Returns {eligible, behind, lines, task, reasons, pending} where pending = only retryable reasons remain.
 */
export function evaluate(config, pr, facts = {}) {
  const reasons = [];
  let retryable = 0;
  const add = (msg, retry = false) => { reasons.push(msg); if (retry) retryable++; };
  const isTrusted = typeof facts.isTrusted === 'function' ? facts.isTrusted : () => false;
  const autonomy = config?.autonomy ?? {};

  if (autonomy.ship_two_way !== 'dark') add('auto-merge not granted (autonomy.ship_two_way is not dark)');
  if (pr.state !== 'OPEN') add(`PR is not open (${pr.state})`);
  if (pr.isDraft !== false) add('PR is a draft');
  if (!facts.defaultBranch || pr.baseRefName !== facts.defaultBranch) add(`base ${pr.baseRefName} is not the default branch ${facts.defaultBranch}`);
  if (pr.isCrossRepository !== false) add('PR comes from a fork');
  if (!isTrusted(pr.author?.login)) add(`PR author ${pr.author?.login} is not a trusted collaborator`);

  const task = parsePrMarker(pr.body);
  const headRef = String(pr.headRefName ?? '');
  if (task === null) add('PR body has no <!-- jstack:pr task=#N --> marker');
  else if (!headRef.startsWith(`jstack/${task}-`)) add(`head branch ${headRef} is not jstack/${task}-*`);
  if (/^jstack\/\d+-revert$/.test(headRef) || /<!--\s*jstack:revert/.test(String(pr.body))) add('revert PRs are never auto-merged');

  const head = String(pr.headRefOid || '').toLowerCase();
  const verdict = newestVerdict(pr.comments, isTrusted);
  if (!verdict) add('no trusted verdict');
  else {
    if (verdict.result !== 'PASS') add('newest verdict is not PASS');
    if (!/^[0-9a-f]{40}$/.test(head) || verdict.sha !== head) add('newest verdict is not for the current head');
    if (verdict.door !== 'two-way') add('reviewer did not rate it a two-way door');
    if (verdict.verify !== 'machine') add('verifier did not fully verify it by machine (verify is not machine)');
  }
  if (authorDoor(pr.body) !== 'two-way') add('author did not rate it a two-way door');

  const maxLines = autonomy.max_lines === undefined ? DEFAULT_MAX_LINES : Number(autonomy.max_lines);
  const lines = Number(pr.additions) + Number(pr.deletions);
  if (!Number.isInteger(maxLines) || !Number.isFinite(lines)) add('could not evaluate diff size');
  else if (lines > maxLines) add(`diff is ${lines} lines, over the ${maxLines} limit`);

  const globs = [...DEFAULT_HUMAN_PATHS, ...asList(config?.protected_paths), ...asList(config?.human_paths)];
  const regexes = globs.map(globToRegExp);
  const files = asList(facts.files);
  const paths = files.flatMap((f) => [f.filename, f.previous_filename]).filter((p) => typeof p === 'string' && p).map((p) => p.replace(/\\/g, '/'));
  if (files.length === 0 || files.some((f) => typeof f.filename !== 'string')) add('could not read changed files');
  else if (Number.isInteger(pr.changedFiles) && pr.changedFiles !== files.length) add(`read ${files.length} changed files but the PR has ${pr.changedFiles}`);
  const human = [...new Set(paths.filter((p) => regexes.some((r) => r.test(p))))];
  if (human.length) add(`touches human-only paths: ${human.join(', ')}`);

  const behind = String(facts.behindBy ?? '').trim() === '' ? NaN : Number(facts.behindBy);
  if (!Number.isInteger(behind)) add('could not tell whether the branch is up to date with trunk');
  else if (behind > 0) add(`branch is ${behind} commits behind trunk`);

  const cs = checksState(pr.statusCheckRollup);
  if (cs.state === 'empty') add('no GitHub checks reported', true);
  else if (cs.state === 'pending') add(`GitHub checks still running: ${cs.bad.join(', ')}`, true);
  else if (cs.state === 'red') add(`GitHub checks not green: ${cs.bad.join(', ')}`);
  if (pr.mergeable === 'UNKNOWN') add('GitHub has not computed mergeability yet (UNKNOWN)', true);
  else if (pr.mergeable !== 'MERGEABLE') add(`PR is not mergeable (${pr.mergeable})`);

  return {
    eligible: reasons.length === 0, behind: behind > 0, lines: Number.isFinite(lines) ? lines : null, task, reasons,
    pending: reasons.length > 0 && retryable === reasons.length,
  };
}

const PR_FIELDS = 'number,title,body,headRefOid,baseRefName,headRefName,state,isDraft,isCrossRepository,author,additions,deletions,changedFiles,comments,statusCheckRollup,mergeable';

/** Read everything evaluate needs and decide once. */
export function evaluateOnce(prNumber, { cwd, exec = defaultExec, ctx = makeCtx({ exec, cwd }) } = {}) {
  const loaded = loadConfig({ cwd, source: 'trunk', exec: ctx.exec });
  if (!loaded.ok) return { eligible: false, behind: false, lines: null, task: null, reasons: loaded.errors.map((e) => `config: ${e}`), pending: false };
  try {
    const pr = ctx.ghJson(['pr', 'view', String(prNumber), '--json', PR_FIELDS]);
    const defaultBranch = ctx.gh(['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']).trim();
    const files = ctx.ghPaginated(`repos/{owner}/{repo}/pulls/${Number(prNumber)}/files`);
    const behindBy = ctx.gh(['api', `repos/{owner}/{repo}/compare/${defaultBranch}...${pr.headRefOid}`, '--jq', '.behind_by']).trim();
    return evaluate(loaded.config, pr, { behindBy, defaultBranch, files, isTrusted: ctx.isTrusted });
  } catch (err) {
    return { eligible: false, behind: false, lines: null, task: null, reasons: [`could not read the PR: ${firstLine(err)}`], pending: false };
  }
}

/** Decide, re-reading every `pollMs` while only retryable reasons remain, up to `waitSec`. */
export async function run(prNumber, { cwd, exec = defaultExec, waitSec = 0, sleep = realSleep, now = Date.now, pollMs = 20_000 } = {}) {
  const ctx = makeCtx({ exec, cwd });
  const t0 = now();
  let r = evaluateOnce(prNumber, { cwd, ctx });
  while (!r.eligible && r.pending && now() - t0 + pollMs <= waitSec * 1000) {
    await sleep(pollMs);
    r = evaluateOnce(prNumber, { cwd, ctx });
  }
  return r;
}

if (isMain(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const prNumber = toInt(a.pr);
  const waitSec = a.wait === undefined ? 0 : toInt(a.wait);
  const bad = (msg) => emit({ eligible: false, behind: false, lines: null, task: null, reasons: [msg], pending: false }, false);
  if (prNumber === null || waitSec === null) bad('usage: automerge.mjs --pr <number> [--wait <seconds>] [--cwd <path>]');
  else {
    run(prNumber, { cwd: resolve(typeof a.cwd === 'string' ? a.cwd : process.cwd()), waitSec })
      .then((r) => emit(r, r.eligible), (err) => bad(`internal error: ${firstLine(err)}`));
  }
}
