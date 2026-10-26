# jstack

A stack-agnostic Claude Code plugin that runs a **lit-by-default software factory**: Intent → Shape → Implement → Prove → Ship, driven by GitHub Issues, with human gates at intent, task list, plan and merge.

Built as a learning project. See `docs/adr/` for decisions and `docs/journal/` for lessons.

Status: v0, all phase skills drafted, not yet run end to end.

## How it works

| Command | Phase | Input | Output |
|---|---|---|---|
| `/jstack:intent <idea>` | Intent | a rough idea | intent issue, after you confirm it |
| `/jstack:shape #<intent>` | Shape | intent issue | spec issue + task sub-issues, after you confirm the list |
| `/jstack:implement #<task>` | Implement | task issue | plan comment; after you add `jstack:approved`, a PR built test-first |
| `/jstack:prove #<task>` | Prove | task + PR | verdict comment from checks, reviewer, verifier and security reviewer |
| `/jstack:ship #<task>` | Ship | proven PR | merged after you say "merge", then deployed |

Run each command in a fresh session (`/clear` between phases). A repo can grant auto-merge of two-way-door PRs (ADR-0008); Prove then merges eligible PRs itself.

## Set up a target repo

Merge a `.jstack/config.yml` to the default branch first: phases read it from there, and with no `checks` every task blocks. Minimal example:

```yaml
version: 1
setup:
  - npm ci
checks:
  - npm test
```

`node scripts/config.mjs` prints every key with its default. jstack also needs `gh` logged in with write access, Node 18+, and on Windows Git Bash. If your commits are signed, load the key first (for SSH signing, `ssh-add <key>`): jstack never bypasses signing.

Every interface between phases (labels, artifact formats, gates, config) is defined in [`reference/contract.md`](reference/contract.md).

## Install

From GitHub:

```
/plugin install jstack --marketplace juangelrey/jstack
```

Local development (loads the working copy, no install):

```
claude --plugin-dir C:/Dev/jstack
```

Or as a local marketplace:

```
/plugin marketplace add C:/Dev/jstack
/plugin install jstack@jstack
```
