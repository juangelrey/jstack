# GitHub Issues is the work queue and labels are the state machine

All workflow artifacts live in GitHub: a spec is a parent issue, tasks are its sub-issues, a plan is a comment on the task issue, and review happens on the PR. Issue state is a fixed graph of `jstack:*` labels (draft → ready → planned → approved → building → in-review → closed, plus blocked), and each loop may only move an issue along an allowed edge. This makes control flow explicit and auditable, and gives GitHub Actions a natural trigger later. The cost is lock-in to GitHub. Only ADRs and the glossary live as repo files.
