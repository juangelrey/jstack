# Fix a FAIL verdict

The newest verdict's Findings (`github.mjs verdict --pr <pr> --task <task>`) are the whole work list.

1. **Worktree**: reuse `<repo root>/../<repo>-jstack-<task>`, or recreate it on the PR's branch (`git fetch origin <headRefName>`, `git worktree add <path> <headRefName>`). Then `git -C <worktree> pull --ff-only`: Prove may have updated the branch from trunk.
2. **Fix**: per finding, a failing test where testable, the fix, a commit per the contract. A finding repeated from an earlier verdict, or one that needs a decision, blocks.
3. **Check**: Build's self-check (build.md, step 3).
4. **Push** to the same branch and move `implementing → proving`.

Done when the fixes are pushed, checks pass, and the state is `proving`. Reply with the PR URL and `/jstack:prove #<task>`.
