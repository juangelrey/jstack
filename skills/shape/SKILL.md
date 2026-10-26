---
name: shape
description: Turn a confirmed intent into a spec and a dependency-ordered list of small vertical tasks, filed as GitHub issues.
disable-model-invocation: true
argument-hint: "#<intent issue>"
model: opus
---

# Shape

Turn one **confirmed intent** into a **spec** and a list of **tasks**, each a vertical slice, filed once the human approves the full list. Read `<jstack root>/reference/contract.md` first (`<jstack root>` is two directories above this skill's base directory).

The intent issue is: $ARGUMENTS

## 1. Read the inputs

`gh issue view <N> --json number,title,body,labels,state,author`. Accept an open `jstack:intent` issue whose author passes `github.mjs trusted --user <login>`; otherwise say what the input must be.

If a trusted spec carrying `jstack:spec intent=#<N>` exists (`gh issue list --label jstack:spec --state all --search "jstack:spec intent=#<N>"`), or the intent was reopened, follow [resume.md](resume.md) instead.

Read `config.mjs`, then the repo at the trunk: `README`, `GLOSSARY.md`, `docs/adr/`, and the code the intent touches. Facts are your job; decisions are the human's.

Done when you can name where each `In scope` item would land, and have an answer or a recorded question for every `Known unknowns` item.

## 2. Write the spec

The behaviors users and systems will observe, the edge cases that matter, and how each `Success signal` becomes observable, in the glossary's terms. File names, libraries and internal design belong to Implement's plans, unless an intent constraint demands them.

Done when every `In scope` item maps to a behavior and nothing falls under `Out of scope`.

## 3. Decompose into tasks

Cut the spec into **vertical slices**, each with title (outcome-shaped, under 70 characters), description, acceptance criteria, verification steps, dependencies, and size `XS`, `S` or `M`. Order by dependency. Split an `L`, unless the human explicitly keeps it (`--allow-l`). Validate each body with `validate.mjs task`.

Slicing guide:

- A slice cuts through every layer it needs (UI, logic, storage) to deliver one behavior someone could use or test, and could ship alone leaving the system working.
- Many thin slices: the simplest end-to-end path first, then widen it.
- Too big: more than about five criteria, behaviors joined by "and", a plan over `limits.max_plan_steps` steps, a size you cannot defend as `M`.
- Horizontal layers ("the DB layer", "the API") deliver nothing testable: reshape them into slices.
- Risky unknowns go in the earliest slice that exercises them.
- A criterion needing credentials or an external service becomes a human verification step; say so in the task's Verification steps.

Done when the first task is demoable alone, each criterion is checkable without reading the code, and every task validates.

## 4. Confirm

Show the full spec and every field of every task. Any change means revise, validate, and show it all again.

Done only when the human explicitly confirms the list as last shown.

## 5. File

1. `github.mjs labels`.
2. The spec issue (`jstack:spec`, title `Spec: <outcome>`) with an empty `## Tasks` (`validate.mjs spec --draft`).
3. The tasks in list order, label `<prefix>: ready`, each carrying `spec=#<spec>` and its dependencies' real numbers (`validate.mjs task --known <created numbers>`).
4. Each task as a sub-issue; the API takes the id, not the number:

   ```sh
   id=$(gh api repos/{owner}/{repo}/issues/<task> --jq .id)
   gh api repos/{owner}/{repo}/issues/<spec>/sub_issues -F sub_issue_id=$id
   ```

5. The spec's `## Tasks`, filled in order (`validate.mjs spec`).
6. Close the intent: `gh issue close <N> --reason completed --comment "Shaped into #<spec>"`.

Done when `gh api repos/{owner}/{repo}/issues/<spec>/sub_issues` returns every task, each reports `ready` from `github.mjs state`, and the intent is closed. Reply with the spec URL, the tasks (`#number title, size`) and `/jstack:implement #<first task>`.
