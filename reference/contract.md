# jstack contract

The single source of truth for how phases hand work to each other. Every phase skill reads this before acting. A phase reads only the artifacts listed as its inputs and writes only those listed as its outputs. Chat memory from an earlier phase never counts as input (ADR-0005).

`<jstack root>` is the plugin's root directory: two directories above any jstack skill's base directory. This file is `<jstack root>/reference/contract.md`, and the checks script is `<jstack root>/scripts/checks.mjs`.
A skill that dispatches a jstack subagent passes it the absolute `<jstack root>` path along with its inputs.

The default branch is `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`. `<repo>` is the name of the target repo's top-level directory (`git rev-parse --show-toplevel`).

## Flow

```
/jstack:intent ──► intent issue
/jstack:shape  ──► spec issue + task sub-issues            (task: jstack:ready)
/jstack:implement #N
   first run   ──► plan comment                            (task: jstack:planned)
   🧑 human adds jstack:approved                             (task: jstack:approved)
   second run  ──► branch + PR                             (task: jstack:implementing → jstack:proving)
/jstack:prove #N ──► verdict comment on the PR
   FAIL        ──► back to Implement                       (task: jstack:implementing)
   PASS        ──► stays                                   (task: jstack:proving)
/jstack:ship #N
   🧑 human approves merge ──► merged                        (task: jstack:landed)
   deploy run green        ──► task closed                 (task: jstack:deployed)
```

Any phase can move a task to `jstack:blocked` instead. Only a human moves it out.

## Labels

Exactly one `jstack:*` state label per task issue. A phase changes it by removing the old label and adding the new one in the same `gh issue edit` call.

| Label | Color | Meaning | Set by |
|---|---|---|---|
| `jstack:intent` | `5319E7` | Confirmed intent (intent issues only) | intent |
| `jstack:spec` | `1D76DB` | Spec parent issue (spec issues only) | shape |
| `jstack:ready` | `C5DEF5` | Task cut and approved as part of a task list, no plan yet | shape |
| `jstack:planned` | `FBCA04` | Plan posted, waiting for human approval | implement |
| `jstack:approved` | `0E8A16` | Plan approved | **human only** |
| `jstack:implementing` | `D93F0B` | Being implemented, or sent back by Prove | implement, prove |
| `jstack:proving` | `BFD4F2` | PR open and under, or through, Prove | implement |
| `jstack:landed` | `C2E0C6` | Merged to the default branch, not yet deployed | ship |
| `jstack:deployed` | `0B6623` | Running in production. Issue closed | ship |
| `jstack:blocked` | `B60205` | A machine cannot move it forward. Human decides | any phase |

Allowed edges, and nothing else:

```
ready → planned → approved → implementing → proving → landed → deployed
proving → implementing        (Prove FAIL)
<any> → blocked
blocked → <any>               (human only)
```

A phase that finds a task in a state it does not accept stops and says which phase the task needs instead.

Create a missing label with `gh label create <name> --force --color <color> --description "<meaning>"`, using the color and meaning from the table.

## Artifacts

All artifacts live in GitHub. Machine-readable parts are marked with HTML comments so later phases can find them with `gh issue view --json body,comments` or `gh pr view --json body,comments`.

### Intent issue
Label `jstack:intent`. Body: the confirmed sections `Outcome`, `Why`, `Who benefits`, `Success signals`, `In scope`, `Out of scope`, `Constraints`, `Known unknowns`.

### Spec issue
Label `jstack:spec`. Title: `Spec: <outcome>`. Body:

```md
<!-- jstack:spec intent=#<intent number> -->
## Spec
<what the system will do, behavior-level, derived from the intent>

## Tasks
- [ ] #<task> <title>
- [ ] #<task> <title>
```

The task list is ordered by dependency. Each task is also linked as a GitHub sub-issue of the spec. Filing order, because the spec and its tasks reference each other: create the spec with an empty Tasks section, create the tasks in dependency order, then edit the spec to fill in the task list. Shape closes the intent issue as completed (`gh issue close <n> --reason completed --comment "Shaped into #<spec>"`).

### Task issue
Label: one state label. Title: the task title. Body:

```md
<!-- jstack:task spec=#<spec number> size=<XS|S|M|L> -->
## Description
<what this slice delivers, end to end>

## Acceptance criteria
- [ ] <observable, testable statement>

## Verification steps
1. <how a person, or the verifier, confirms it works as a user would>

## Dependencies
- #<task> or None
```

A task is a vertical slice: it delivers working, testable functionality on its own. Size L means the task should have been split; Shape splits it, and keeps an L only when the human explicitly asks to.

### Plan comment
Posted on the task issue by Implement. At most `limits.max_plan_steps` steps and roughly 200 lines.

```md
<!-- jstack:plan -->
## Plan
**Goal**: <one sentence>
**Files**: <paths to create or change>
**Tests first**: <tests to write before the code, one per acceptance criterion at least>
**Steps**:
1. <...>
**Risks**: <...>
**Out of scope**: <...>
```

The newest `jstack:plan` comment is the plan. Re-planning posts a new one.

### Branch and PR
Branch `jstack/<task>-<slug>` from the default branch, built in a git worktree at `../<repo>-jstack-<task>`. One PR per task. The body names the task without a closing keyword, so merging does not close it; Ship closes the task once deployed. PR body:

```md
<!-- jstack:pr task=#<task> -->
Task: #<task>

## Summary
<what changed and why>

## Evidence
<test output, screenshots, or command transcripts showing the acceptance criteria hold>

## Merge danger
<two-way door | one-way door>: <blast radius, what breaks if this is wrong>
```

