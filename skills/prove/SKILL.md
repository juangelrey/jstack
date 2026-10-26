---
name: prove
description: Independently prove a task's PR is right: checks, review, verifier and security gates, then post a verdict.
disable-model-invocation: true
argument-hint: "#<task>"
model: sonnet
---

# Prove

Establish, independently of the author, whether the task's PR is right. Read `<jstack root>/reference/contract.md` first (`<jstack root>` is two directories above this skill's base directory). Inputs: the task issue, its PR, `.jstack/config.yml`. Output: one verdict comment on the PR and a label change.

The task is: $ARGUMENTS

The author's own self-checks, test output and PR Evidence never count. Only what this phase runs, or what its fresh subagents observe, counts.

## 1. Accept

Fetch the task: `gh issue view <task> --json labels,body,comments`. Proceed only if its label is `jstack:proving`. Otherwise stop and say which phase the label needs instead.

Find the task's PR as the contract describes. No open PR: stop and say so.

Record `SHA` = the PR's full `headRefOid`. Everything below is about that SHA.

Done when you hold the task number, PR number and SHA.

## 2. Prove in parallel

Fetch the head and make a detached worktree outside the repo:

```sh
git fetch origin pull/<pr>/head
git worktree add --detach <tmp dir> <SHA>
```

In one message, start all four at once:

- **Checks**: `node <jstack root>/scripts/checks.mjs --cwd <tmp dir>`. Read the JSON. `pass: false`, or no checks declared, is FAIL. Quote failing commands and `outputTail`.
- Subagents `reviewer`, `verifier`, `security-reviewer`. None wrote the change. Give each only: task number, PR number, SHA, and the absolute `<jstack root>` path. No summary, no opinion, no earlier verdicts (ADR-0005).

Remove your worktree when all four return (`git worktree remove --force <tmp dir>`).

Done when you have four results. A subagent that errors or returns no verdict counts as FAIL for its gate.

## 3. Verdict

Re-read the PR head. If it is no longer `SHA`, discard everything, post nothing, tell the human the head moved during Prove and to rerun `/jstack:prove #<task>`. Stop.

Otherwise write the contract's verdict comment: `result=PASS` only if every gate passes (Verifier `PASS+NOTES` passes). Blocking findings go under Findings with file:line and fix, deduplicated, each tagged with its gate. Non-blocking observations go under Notes. Post it:

```sh
gh pr comment <pr> --body-file <file>
```

Done when the comment is on the PR with the full `SHA` in its marker.

## 4. Move the task

**PASS**: leave `jstack:proving`. Tell the human the next step is `/jstack:ship #<task>`.

**FAIL**: count PR comments with a `jstack:verdict` marker and `result=FAIL`, including the one just posted. Read `limits.max_retries` (default 3).

- Count below max: `gh issue edit <task> --remove-label jstack:proving --add-label jstack:implementing`. Tell the human the next step is `/jstack:implement #<task>`.
- Count at or above max: `gh issue edit <task> --remove-label jstack:proving --add-label jstack:blocked`, and post the contract's blocked comment on the task (`phase=prove`; Why: attempt count; Tried: the verdicts; Human decision needed: rescope, rewrite the task, or abandon).

Done when the label matches the verdict and the human knows the next command, or that the task is blocked.
