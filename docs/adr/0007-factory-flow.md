# The factory flow: Intent → Shape → Implement → Prove → Ship → Learn

The factory is one cycle of six phases. jstack owns Intent through Ship. In v1, Learn is done by hand.

- **Intent**: the human is interviewed until both sides share an understanding. The output is a confirmed statement of intent, filed as a GitHub issue. Specs, tasks and plans are all downstream of it.
- **Shape**: turns the intent into a spec, then decomposes it into small vertical slices. Each slice delivers working, testable functionality. Every task has a title, description, acceptance criteria, verification steps, dependencies and a T-shirt size. The output is a parent issue whose task list links one sub-issue per task.
- **Implement**: per task, posts a short plan for approval, then works test-first (implement → test → self-check → commit) until lint, build and tests pass. A refactor sub-skill reduces complexity while preserving exact behavior.
- **Prove**: independent of the author. Fresh tests, a code review against spec and standards, a verifier that runs the change the way a user would, and a security sub-skill. The author's own checks never count as proof.
- **Ship**: trunk-based. The change lands on the default branch through the target repo's own CI/CD and ends when it is deployed to production. jstack uses that pipeline and never owns it. Post-deploy confirmation and rollback are deferred until the target has feature flags.

Humans sit at four gates: confirming the intent, approving the task list, approving each plan, and merging. Every gate also runs checks; a human is added on top, never instead. Machines retry within a phase; only a human sends work back across a gate.
