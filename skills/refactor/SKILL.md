---
name: refactor
description: Simplify code without changing behavior. Use after a green test passes, when code you touched is duplicated, tangled or hard to read, or before deleting or rewriting code you do not understand.
---

# Refactor

A refactor changes structure, never behavior. If behavior must change, that is a separate step with its own test.

## Rules

1. **Scope**: only code the current task touches. Note other mess; do not fix it.
2. **Green before, green after**: run the full checks (`node <jstack root>/scripts/checks.mjs --cwd <worktree>`) before starting and after the last move. After each move in between, run the tests that cover the touched code. If a move turns them red, revert that move; do not debug forward. If checks were red before you began, stop and fix or report that first.
3. **One move at a time**: rename, extract, inline, move, delete dead code. Each is its own commit, separate from the red-green commit before it, following the contract's commit rules.
4. **Same behavior**: same outputs, errors, side effects and public interfaces. Tests that assert behavior stay untouched; if one must change, you changed behavior.

## Chesterton's Fence

Do not remove or rewrite code until you can say why it exists. Odd guards, special cases and workarounds usually mark a past bug.

- `git blame` the lines, read the commit and linked issue.
- Search for tests and callers (`grep` the symbol).
- If nothing explains it and no test covers it, leave it and say so in the PR Summary.

## What to simplify

- Duplicated logic: extract once it appears three times, or twice when the copies must change together.
- Deep nesting and long conditionals: guard clauses, early returns, named predicates.
- Shallow wrappers and pass-through layers that add no behavior: inline.
- Dead code and unused parameters: delete, after the fence check.
- Names that hide intent: rename to the glossary's terms.
- A design pattern only if it replaces branching or duplication already present.

## Rule of 500

If a change would touch more than about 500 lines, do not hand-edit it. Write a codemod or script (AST tool, `sed`, a throwaway node script), review its diff by sampling, and run the checks. If no mechanical transformation exists, split it into separate commits that are each green. Never mix a mass mechanical edit with a behavior change.

## Done when

Checks pass, the diff touches only task code, and every removed line had a reason you can state.
