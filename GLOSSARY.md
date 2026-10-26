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
The target repo's declaration of its own specifics (verify commands, protected paths, rubric, autonomy modes, model overrides). The only place stack knowledge lives.
_Avoid_: Settings, manifest

**Harness**:
Everything around a loop that bounds it: sandbox, allowed tools, inputs, limits, and the conditions that define done.
_Avoid_: Wrapper, runtime

## The flow

**Phase**:
One of the six parts of the factory cycle: Intent, Shape, Make, Prove, Ship, Learn.
_Avoid_: Stage, step

**Intent**:
What a human wants the target repo to gain, stated before anything is shaped.
_Avoid_: Idea, request

**Shape**:
The phase that turns an intent into a spec and splits it into tasks.
_Avoid_: Planning, grooming

**Make**:
The phase that produces the change for one task.
_Avoid_: Build, implement

**Prove**:
The phase that establishes whether a task's change is right.
_Avoid_: Test, verify, QA

**Ship**:
The phase where an approved change enters the target repo.
_Avoid_: Deploy, release, merge

**Learn**:
The phase that turns what happened after shipping into new intent.
_Avoid_: Monitoring, feedback

## Work

**Spec**:
A description of a desired outcome, agreed with the human, from which tasks are cut.
_Avoid_: PRD, requirements, feature request

**Task**:
One piece of a spec that moves through Make, Prove and Ship on its own.
_Avoid_: Ticket, slice, story, sub-issue

**Plan**:
A short, human-approvable description of how one task will be built: goal, files, tests first, numbered steps, risks, out of scope.
_Avoid_: Design, approach

## Autonomy

**Lit**:
Autonomy mode where a human reviews the loop's input or output before work moves on.
_Avoid_: Manual, supervised

**Dark**:
Autonomy mode where a loop's output moves on verified only by checks, with no human reading it.
_Avoid_: Autonomous, unattended, lights-out

**Promotion**:
Moving a loop from lit to dark, justified in an ADR showing its checks are cheap, fast, consistent and hard to game.
_Avoid_: Automation, graduation

**Back pressure**:
The rule that a loop gets only as much autonomy as its output can be cheaply and reliably verified.

**Comprehension debt**:
The gap between how much code exists in the target repo and how much of it a human understands.
_Avoid_: Tech debt
