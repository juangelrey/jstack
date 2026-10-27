---
name: implement
description: Plan a task for approval, then build it test-first on a branch and open a PR.
disable-model-invocation: true
argument-hint: "#<task>"
model: sonnet
---

# Implement

Produce the change for one **task**: first a **plan** the human approves, then a branch and PR built test-first. Read `<jstack root>/reference/contract.md` first (`<jstack root>` is two directories above this skill's base directory).

The task is: $ARGUMENTS

## Route

```sh
node <jstack root>/scripts/config.mjs
node <jstack root>/scripts/github.mjs state --task <task>
```

Then follow the one file this state leads to, in this skill's directory:

- `ready` → [plan.md](plan.md)
- `planned` with `feedback` from `github.mjs plan --task <task>` → [plan.md](plan.md). Without feedback: the plan awaits the human, who comments feedback or adds `<prefix>: approved`. Stop.
- `approved` → [build.md](build.md)
- `implementing`, by `github.mjs pr --task <task>`:
  - no PR: an earlier build stopped midway → [build.md](build.md), resuming
  - PR whose newest verdict is FAIL → [fix.md](fix.md)
  - PR with no FAIL verdict: move to `proving` and point the human to `/jstack:prove #<task>`
- anything else: say which phase the task needs.

## Block

When a step cannot go on: `github.mjs move --task <task> --from <state> --to blocked`, post the contract's blocked comment with `phase=implement`, and stop.
