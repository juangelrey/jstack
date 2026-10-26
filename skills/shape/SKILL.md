---
name: shape
description: Turn a confirmed intent into a spec and a dependency-ordered list of small vertical tasks, filed as GitHub issues.
disable-model-invocation: true
argument-hint: "#<intent issue>"
model: opus
---

# Shape

Turn one **confirmed intent** into a **spec** and a list of **tasks**, each a vertical slice, filed as GitHub issues once the human approves the full task list. Shape reads `reference/contract.md` in the jstack root (two directories above this skill's base directory) for every label, artifact format and gate; follow it exactly.

The intent issue is: $ARGUMENTS

## 1. Read the inputs

Read the contract. Then `gh issue view <N> --json number,title,body,labels,state`. Accept only an open issue labelled `jstack:intent`. For anything else (no argument, a task, a spec, a closed intent), stop and say what the input must be.

Read the target repo: `README`, `GLOSSARY.md`, `docs/adr/`, `.jstack/config.yml`, and the code areas the intent touches. Facts are your job: look up anything the repo or `gh` can answer. Decisions are the human's.

Done when you can name where in the repo each `In scope` item would land and have an answer, or a recorded question for the human, for every `Known unknowns` item.

## 2. Write the spec

Describe what the system will do, at behavior level, in the glossary's terms: the behaviors users and systems will observe, the edge cases that matter, and how each `Success signal` becomes observable. Leave file names, libraries and internal design to Implement's plans, unless an intent constraint demands them.

Done when every `In scope` item maps to a described behavior and nothing in the spec falls under `Out of scope`.

## 3. Decompose into tasks

Cut the spec into **vertical slices** (see the guide below). Give each task:

- **Title**: outcome-shaped, under 70 characters
- **Description**: what the slice delivers, end to end
- **Acceptance criteria**: observable, testable statements
- **Verification steps**: how a person or the verifier confirms it as a user would
- **Dependencies**: earlier tasks it needs, or `None`
- **Size**: `XS`, `S` or `M`

Order the list by dependency. A task of size `L` gets split, unless the human explicitly asks to keep it.

Done when the first task is demoable alone, no task is `L` without the human's say-so, and each acceptance criterion is checkable without reading the code.

### Slicing guide

- A good slice cuts through every layer it needs (UI, logic, storage) to deliver one behavior someone could use or test.
- Prefer many thin slices over few thick ones. Build the simplest end-to-end path first, then widen it.
- Ask of every task: could it ship alone and leave the system working? If not, it is a layer or a fragment.
- Too big: more than about five acceptance criteria, several unrelated behaviors joined by "and", a plan that would exceed 10 steps, or a size you cannot defend as `M`.
- Avoid horizontal layers ("build the DB layer", "add the API", "wire up the UI"). Each delivers nothing testable and defers integration risk to the end.
- Put risky unknowns in the earliest slice that exercises them.

## 4. Confirm

Show the human the full spec and the full task list, every field of every task. Wait for an explicit confirmation of this exact list. Any change, however small, means revise and show the full spec and list again.

Done only when the human replies with an explicit confirmation of the list as last shown.

## 5. File

Write bodies to temp files in the contract's formats, then:

1. Create the `jstack:spec` and `jstack:ready` labels with the colors and meanings from the contract's label table.
2. Create the spec issue (`jstack:spec`, title `Spec: <outcome>`) with an empty `## Tasks` section, to get its number.
3. Create the task issues one at a time in list order, label `jstack:ready`, each body carrying `spec=#<spec number>` and `#<number>` for each dependency, using the numbers of the tasks already created.
4. Link each task as a sub-issue of the spec. The API takes the task's id, which is different from its number:

```sh
id=$(gh api repos/{owner}/{repo}/issues/<task> --jq .id)
gh api repos/{owner}/{repo}/issues/<spec>/sub_issues -F sub_issue_id=$id
```

5. Edit the spec body so `## Tasks` lists `- [ ] #<task> <title>` for every task, in order.
6. Close the intent as the contract describes.

Done when `gh api repos/{owner}/{repo}/issues/<spec>/sub_issues` returns every task, each task carries exactly one label (`jstack:ready`), and the intent is closed.

Reply with the spec URL and the task list (`#number title, size`).
