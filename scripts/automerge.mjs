#!/usr/bin/env node
// Decides whether a proven PR may merge without a human (ADR-0008) and prints one JSON object.
// Fails closed: anything it cannot evaluate makes the PR ineligible.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './checks.mjs';

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

/** Convert a glob (`**`, `*`, `?`) to an anchored, case-insensitive RegExp over forward-slash paths. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

const asList = (v) => (Array.isArray(v) ? v : []);

/** Newest jstack verdict marker in a list of comment bodies, or null. */
export function newestVerdict(commentBodies) {
  const re = /<!--\s*jstack:verdict\s+sha=([0-9a-f]+)\s+result=(PASS|FAIL)(?:\s+door=(one-way|two-way))?\s*-->/i;
  for (let i = commentBodies.length - 1; i >= 0; i--) {
    const m = String(commentBodies[i]).match(re);
    if (m) return { sha: m[1].toLowerCase(), result: m[2].toUpperCase(), door: m[3] ? m[3].toLowerCase() : null };
  }
  return null;
}

/** The author's door from the PR body's `## Merge danger` section: 'two-way', 'one-way' or null. */
export function authorDoor(body) {
  const m = String(body).match(/##\s*Merge danger\s*\r?\n+\s*(?:[-*]\s*)?\**\s*(two-way|one-way)/i);
  return m ? m[1].toLowerCase() : null;
}

function checksGreen(rollup) {
  const ok = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
  return asList(rollup).every((c) => ok.has(String(c.conclusion || c.state || '').toUpperCase()));
}

/**
 * Pure decision. `pr` is `gh pr view --json number,body,headRefOid,additions,deletions,files,comments,statusCheckRollup,mergeable`,
 * `behindBy` is how many trunk commits the head lacks.
 */
export function evaluate(config, pr, behindBy) {
  const reasons = [];
  const autonomy = config.autonomy && typeof config.autonomy === 'object' ? config.autonomy : {};

  if (autonomy.ship_two_way !== 'dark') reasons.push('auto-merge not granted (autonomy.ship_two_way is not dark)');

  const head = String(pr.headRefOid || '').toLowerCase();
  const verdict = newestVerdict(asList(pr.comments).map((c) => c.body));
  if (!verdict) reasons.push('no verdict');
  else {
    if (verdict.result !== 'PASS') reasons.push('newest verdict is not PASS');
    if (!head || verdict.sha !== head) reasons.push('newest verdict is not for the current head');
    if (verdict.door !== 'two-way') reasons.push('reviewer did not rate it a two-way door');
  }
  if (authorDoor(pr.body) !== 'two-way') reasons.push('author did not rate it a two-way door');

  const maxLines = autonomy.max_lines === undefined ? DEFAULT_MAX_LINES : Number(autonomy.max_lines);
  const lines = Number(pr.additions) + Number(pr.deletions);
  if (!Number.isFinite(maxLines) || !Number.isFinite(lines)) reasons.push('could not evaluate diff size');
  else if (lines > maxLines) reasons.push(`diff is ${lines} lines, over the ${maxLines} limit`);

  const globs = [...DEFAULT_HUMAN_PATHS, ...asList(config.protected_paths), ...asList(config.human_paths)];
  const regexes = globs.map(globToRegExp);
  const files = asList(pr.files).map((f) => String(f.path).replace(/\\/g, '/'));
  if (files.length === 0) reasons.push('could not read changed files');
  const human = files.filter((p) => regexes.some((r) => r.test(p)));
  if (human.length) reasons.push(`touches human-only paths: ${human.join(', ')}`);

  const behind = String(behindBy ?? '').trim() === '' ? NaN : Number(behindBy);
  if (!Number.isFinite(behind)) reasons.push('could not tell whether the branch is up to date with trunk');
  else if (behind > 0) reasons.push(`branch is ${behind} commits behind trunk`);

  if (!checksGreen(pr.statusCheckRollup)) reasons.push('GitHub checks are not all green');
  if (pr.mergeable !== 'MERGEABLE') reasons.push(`PR is not mergeable (${pr.mergeable})`);

  return { eligible: reasons.length === 0, behind: behind > 0, lines, reasons };
}

function gh(args, cwd) {
  return execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function run(prNumber, cwd) {
  try {
    const fields = 'number,body,headRefOid,baseRefName,additions,deletions,files,comments,statusCheckRollup,mergeable';
    const pr = JSON.parse(gh(['pr', 'view', String(prNumber), '--json', fields], cwd));
    const behindBy = gh(['api', `repos/{owner}/{repo}/compare/${pr.baseRefName}...${pr.headRefOid}`, '--jq', '.behind_by'], cwd).trim();
    return evaluate(loadConfig(cwd), pr, behindBy);
  } catch (err) {
    return { eligible: false, behind: false, lines: null, reasons: [`could not read the PR: ${String(err.message).split('\n')[0]}`] };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
  const pr = arg('--pr');
  const report = pr ? run(pr, resolve(arg('--cwd') || process.cwd())) : { eligible: false, behind: false, lines: null, reasons: ['usage: automerge.mjs --pr <number> [--cwd <path>]'] };
  process.stdout.write(JSON.stringify(report) + '\n');
  process.exit(report.eligible ? 0 : 1);
}
