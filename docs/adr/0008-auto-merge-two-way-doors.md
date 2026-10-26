# Two-way-door PRs may merge without a human, behind deterministic guards

The merge gate goes dark for one class of change: a PR both the author and the independent reviewer rate as a two-way door. The reviewer acts as a challenger, starting from one-way, and any doubt makes it one-way. A deterministic script (`scripts/automerge.mjs`) decides eligibility, so no model can argue past it. All of the following must hold:
- the repo has granted it (`autonomy.ship_two_way: dark`)
- the newest verdict is PASS, for the current head
- the PR touches no human-only path (built-in list plus `protected_paths` and `human_paths`)
- the diff is within `autonomy.max_lines` (default 200)
- the branch is up to date with trunk
- every GitHub check is green
Anything the script cannot evaluate fails closed. A failed deploy after an auto-merge opens a revert PR and blocks the task, and the human decides whether to merge the revert.

Considered: the people who teach agentic workflows (Osmani, Pocock, Theo) keep a human on every merge. The people who run factories in production (Lauren Tan's pstack, Vercel, PostHog) auto-merge, using the same guards: an explicit grant, an independent verdict on the current head, paths that always need a human, and a size limit. None of them trusts the author's own risk rating. This ADR adopts those guards and keeps the default lit (ADR-0003).