Find a task's PR by its marker: `gh pr list --state all --search "jstack:pr task=#<task>" --json number,body,headRefOid`, keeping the PR whose body contains `<!-- jstack:pr task=#<task> -->`.

A one-way door is a change that a revert does not fully undo: data migrations, deleted data or files others depend on, public API or contract changes, auth, billing, and anything already observed by users or other systems. Everything else is a two-way door.

### Verdict comment
Posted on the PR by Prove. A verdict is valid only for the PR head it names; a new head needs a new verdict.

```md
<!-- jstack:verdict sha=<full head sha> result=<PASS|FAIL> door=<one-way|two-way> -->
## Prove: <PASS|FAIL>
| Gate | Result |
|---|---|
| Checks | PASS/FAIL |
| Review | PASS/FAIL |
| Verifier | PASS/PASS+NOTES/FAIL |
| Security | PASS/FAIL |
| Door (reviewer) | one-way/two-way |

### Findings
- <each blocking finding with file:line and what would fix it>

### Notes
- <non-blocking observations>
```

`result=PASS` only when every gate passes (PASS+NOTES counts as a pass). A gate whose check or subagent errors counts as FAIL. If the PR head moves while Prove runs, Prove posts no verdict and tells the human to rerun.

Phases that need the PR's code check out its head in a detached worktree: `git fetch origin pull/<pr>/head` then `git worktree add --detach <path> FETCH_HEAD`, and remove it when done.

### Blocked comment
The phase that sets `jstack:blocked` posts this on the task issue, naming itself as `phase`:

```md
<!-- jstack:blocked phase=<phase> -->
## Blocked in <phase>
**Why**: <...>
**Tried**: <...>
**Human decision needed**: <the specific choice to make>
```

## Retries

A phase retries inside itself up to `limits.max_retries` times (default 3) before setting `jstack:blocked`. When Implement fixes a FAIL, it works from the newest verdict comment, whatever head it names. Across phases, the number of `result=FAIL` verdict comments on a PR counts as Implement's attempts, including the verdict Prove just posted: when it reaches `limits.max_retries`, Prove sets `jstack:blocked` instead of sending the task back.

## Project config

Optional file `.jstack/config.yml` in the target repo. Missing keys take the defaults shown. Only this YAML subset is supported: top-level keys, string lists, and one level of nested keys with scalar values.

```yaml
version: 1
checks:                     # commands that must all exit 0, run in order from the repo root
  - npm run lint
  - npm run build
  - npm test
protected_paths:            # globs no phase may edit
  - .github/workflows/**
rubric: .jstack/rubric.md   # project review standards, optional
limits:
  max_retries: 3
  max_plan_steps: 10
ship:
  deploy_workflow: Deploy   # name of the GitHub Actions workflow that deploys the default branch. Omit if none
autonomy:
  ship_two_way: lit         # dark grants auto-merge of two-way-door PRs (ADR-0008)
  max_lines: 200            # largest diff (additions + deletions) that may auto-merge
human_paths:                # globs that always need a human merge, on top of protected_paths and the built-in list
  - src/pricing/**
```

Defaults: `checks: []`, `protected_paths: []`, no rubric, `max_retries: 3`, `max_plan_steps: 10`, no deploy workflow, `ship_two_way: lit`, `max_lines: 200`, `human_paths: []`. With no `checks`, the checks gate fails with "no checks declared": every gate runs checks (ADR-0003).

Run the checks with the bundled script, never by hand:

```sh
node <jstack root>/scripts/checks.mjs [--cwd <path>]
```

It prints one JSON object (`{"pass": bool, "results": [{"command", "exitCode", "durationMs", "outputTail"}]}`), exits 0 when every check passes and 1 otherwise. With no checks declared it reports `pass: false` and a single result with command `(none)` and output `no checks declared`. `<jstack root>` is two directories above any jstack skill's base directory.

## Auto-merge

When a repo grants it (`autonomy.ship_two_way: dark`), a PR may merge without a human (ADR-0008). Only this script decides eligibility:

```sh
node <jstack root>/scripts/automerge.mjs --pr <pr>
```

It prints `{"eligible": bool, "behind": bool, "lines": n, "reasons": [...]}` and exits 0 only when eligible. It requires: the grant, the newest verdict PASS for the current head with `door=two-way`, the author's Merge danger starting with `two-way door`, no changed file matching a human-only path (`DEFAULT_HUMAN_PATHS` in the script, plus `protected_paths` and `human_paths`), a diff within `max_lines`, the branch not behind trunk, every GitHub check green, and the PR mergeable. Anything it cannot evaluate makes the PR ineligible.

Prove runs it after posting a PASS verdict. If the only reason is `behind`, Prove updates the branch (`gh pr update-branch <pr>`) and proves the new head, once per run. When eligible, Prove posts the log comment below on the PR and follows Ship from its Merge step:

```md
<!-- jstack:automerge sha=<head sha> -->
## Auto-merged (ADR-0008)
<the script's JSON output>
```

If the deploy of an auto-merged PR fails, Ship opens a revert PR (branch `jstack/<task>-revert`, body starting `<!-- jstack:revert task=#<task> -->`) and blocks the task. A revert PR is never auto-merged.

## Human gates

| Gate | Phase | How the human clears it |
|---|---|---|
| Intent | intent | Explicit confirmation of the full text in chat |
| Task list | shape | Explicit confirmation of the full task list in chat |
| Plan | implement | Adds `jstack:approved` to the task issue on GitHub |
| Merge | ship | Explicit "merge" in chat after seeing the evidence and merge danger. Under ADR-0008, the auto-merge script clears it for eligible two-way doors |

Every gate also runs checks; the human is added on top, never instead.
