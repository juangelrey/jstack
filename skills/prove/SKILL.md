---
name: prove
description: Independently prove a task's PR is right: checks, review, verifier and security gates, then post a verdict.
disable-model-invocation: true
argument-hint: "#<task>"
model: sonnet
---

# Prove

Establish, independently of the author, whether the task's PR is right. Read `<jstack root>/reference/contract.md` first (`<jstack root>` is two directories above this skill's base directory). Only what this phase runs, or its fresh subagents observe, counts as proof; the author's checks and Evidence are claims.

The task is: $ARGUMENTS

## 1. Accept

`config.mjs`, `github.mjs state --task <task>`, `github.mjs pr --task <task>`. Proceed with state `proving` and one open PR; record `SHA`, its full `headRefOid`.

Done when you hold the task, PR and SHA.

## 2. Prove

```sh
git fetch origin pull/<pr>/head
git worktree add --detach <tmp dir> <SHA>
node <jstack root>/scripts/checks.mjs --cwd <tmp dir>
git worktree remove --force <tmp dir>
```

Checks: `pass: false` is FAIL (quote failing commands and `outputTail`); a `(config)` result or a crash is ERROR.

Then, in one message, start `jstack:reviewer`, `jstack:verifier` and `jstack:security-reviewer`. Each gets only the task, PR, SHA and `<jstack root>`: no summary, opinion or earlier verdict (ADR-0005).

Done when you have four results. A subagent that crashes, reports "head moved" or returns no result line is ERROR.

## 3. Verdict

If the PR head is no longer `SHA`, post nothing and tell the human to rerun `/jstack:prove #<task>`.

Otherwise compose the contract's verdict:

- `result`: ERROR if any gate errored, else PASS if every gate passed (`PASS+NOTES` and `PASS+HUMAN` pass), else FAIL.
- `door`: the reviewer's rating; `one-way` when it gave none or security raised an `ASK`.
- `verify=human` when the verifier returned `PASS+HUMAN`, with its steps under Human verification; else `machine`.
- Findings: blocking items, deduplicated, tagged by gate. `ASK` items and the rest go under Notes.

```sh
node <jstack root>/scripts/validate.mjs verdict --file <file> --sha <SHA>
gh pr comment <pr> --body-file <file>
```

## 4. Move the task

- **PASS**: stays `proving`; go to 5.
- **ERROR**: stays `proving`, costs no attempt. Tell the human which gate errored and to rerun once fixed.
- **FAIL**: by `failCount` from `github.mjs verdict`: up to `limits.max_retries`, move to `implementing` and point to `/jstack:implement #<task>`. Above it, block with `phase=prove`, offering: edit the task and set `jstack:implementing` for a fresh budget; close the PR, delete its branch and set `jstack:ready` to re-plan; or close PR and task as not planned.

## 5. Auto-merge (PASS only)

Follow `<jstack root>/reference/merging.md`, Auto-merge.

Done when the PR is merged, or the human has the script's reasons and `/jstack:ship #<task>`.
