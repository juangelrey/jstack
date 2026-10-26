#!/usr/bin/env node
// Deterministic shape checks for the artifacts behind the human gates. Prints {ok, errors}.
import { readFileSync } from 'node:fs';
import { emit, firstLine, isMain, parseArgs, toInt } from './lib.mjs';

/** Level-2 sections in order: [{name, body}]. Text before the first heading is skipped. */
export function sections(text) {
  const out = [];
  let cur = null;
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    const m = line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (m && !line.startsWith('###')) { cur = { name: m[1].trim(), body: '' }; out.push(cur); } else if (cur) cur.body += `${line}\n`;
  }
  for (const s of out) s.body = s.body.trim();
  return out;
}

/** Body of the single section `name` (case-insensitive), pushing errors for missing/duplicate/empty. */
function need(secs, name, errors, { allowEmpty = false } = {}) {
  const found = secs.filter((s) => s.name.toLowerCase() === name.toLowerCase());
  if (found.length === 0) { errors.push(`missing section ## ${name}`); return null; }
  if (found.length > 1) errors.push(`section ## ${name} appears ${found.length} times`);
  if (!allowEmpty && !found[0].body) errors.push(`section ## ${name} is empty`);
  return found[0].body;
}

const lines = (s) => String(s ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
const checkboxes = (s) => lines(s).filter((l) => /^[-*]\s+\[[ xX]\]\s+\S/.test(l));
const numbered = (s) => lines(s).filter((l) => /^\d+[.)]\s+\S/.test(l));

