---
name: ship
description: Merge a proven PR after the human says "merge", then watch the deploy and close the task.
disable-model-invocation: true
argument-hint: "#<task>"
model: haiku
---

# Ship

Land a proven PR and see it deployed, through the target's own CI/CD. Read `<jstack root>/reference/contract.md` and `<jstack root>/reference/merging.md` first (`<jstack root>` is two directories above this skill's base directory).

The task is: $ARGUMENTS

## 1. Route

`config.mjs` and `github.mjs state --task <task>`: `proving` → 2, `landed` → 5, anything else: say which phase it needs.

## 2. Verify the PR

With `github.mjs pr --task <task>` and `github.mjs verdict --pr <pr> --task <task>`, all must hold, or the task goes back to `/jstack:prove`:

- the verdict is PASS and its `sha` equals the head in full: the **proven SHA**
- the PR is open, not a draft, mergeable (`gh pr view <pr> --json state,isDraft,mergeable`)
- no GitHub check failing or pending (`gh pr checks <pr>`)

Done when all hold.

## 3. Merge gate

Show the human, verbatim: Summary, Evidence, Merge danger, the verdict table, and Human verification when `verify=human`. Say so if the PR ran no GitHub checks.

Done only when the human replies "merge". Anything else, "looks good" included, means ask again or stop.

## 4. Merge

1. Merge per merging.md, pinned to the proven SHA.
2. Move `proving → landed`.
3. Tick `- [x] #<task>` in the spec body (`task.spec` from `state`) with `gh issue edit <spec> --body-file`.

## 5. Deploy watch

Merge commit: `github.mjs pr --task <task> --state merged`, then `gh pr view <pr> --json mergeCommit --jq .mergeCommit.oid`.

**No `ship.deploy_workflow`**: comment that it landed in `<merge commit>` and the deploy is untracked, close the task (`--reason completed`), keep `landed`, tell the human. Go to 6.

**Otherwise**: `node <jstack root>/scripts/github.mjs deploy --workflow "<deploy_workflow>" --sha <merge commit> --timeout 540`, repeated while `pending`, six runs at most.

- `success`: move `landed → deployed`, close the task (`--reason completed`). Go to 6.
- anything else: block with `phase=ship` and the run URL, offering: rerun the deploy, then set `jstack:landed` and run `/jstack:ship #<task>`; revert and set `jstack:ready`; or fix forward with a new task via `/jstack:shape`. If the PR has a trusted `jstack:automerge` comment, first open the revert PR per merging.md.

## 6. Close the spec

A task is done when closed with `jstack:deployed`, or with `jstack:landed` in a repo with no deploy workflow. When every task in the spec's `## Tasks` is done: `gh issue close <spec> --reason completed`.

Done when the spec is closed, or you have named the tasks that remain.
