# jstack

A stack-agnostic Claude Code plugin that runs a **lit-by-default software factory**: intake → plan → build → verify → review, driven by GitHub Issues, with human gates at plan approval and merge.

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