/** GitHub closing-keyword references (`fixes #3`, `closes o/r#3`, `resolves <issue url>`). */
export function closingKeywords(text) {
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b[\s:]+(?:[\w.-]+\/[\w.-]+#\d+|#\d+|https?:\/\/\S+\/(?:issues|pull)\/\d+)/gi;
  return [...String(text).matchAll(re)].map((m) => m[0]);
}

export const INTENT_SECTIONS = ['Outcome', 'Why', 'Who benefits', 'Success signals', 'In scope', 'Out of scope', 'Constraints', 'Known unknowns'];

/** Intent body: every section once, in order, non-empty. */
export function validateIntent(text) {
  const errors = [];
  const secs = sections(text);
  for (const name of INTENT_SECTIONS) need(secs, name, errors);
  const order = secs.map((s) => s.name.toLowerCase()).filter((n) => INTENT_SECTIONS.some((x) => x.toLowerCase() === n));
  const want = INTENT_SECTIONS.map((x) => x.toLowerCase()).filter((n) => order.includes(n));
  if (errors.length === 0 && order.join('|') !== want.join('|')) errors.push(`sections out of order: expected ${INTENT_SECTIONS.join(', ')}`);
  return errors;
}

/** Spec body: marker, ## Spec, ## Tasks with `- [ ] #N title` lines. */
export function validateSpec(text, { draft = false } = {}) {
  const errors = [];
  if (!/<!-- jstack:spec intent=#\d+ -->/.test(text)) errors.push('missing <!-- jstack:spec intent=#N --> marker');
  const secs = sections(text);
  need(secs, 'Spec', errors);
  const tasks = need(secs, 'Tasks', errors, { allowEmpty: true });
  if (tasks !== null) {
    const ls = lines(tasks);
    if (ls.length === 0 && !draft) errors.push('section ## Tasks is empty (allowed only with --draft)');
    for (const l of ls) if (!/^- \[[ xX]\] #\d+ \S/.test(l)) errors.push(`bad task line: ${l}`);
  }
  return errors;
}

/** Task body: marker, Description, Acceptance criteria, Verification steps, Dependencies. */
export function validateTask(text, { allowL = false, known = null } = {}) {
  const errors = [];
  const m = String(text).match(/<!-- jstack:task spec=#(\d+) size=(XS|S|M|L) -->/);
  if (!m) errors.push('missing <!-- jstack:task spec=#N size=XS|S|M|L --> marker');
  else if (m[2] === 'L' && !allowL) errors.push('size L: split the task (allowed only with --allow-l)');
  const secs = sections(text);
  need(secs, 'Description', errors);
  const ac = need(secs, 'Acceptance criteria', errors);
  if (ac !== null) {
    const n = checkboxes(ac).length;
    if (n === 0) errors.push('## Acceptance criteria needs at least one "- [ ]" item');
    if (n > 7) errors.push(`${n} acceptance criteria: the task is too big, split it (max 7)`);
  }
  const vs = need(secs, 'Verification steps', errors);
  if (vs !== null && numbered(vs).length === 0) errors.push('## Verification steps needs at least one numbered item');
  const deps = need(secs, 'Dependencies', errors);
  if (deps !== null && !/^(?:[-*]\s*)?None\.?$/i.test(deps.trim())) {
    for (const l of lines(deps)) {
      const d = l.match(/^[-*]\s+#(\d+)\b/);
      if (!d) errors.push(`bad dependency line: ${l} (use "- #N" or None)`);
      else if (known && !known.includes(Number(d[1]))) errors.push(`dependency #${d[1]} is not a known task`);
    }
  }
  return errors;
}

/** Acceptance criteria count in a task body. */
export const acceptanceCount = (taskText) => checkboxes(sections(taskText).find((s) => /^acceptance criteria$/i.test(s.name))?.body).length;

const PLAN_FIELDS = ['Goal', 'Files', 'Tests first', 'Steps', 'Risks', 'Out of scope'];

/** Plan fields as `**Name**:` labels or `##`/`###` headings: {name: body}. */
export function planFields(text) {
  const out = {};
  let cur = null;
  const names = PLAN_FIELDS.map((f) => f.toLowerCase());
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    const h = line.match(/^#{2,3}\s+(.+?)\s*:?\s*$/);
    const b = line.match(/^\*\*(.+?):?\*\*:?\s*(.*)$/);
    const name = (h?.[1] ?? b?.[1] ?? '').toLowerCase().trim();
    if ((h || b) && names.includes(name)) {
      cur = name;
      if (cur in out) out[`${cur}#dup`] = true;
      out[cur] = b ? `${b[2]}\n` : '';
    } else if (h) cur = null;
    else if (cur) out[cur] += `${line}\n`;
  }
  return out;
}

/** Plan comment: marker first, all fields, step count, tests >= acceptance criteria, <= 250 lines. */
export function validatePlan(text, { maxSteps, taskText }) {
  const errors = [];
  const all = String(text).replace(/\r\n/g, '\n');
  if (lines(all)[0] !== '<!-- jstack:plan -->') errors.push('first line must be <!-- jstack:plan -->');
  const f = planFields(all);
  for (const name of PLAN_FIELDS) {
    const k = name.toLowerCase();
    if (!(k in f)) errors.push(`missing ${name}`);
    else if (!f[k].trim()) errors.push(`${name} is empty`);
    if (f[`${k}#dup`]) errors.push(`${name} appears more than once`);
  }
  const steps = numbered(f.steps).length;
  if (!Number.isInteger(maxSteps)) errors.push('--max-steps must be an integer');
  else if (steps < 1 || steps > maxSteps) errors.push(`Steps has ${steps} numbered items, must be 1..${maxSteps}`);
  const t = f['tests first'] ?? '';
  const items = lines(t).filter((l) => /^(?:[-*]|\d+[.)])\s+\S/.test(l)).length;
  const tests = items || t.split(';').map((x) => x.trim()).filter(Boolean).length;
  if (taskText === undefined) errors.push('--task-file is required');
  else {
    const ac = acceptanceCount(taskText);
    if (ac === 0) errors.push('task file has no acceptance criteria');
    if (tests < ac) errors.push(`Tests first lists ${tests} tests, fewer than the task's ${ac} acceptance criteria`);
  }
  const n = all.replace(/\n+$/, '').split('\n').length;
  if (n > 250) errors.push(`plan is ${n} lines, over 250`);
  return errors;
}

/** PR body (and title): marker, Task line, sections, Merge danger door, no closing keywords. */
export function validatePr(text, { task, title = '' }) {
  const errors = [];
  if (!Number.isInteger(task)) return ['--task must be an integer'];
  if (!String(text).includes(`<!-- jstack:pr task=#${task} -->`)) errors.push(`missing <!-- jstack:pr task=#${task} --> marker`);
  if (!new RegExp(`^Task: #${task}\\s*$`, 'm').test(text)) errors.push(`missing "Task: #${task}" line`);
  const secs = sections(text);
  need(secs, 'Summary', errors);
  need(secs, 'Evidence', errors);
  const md = need(secs, 'Merge danger', errors);
  if (md && !/^(?:[-*]\s*)?\**\s*(?:two-way door|one-way door)\b/i.test(lines(md)[0])) errors.push('## Merge danger must start with "two-way door" or "one-way door"');
  for (const k of closingKeywords(`${title}\n${text}`)) errors.push(`closing keyword "${k}": name the task without closing it`);
  return errors;
}

const GATES = ['Checks', 'Review', 'Verifier', 'Security', 'Door (reviewer)'];

/** Verdict comment: marker for the sha, gate table, result consistent with gates. */
export function validateVerdict(text, { sha }) {
  const errors = [];
  if (!/^[0-9a-f]{40}$/.test(String(sha ?? ''))) return ['--sha must be a full 40-hex sha'];
  const m = String(text).match(/<!-- jstack:verdict sha=([0-9a-f]{40}) result=(PASS|FAIL|ERROR) door=(one-way|two-way) verify=(machine|human) -->/);
  if (!m) return ['missing <!-- jstack:verdict sha=<40 hex> result=PASS|FAIL|ERROR door=one-way|two-way verify=machine|human --> marker'];
  const [, vsha, result, door, verify] = m;
  if (vsha !== sha) errors.push(`verdict sha ${vsha} is not ${sha}`);
  const rows = {};
  for (const l of String(text).split(/\r?\n/)) {
    const r = l.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/);
    if (r && GATES.includes(r[1])) {
      if (r[1] in rows) errors.push(`gate ${r[1]} appears twice`);
      rows[r[1]] = r[2].toUpperCase();
    }
  }
  for (const g of GATES) if (!(g in rows)) errors.push(`missing table row ${g}`);
  if (errors.length) return errors;
  const okVals = { Checks: ['PASS', 'FAIL', 'ERROR'], Review: ['PASS', 'FAIL', 'ERROR'], Security: ['PASS', 'FAIL', 'ERROR'], Verifier: ['PASS', 'PASS+NOTES', 'PASS+HUMAN', 'FAIL', 'ERROR'], 'Door (reviewer)': ['ONE-WAY', 'TWO-WAY'] };
  for (const g of GATES) if (!okVals[g].includes(rows[g])) errors.push(`gate ${g} has bad value ${rows[g]}`);
  if (errors.length) return errors;
  if (rows['Door (reviewer)'].toLowerCase() !== door) errors.push(`marker door=${door} but table says ${rows['Door (reviewer)'].toLowerCase()}`);
  const gates = ['Checks', 'Review', 'Verifier', 'Security'].map((g) => rows[g]);
  const expected = gates.includes('ERROR') ? 'ERROR' : gates.every((v) => v.startsWith('PASS')) ? 'PASS' : 'FAIL';
  if (result !== expected) errors.push(`result=${result} but the gates imply ${expected}`);
  const wantVerify = rows.Verifier === 'PASS+HUMAN' ? 'human' : 'machine';
  if (verify !== wantVerify) errors.push(`verify=${verify} but Verifier is ${rows.Verifier}`);
  const h = String(text).match(/^##\s*Prove:\s*(\S+)/m);
  if (h && h[1].toUpperCase() !== result) errors.push(`heading says ${h[1]} but result=${result}`);
  return errors;
}

/** Commit message: no closing keywords. */
export const validateCommitMsg = (text) => closingKeywords(text).map((k) => `closing keyword "${k}": name the task without closing it`);

const USAGE = 'usage: validate.mjs intent|spec|task|plan|pr|verdict|commit-msg --file F [--draft] [--allow-l] [--known 3,4] [--max-steps N --task-file T] [--task N --title T] [--sha S]';

/** Validate one kind of artifact from CLI args. Returns {ok, errors}. */
export function validate(argv, read = (f) => readFileSync(f, 'utf8')) {
  const a = parseArgs(argv);
  const kind = a._[0];
  let text;
  try {
    if (typeof a.file !== 'string') throw new Error('missing --file');
    text = read(a.file).replace(/^﻿/, '');
  } catch (err) {
    return { ok: false, errors: [`${firstLine(err)}. ${USAGE}`] };
  }
  let errors;
  try {
    switch (kind) {
      case 'intent': errors = validateIntent(text); break;
      case 'spec': errors = validateSpec(text, { draft: Boolean(a.draft) }); break;
      case 'task': {
        const known = typeof a.known === 'string' ? a.known.split(',').map((x) => toInt(x.trim().replace(/^#/, ''))) : null;
        if (known && known.some((x) => x === null)) { errors = ['bad --known list']; break; }
        errors = validateTask(text, { allowL: Boolean(a['allow-l']), known });
        break;
      }
      case 'plan': {
        const taskText = typeof a['task-file'] === 'string' ? read(a['task-file']) : undefined;
        errors = validatePlan(text, { maxSteps: toInt(a['max-steps']), taskText });
        break;
      }
      case 'pr': errors = validatePr(text, { task: toInt(a.task), title: typeof a.title === 'string' ? a.title : '' }); break;
      case 'verdict': errors = validateVerdict(text, { sha: typeof a.sha === 'string' ? a.sha.toLowerCase() : null }); break;
      case 'commit-msg': errors = validateCommitMsg(text); break;
      default: errors = [USAGE];
    }
  } catch (err) {
    errors = [`could not validate: ${firstLine(err)}`];
  }
  return { ok: errors.length === 0, errors };
}

if (isMain(import.meta.url)) {
  const r = validate(process.argv.slice(2));
  emit(r, r.ok);
}
