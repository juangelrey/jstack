# Plan

1. **Dependencies**: each task under `dependencies` reports `landed` or `deployed` from `github.mjs state`. Otherwise stop and name it.

2. **Draft**: dispatch `jstack:planner` with the task number and `<jstack root>`. Write its plan to a file and validate:

   ```sh
   gh issue view <task> --json body --jq .body > <task file>
   node <jstack root>/scripts/validate.mjs plan --file <plan file> --max-steps <limits.max_plan_steps> --task-file <task file>
   ```

   On errors, send them back to the planner once; a second failure blocks.

3. **Post**: `gh issue comment <task> --body-file <plan file>`. A first plan then moves `ready → planned`; a re-plan stays `planned`.

4. **Charter**: `github.mjs state --task <task>`. `approved` means the charter cleared the plan: continue with [build.md](build.md) in this run.

Done when the plan is posted and the state is `planned` or `approved`. If `planned`, tell the human to review it, then comment feedback and rerun `/jstack:implement #<task>`, or add `<prefix>: approved` on GitHub; quote `charter.reasons` when present, so they know why it needs them.
