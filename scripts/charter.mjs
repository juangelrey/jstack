// Charter: when a plan may build without a human approval, and whether a PR stayed inside its plan.
// Pure: callers pass in the config, task, plan and changed files. Fails closed: anything unreadable needs a human.
import { DEFAULT_HUMAN_PATHS, matchingGlobs } from './config.mjs';
import { planFields, validatePlan } from './validate.mjs';

const SIZES = ['XS', 'S', 'M', 'L'];
const isNone = (s) => /^(?:[-*]\s*)?None\.?$/i.test(String(s ?? '').trim());
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

/** Test files, in any stack. Matched case-insensitively. */
export const TEST_PATHS = ['**/test/**', '**/tests/**', '**/__tests__/**', '**/spec/**', '**/*.test.*', '**/*.spec.*', '**/*_test.*', '**/test_*.py'];

/** Paths in a plan field: backticked tokens, else one per line or comma, without bullets or trailing notes. */
export function planPaths(text) {
  const t = String(text ?? '');
  const ticks = [...t.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]);
  const items = ticks.length ? ticks : t.split(/[\n,]/)
    .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').replace(/\s+\(.*$|:\s.*$|\s+[—-]\s.*$/, '').trim())
    .filter(Boolean);
  return [...new Set(items.map(norm))];
}

/** What a plan declares: files, door, whether it adds dependencies, existing tests it changes. null = unreadable. */
export function planFacts(body) {
  const f = planFields(body);
  const has = (k) => typeof f[k] === 'string' && f[k].trim() !== '';
  return {
    files: has('files') ? planPaths(f.files) : null,
    door: f.door?.trim().match(/^\**\s*(one-way|two-way)\b/i)?.[1].toLowerCase() ?? null,
    addsDependencies: has('new dependencies') ? !isNone(f['new dependencies']) : null,
    testsChanged: !has('existing tests changed') ? null : isNone(f['existing tests changed']) ? [] : planPaths(f['existing tests changed']),
  };
}

/** Globs a plan may not touch without a human. */
const humanGlobs = (config) => [...DEFAULT_HUMAN_PATHS, ...(config.protected_paths ?? []), ...(config.human_paths ?? [])];

/**
 * Reasons the newest plan needs a human approval; [] means the charter approves it.
 * plan: {body} or null; feedback: trusted comments after it; task: {size, body}.
 */
export function charterReasons({ config, task, plan, feedback = [] }) {
  const reasons = [];
  const add = (r) => reasons.push(r);
  const autonomy = config?.autonomy ?? {};
  if (autonomy.plan !== 'dark') return ['autonomy.plan is lit: a human approves each plan'];
  const max = autonomy.plan_max_size ?? 'S';
  if (!SIZES.includes(task?.size)) add('task size is unknown');
  else if (SIZES.indexOf(task.size) > SIZES.indexOf(max)) add(`task size ${task.size} is over autonomy.plan_max_size ${max}`);
  if (!plan?.body) return [...reasons, 'no trusted plan'];
  if (feedback.length) add('feedback after the newest plan: re-plan first');
  for (const e of validatePlan(plan.body, { maxSteps: config?.limits?.max_plan_steps, taskText: task?.body })) add(`plan: ${e}`);
  const facts = planFacts(plan.body);
  if (!facts.files?.length) add('plan lists no Files');
  if (facts.door !== 'two-way') add(`plan door is ${facts.door ?? 'unknown'}: only two-way plans skip the human`);
  if (facts.addsDependencies !== false) add('plan adds dependencies, or does not say');
  if (facts.testsChanged === null) add('plan does not say which existing tests it changes');
  else if (facts.testsChanged.length) add(`plan changes existing tests: ${facts.testsChanged.join(', ')}`);
  const human = (facts.files ?? []).filter((p) => matchingGlobs(p, humanGlobs(config)).length);
  if (human.length) add(`plan touches human-only paths: ${human.join(', ')}`);
  return reasons;
}

/**
 * Where a PR left its plan. files: PR files from the GitHub API ({filename, previous_filename, status}).
 * Returns reasons; [] means the diff matches the plan. A plan's Files may be paths or globs.
 */
export function driftReasons(planBody, files) {
  const facts = planFacts(planBody);
  if (!facts.files?.length) return ['plan lists no Files'];
  if (!Array.isArray(files) || files.length === 0 || files.some((f) => typeof f?.filename !== 'string')) return ['could not read the changed files'];
  const declared = (p, list) => list.some((g) => norm(g).toLowerCase() === p.toLowerCase() || matchingGlobs(p, [norm(g)]).length);
  const reasons = [];
  const undeclared = new Set();
  const tests = new Set();
  for (const f of files) {
    const paths = [f.filename, f.previous_filename].filter((p) => typeof p === 'string' && p).map(norm);
    for (const p of paths) {
      if (!declared(p, facts.files)) undeclared.add(p);
      if (f.status !== 'added' && matchingGlobs(p, TEST_PATHS).length && !declared(p, facts.testsChanged ?? [])) tests.add(p);
    }
  }
  if (undeclared.size) reasons.push(`changed files not in the plan: ${[...undeclared].join(', ')}`);
  if (tests.size) reasons.push(`changed existing tests the plan did not declare: ${[...tests].join(', ')}`);
  return reasons;
}
