# jstack

jstack is a software factory packaged as a Claude Code plugin: agents build software for any target repo, while a human keeps judgment at the gates that matter.

## The factory

**Factory**:
The whole system of harnessed loops, fed by a work queue and drained through gates into the target repo.
_Avoid_: Pipeline, platform, agent

**Target repo**:
Any repository the factory works on. It knows nothing about jstack except its project config.
_Avoid_: Project, app, client repo

**Project config**:
The target repo's declaration of its own specifics (setup and check commands, protected paths, rubric, autonomy modes, model overrides), read from the default branch. The only place stack knowledge lives.
_Avoid_: Settings, manifest

**Harness**:
Everything around a loop that bounds it: sandbox, allowed tools, inputs, limits, and the conditions that define done.
_Avoid_: Wrapper, runtime

## The flow

**Phase**:
One of the six parts of the factory cycle: Intent, Shape, Implement, Prove, Ship, Learn.
_Avoid_: Stage, step

**Intent**:
A confirmed statement of what a human wants the target repo to gain, reached by interviewing them until both sides share an understanding.
_Avoid_: Idea, request

**Shape**:
The phase that turns an intent into a spec and decomposes it into tasks.
_Avoid_: Planning, grooming

**Implement**:
The phase that produces the change for one task, test-first, until its own checks pass.
_Avoid_: Make, build, code

**Prove**:
The phase that establishes, independently of the author, whether a task's change is right.
_Avoid_: Test, verify, QA

**Ship**:
The phase where an approved change lands on the default branch and is deployed to production.
_Avoid_: Release, merge, done

**Learn**:
The phase that turns what happened after shipping into new intent.
_Avoid_: Monitoring, feedback

## Work

**Spec**:
A description of a desired outcome, agreed with the human, from which tasks are cut.
_Avoid_: PRD, requirements, feature request

**Task**:
A vertical slice of a spec that delivers working, testable functionality and moves through Implement, Prove and Ship on its own.
_Avoid_: Ticket, slice, story, sub-issue

**Plan**:
A short, human-approvable description of how one task will be implemented: goal, files, tests first, numbered steps, risks, out of scope.
_Avoid_: Design, approach

## Gates

**Gate**:
A point a task cannot pass until it clears. Every gate runs checks, and a lit gate also needs approval.
_Avoid_: Checkpoint, stage

**Check**:
A verification run by a machine whose result does not depend on who wrote the change.
_Avoid_: Test, validation

**Approval**:
A human clearing a gate.
_Avoid_: Sign-off, review

**Review**:
An agent's judgment of a change against the spec and the standards, posted on the PR. Never implies a human read it.
_Avoid_: Approval, code review

**Verifier**:
An agent that did not write the change and runs it the way a user would, giving a verdict that expires when the change does.
_Avoid_: Tester, QA

**Two-way door**:
A change that a plain revert fully undoes, whose effects nothing outside the repo has observed or stored.

**One-way door**:
Any change that is not clearly a two-way door. Doubt makes a change one-way.
_Avoid_: Risky change, breaking change

**Auto-merge**:
A merge cleared by the auto-merge script instead of a human, allowed only for two-way doors in repos that grant it.
_Avoid_: Automerge, self-merge

**Landed**:
A task whose change is merged to the default branch but not yet deployed.

**Deployed**:
A task whose change is running in production. The end of Ship.
_Avoid_: Shipped, released, live

**Blocked**:
A task a machine cannot move forward, waiting for a human to decide what happens next.
_Avoid_: Stuck, failed

## Autonomy

**Lit**:
Autonomy mode where a human reviews the loop's input or output before work moves on.
_Avoid_: Manual, supervised

**Dark**:
Autonomy mode where a loop's output moves on verified only by checks, with no human reading it.
_Avoid_: Autonomous, unattended, lights-out

**Promotion**:
Moving a loop from lit to dark, granted in the repo's config, and only when its checks are cheap, fast, consistent and hard to game.
_Avoid_: Automation, graduation

**Back pressure**:
The rule that a loop gets only as much autonomy as its output can be cheaply and reliably verified.

**Comprehension debt**:
The gap between how much code exists in the target repo and how much of it a human understands.
_Avoid_: Tech debt
