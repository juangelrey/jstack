# Merging

Read by Prove (auto-merge) and Ship.

## Merge

Remove the task's worktree first so its local branch can be deleted, then merge pinned to the proven head:

```sh
git worktree remove <repo root>/../<repo>-jstack-<task>     # --force only if the leftovers are build artifacts
gh pr merge <pr> --squash --delete-branch --match-head-commit <proven sha> --subject "<pr title> (#<pr>)" --body "Task: #<task>"
```

A failure because the head moved sends the task back to `/jstack:prove`.

## Auto-merge

Granted per repo by `autonomy.ship_two_way: dark`. Only the script decides; its `reasons` say why not:

```sh
node <jstack root>/scripts/automerge.mjs --pr <pr> --wait 480
```

Prove runs it after a PASS verdict:

- **Eligible**: post the log comment below, then follow Ship from its Merge step with the proven SHA.
- **Only `behind`**, once per run: `gh pr update-branch <pr>`, then prove the new head.
- **Otherwise**: the human ships with `/jstack:ship`, given the reasons.

```md
<!-- jstack:automerge sha=<proven sha> -->
## Auto-merged
<the script's JSON output>
```

## Revert after a failed auto-merged deploy

Ship opens a revert PR for the human; it is never auto-merged or proved by jstack. Use its own worktree so the human's checkout stays untouched:

```sh
git fetch origin <default>
git worktree add <repo root>/../<repo>-jstack-<task>-revert -b jstack/<task>-revert origin/<default>
timeout 60 git -C <worktree> revert --no-edit <merge commit>
git -C <worktree> push -u origin jstack/<task>-revert
gh pr create --head jstack/<task>-revert --title "Revert: <task title>" --body-file <body>
git worktree remove <worktree>
```

Body:

```md
<!-- jstack:revert task=#<task> -->
Task: #<task>

## Summary
Reverts <merge commit>; deploy run <url> failed.

## Merge danger
one-way door: reverts a change that may already have been observed
```

If the revert conflicts: `git revert --abort`, remove the worktree, and say so in the blocked comment. Otherwise name the revert PR there as the ready-made option.
