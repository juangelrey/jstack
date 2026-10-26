---
name: ship
description: Merge a proven PR after the human says "merge", then watch the deploy and close the task.
disable-model-invocation: true
argument-hint: "#<task>"
model: haiku
---

# Ship

Land a proven PR and see it deployed. Read `reference/contract.md` in the jstack root (two directories above this skill's base directory) first. Inputs are GitHub artifacts only, never chat memory. jstack uses the target's CI/CD and never owns it.

The task is: $ARGUMENTS

## 1. Route

Read the task issue (`gh issue view <task> --json labels,body,comments`) and `.jstack/config.yml` (`ship.deploy_workflow`).

- `jstack:proving`: go to step 2.
- `jstack:landed`: the PR is already merged. Go to step 5.
- Any other state: stop and say which phase the task needs instead.

Done when you know which path applies.

## 2. Verify the PR

Find the task's PR as the contract describes. Stop and send the task back to `/jstack:prove` if any of these fail:

- The newest `jstack:verdict` comment has `result=PASS`.
- Its `sha` equals the current PR head SHA (`headRefOid`), compared in full.
- Required GitHub checks are green (`gh pr checks <pr> --required`). A repo with no required checks passes this condition.

Done when all three hold. Otherwise say which failed and stop.

## 3. Merge gate

Show the human, verbatim from the PR: Summary, Evidence, Merge danger, and the verdict table. Ask for an explicit "merge".

Done only when the human replies "merge" in chat. Anything else, including "looks good", is not the gate: ask again or stop.

## 4. Merge

```sh
gh pr merge <pr> --squash --delete-branch
gh issue edit <task> --remove-label jstack:proving --add-label jstack:landed
```

Then:

1. Remove the worktree if present: `git worktree remove ../<repo>-jstack-<task>` (add `--force` only if the only changes are build artifacts).
2. Tick the task's checkbox in the spec issue body (`- [ ] #<task>` to `- [x] #<task>`) with `gh issue edit <spec> --body-file`. The spec number is in the task's `jstack:task spec=#N` marker.
3. Get the merge commit: `gh pr view <pr> --json mergeCommit --jq .mergeCommit.oid`.

Done when the PR is merged, the label is `jstack:landed`, and the checkbox is ticked.

## 5. Deploy watch

No `ship.deploy_workflow`: leave `jstack:landed` and tell the human plainly: landed, not deployed, and jstack is not tracking a deploy. Stop.

Otherwise, with `<sha>` the merge commit on the default branch:

1. Find the run: `gh run list --workflow "<deploy_workflow>" --commit <sha> --json databaseId,status,conclusion`. If none, wait and retry for up to about 5 minutes.
2. Watch it: `gh run watch <id> --exit-status`.
3. Success: `gh issue edit <task> --remove-label jstack:landed --add-label jstack:deployed`, then `gh issue close <task>`.
4. Run failed, or none appeared in time: `gh issue edit <task> --remove-label jstack:landed --add-label jstack:blocked`, and post the contract's blocked comment (`phase=ship`) with the run URL, what you tried, and the decision the human needs to make (fix forward, revert, or rerun).
5. If the PR carries a `jstack:automerge` comment and the run failed, also open the contract's revert PR: branch `jstack/<task>-revert` from the default branch, `git revert --no-edit <merge commit>`, push, `gh pr create` with the revert marker. Name it in the blocked comment as the ready-made revert option. Never merge it yourself.

Done when the task is `jstack:deployed` and closed, or `jstack:blocked` with the comment posted.

## 6. Close the spec

After a task is deployed, read the spec's `## Tasks` list. If every task is deployed (closed), close the spec issue: `gh issue close <spec>`.

Done when the spec is closed, or you have confirmed some tasks remain.
