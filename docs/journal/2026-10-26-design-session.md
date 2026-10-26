# 2026-10-26: Design session

Read Addy Osmani's "Software Factories, Light and Dark", then grilled the design.

## Decided
- Goal: learning first, a usable factory as a side effect. The human drives, Claude explains, drafts and reviews.
- jstack is the product; target repos are interchangeable test beds.
- Architecture decisions: ADR-0001 to ADR-0006.
- Easy to reverse, so no ADR:
  - Loops: intake → plan → build → verify → review → merge (human).
  - Tasks are vertical slices: plan ≤ 10 steps and ≤ ~200 lines, PR small (target < 400 lines changed).
  - Plan contains goal, files, tests first, numbered steps, risks, out of scope.
  - Build uses TDD and one worktree + branch + PR per task. Up to 3 retries, then `blocked`.
  - Review: read-only reviewer agent with a spec + standards rubric (generic from jstack, project rubric from config). Only the human merges.
  - v1 is serial (one task at a time), local, installed from a local marketplace. No monitoring loop yet.
  - `/jstack:init` onboards a target repo (config, labels, issue template).
  - Skills get evals once stable after manual use.
- v1 is done when one feature goes idea → merged PR through every loop, all lit, on any target repo.

## Done
- Repo created, `main` protected (PR required, squash only, linear history, no force push/deletion, no bypass).
- Plugin skeleton + local marketplace (#1), glossary (#2).

## Lessons
- Opened a second PR while the first was open, which broke the serial rule. One PR at a time.
- A plugin installed from a local marketplace reads the working copy, so switching branches can break it.

## Open
- Glossary terms deferred until the loops are shaped: Loop/Step, Task, Check/Gate/Approval, Review vs Approval, Blocked, what happens when review fails.

## Update: flow and naming
- Zoomed out to define the factory flow first: Intent → Shape → Make → Prove → Ship → Learn (ADR-0007).
- Phase names replace the earlier loop names: intake + plan are part of Shape, build is Make, verify + review are Prove, merge is Ship. The names above reflect the earlier draft.
- Skipped the manual walkthrough and the init milestone; went straight to designing the factory lifecycle.

## Update: phases defined
- Researched where "ship" ends for Osmani, Matt Pocock, Lauren Tan, Theo and Rob Shocks. Tool authors (Matt, Lauren) stop at merge; whole-factory views (Osmani, Rob, Theo) go to running in production with rollback.
- Ship ends at deployed to production. Post-deploy confirmation and rollback wait until the target has feature flags.
- Make renamed to Implement. Prove gains an independent verifier (from Lauren Tan's pstack) and a security sub-skill; Implement gains a refactor sub-skill.
- Four human gates: intent, task list, plan, merge. Every gate runs checks; a human is added on top, never instead.
- Lesson: Avast WebShield blocked api.anthropic.com mid-run and killed four research subagents. Fixed with an exception.

## Update: all phase skills drafted
- Wrote `reference/contract.md` first as the single interface, then four subagents built the phases in parallel against it.
- Each builder reported contract gaps (filing order, PR lookup, default branch, head moving during Prove...). All were folded back into the contract, so it is the one place those rules live.
- Integration bugs found in review: `Closes #N` in the PR would close the task at merge, before deploy. Three different PR lookups. Subagents never received the plugin root. The security reviewer had no Skill tool to load the security skill.
- Lesson: parallel builders against a shared contract work, but the contract only becomes complete through their gap reports.

## Update: auto-merge for two-way doors
- Researched auto-merge: the people who teach agentic workflows (Osmani, Matt, Theo) keep a human on every merge. Those running factories in production (Lauren Tan, Vercel, PostHog) auto-merge, behind an explicit grant, an independent verdict on the current head, paths that always need a human, and a size limit. Nobody trusts the author's own risk rating.
- ADR-0008: the reviewer rates the door as a challenger, and doubt means one-way. A deterministic script decides eligibility and fails closed. The repo opts in. A failed deploy after an auto-merge opens a revert PR.
- Lesson: a test caught a fail-open bug in the guard script, where an empty "behind trunk" answer was read as 0, meaning up to date. Guards need tests on the unknown cases, not just the yes/no ones.
