---
name: intent
description: Interview the human until an idea becomes a confirmed statement of intent, filed as a GitHub issue.
disable-model-invocation: true
argument-hint: "[rough idea]"
---

# Intent

Turn a rough idea into a **confirmed intent**: a statement of what the target repo should gain, which the human has explicitly confirmed. The intent is the only output. Shape and later phases consume it to produce specs, tasks, plans and code.

The rough idea is: $ARGUMENTS

## 1. Ground yourself

Read the target repo before asking anything: `README`, `GLOSSARY.md`, `docs/adr/`, and the open intents (`gh issue list --label jstack:intent`). If an open intent already covers this idea, show it and ask whether to refine that one instead of filing a new one.

Facts are your job: anything the repo, its docs or `gh` can answer, look up yourself. Decisions are the human's.

Done when you can name what the repo does today in the area the idea touches.

## 2. Interview

Interview the human in rounds until every field of the intent below is settled. Each round asks the whole **frontier**: every open question whose prerequisites are already answered. Number each question, give your recommended answer, and word it so "yes" accepts the recommendation. Wait for answers, then recompute the frontier.

Use the glossary's terms. When the human uses a fuzzy or conflicting term, name the conflict and propose the precise one. Probe with concrete scenarios to find where the boundary sits ("a user does X while Y: in or out?").

Stay at the level of outcomes. When an answer drifts into how to build it, record it as a constraint only if the human insists on it, and otherwise leave it for Shape.

Done when the frontier is empty: every field has an answer the human gave or accepted, and nothing is silently assumed.

## 3. Confirm

Fill the template and show it to the human in full. Every section is non-empty; write `None` where the human has said there is nothing.

```md
## Outcome
<one or two sentences: what the target repo gains, observable from outside the code>

## Why
<the problem or opportunity behind it>

## Who benefits
<the people or systems affected>

## Success signals
- <observable evidence that the outcome was reached>

## In scope
- <...>

## Out of scope
- <...>

## Constraints
- <limits the solution must respect>

## Known unknowns
- <open questions handed to Shape>
```

Done only when the human replies with an explicit confirmation of this exact text. Any change, however small, means revise and show the full text again.

## 4. File

Make sure the label exists, then file the issue with the confirmed text as its body, unchanged:

```sh
gh label create jstack:intent --color 5319E7 --description "Confirmed intent" --force
gh issue create --label jstack:intent --title "<outcome, under 70 characters>" --body-file <file with the confirmed text>
```

Done when the issue exists. Reply with its URL.
