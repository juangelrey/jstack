---
name: implement
description: Plan a task for approval, then build it test-first on a branch and open a PR.
disable-model-invocation: true
argument-hint: "#<task>"
model: sonnet
---

# Implement

Produce the change for one **task**: first a **plan** the human approves, then a branch and PR built test-first. Read `<jstack root>/reference/contract.md` before acting (`<jstack root>` is two directories above this skill's base directory). It defines every label, comment and PR format used below.

The task is: $ARGUMENTS

## 1. Read state

```sh
gh issue view <task> --json number,title,body,labels,comments
```

Read `.jstack/config.yml` if present (defaults in the contract). Take the one `jstack:*` label and branch:

- `jstack:ready`: go to 2.
- `jstack:planned`: say the plan awaits approval, and that the human adds `jstack:approved` on the issue in GitHub. Stop.
- `jstack:approved`: go to 3.
- `jstack:implementing`: find the task's PR as the contract describes. If there is one and its newest verdict comment is `result=FAIL`, go to 4. Otherwise stop and report the state.
- Anything else: stop and say which phase the task needs instead (`proving` and `landed` need `/jstack:prove` or `/jstack:ship`, `blocked` needs a human).

Done when you know the state and which section applies.

## 2. Plan (`jstack:ready`)

For each issue under Dependencies, check it carries `jstack:landed` or `jstack:deployed`. If any does not, stop and name it. Do not plan on unlanded work.

Dispatch the `planner` subagent with the task number and the absolute `<jstack root>` path. It returns the plan text only. Check it has at most `limits.max_plan_steps` steps and a test for every acceptance criterion; send it back once if not. Post it, then move the label in one call:

```sh
gh issue comment <task> --body-file <plan file>
gh issue edit <task> --remove-label jstack:ready --add-label jstack:planned
```

Done when the plan comment is posted and the label is `jstack:planned`. Tell the human to review the plan and add `jstack:approved` on GitHub, then stop. Never add that label yourself.

## 3. Build (`jstack:approved`)

### 3a. Set up

The newest `jstack:plan` comment is the plan; follow it. Set `jstack:implementing`, then:

```sh
git worktree add ../<repo>-jstack-<task> -b jstack/<task>-<slug> <default branch>
```

Work only inside that worktree. Run the checks once before changing anything so you know the baseline.

Done when the worktree exists on its branch and the baseline result is known.

### 3b. Test first

Work the plan's steps in order, one acceptance criterion at a time:

1. **Red**: write the test from the plan's "Tests first". Run it and watch it fail for the right reason. A test that passes before the code exists proves nothing.
2. **Green**: write the least code that passes it.
3. **Refactor**: invoke the `jstack:refactor` skill on the code this step touched. Checks stay green.
4. Commit this step alone, with a message saying what and why.

Test through public interfaces, not private internals. Apply a design pattern only where it removes duplication or branching that is already there, never in anticipation.

Never edit a path matching `protected_paths`. If the plan needs one, stop and block (3d). If the plan proves wrong or incomplete, stop and block rather than improvise a different design.

Done when every acceptance criterion has a test that failed first and passes now, in small commits.

### 3c. Self-check

```sh
node <jstack root>/scripts/checks.mjs --cwd <worktree>
```

On failure, read `outputTail`, fix the cause (not the check), rerun. Retry up to `limits.max_retries` times.

Self-checks are your own. They tell you when to stop fixing; they are not proof and never go in the PR as a verdict. Prove establishes correctness independently.

Done when the script exits 0, or the retries are spent (3d).

### 3d. If blocked

Set `jstack:blocked` and post the contract's blocked comment with `phase=implement`: why, what you tried, the specific decision the human must make. Stop.

### 3e. Open the PR

```sh
git push -u origin jstack/<task>-<slug>
gh pr create --title "<task title>" --body-file <body file>
```

Body in the contract's PR format. Evidence is real check output and test results for each acceptance criterion. Merge danger follows the contract's one-way door definition.

Then `gh issue edit <task> --remove-label jstack:implementing --add-label jstack:proving`.

Done when the PR is open and the label is `jstack:proving`. Reply with the PR URL and tell the human the next phase is `/jstack:prove #<task>`.

## 4. Fix a FAIL verdict (`jstack:implementing`, PR exists)

Read the newest `jstack:verdict` comment on the PR (`gh pr view --json comments`). Its Findings are the work list; fix those and nothing else.

Reuse the existing worktree `../<repo>-jstack-<task>` and branch (recreate the worktree from the remote branch if it is gone). For each finding, write a failing test that captures it where it is testable, fix it, and commit. Run 3c. Push to the same branch, then set `jstack:proving`.

If the same finding returns or a finding needs a decision, block per 3d.

Done when the fixes are pushed, checks pass, and the label is `jstack:proving`. Reply with the PR URL and tell the human the next phase is `/jstack:prove #<task>`.
