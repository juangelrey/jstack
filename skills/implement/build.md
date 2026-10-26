# Build

The plan is `github.mjs plan --task <task>`; follow it.

## 1. Set up

- **Serial**: `github.mjs openprs` lists open jstack PRs. If `limits.max_open_prs` of them belong to other tasks, stop and name them: they ship first.
- **State**: from `approved`, move to `implementing`.
- **Worktree** at `<repo root>/../<repo>-jstack-<task>`, from a fresh trunk:

  ```sh
  git fetch origin <default>
  git worktree add <path> -b jstack/<task>-<slug> origin/<default>
  ```

  Resuming: reuse the worktree, or add one on the existing branch, and continue from the first plan step not yet in `git log origin/<default>..HEAD`.
- **Baseline**: `node <jstack root>/scripts/checks.mjs --cwd <worktree>`. Red on the untouched trunk blocks: trunk must be green first.

Done when the worktree is on its branch and the baseline is green.

## 2. Test first

Per plan step, one acceptance criterion at a time:

1. **Red**: write the test from "Tests first". Watch it fail for the right reason.
2. **Green**: the least code that passes it.
3. **Commit** the step: message validated with `validate.mjs commit-msg`, committed per the contract.
4. **Refactor**: invoke `jstack:refactor` on the code this step touched.

Test through public interfaces. Add a design pattern only to remove duplication or branching already there. Code touching auth, input, secrets, dependencies, or file or network access follows `jstack:security`; its Ask-first items block.

Stay inside the plan and outside `.jstack/**` and `protected_paths`. A plan that proves wrong, or needs a protected path, blocks.

Done when every acceptance criterion has a test that failed first and passes now.

## 3. Self-check

`node <jstack root>/scripts/checks.mjs --cwd <worktree>`. Fix the cause from `outputTail` and rerun, up to `limits.max_retries` times; then block. These checks only tell you when to stop; Prove does the proving.

## 4. Open the PR

Body in the contract's PR format: Evidence is real output per criterion, Merge danger per the one-way door definition.

```sh
node <jstack root>/scripts/validate.mjs pr --file <body> --task <task> --title "<task title>"
git push -u origin jstack/<task>-<slug>
gh pr create --base <default> --head jstack/<task>-<slug> --title "<task title>" --body-file <body>
```

Move `implementing → proving`.

Done when the PR is open and the state is `proving`. Reply with the PR URL and `/jstack:prove #<task>`.
