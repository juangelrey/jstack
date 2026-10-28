# jstack

A stack-agnostic Claude Code plugin that runs a **lit-by-default software factory**: Intent → Shape → Implement → Prove → Ship, driven by GitHub Issues, with human gates at intent, task list, plan and merge.

Built as a learning project.

Status: v0, all phase skills drafted, not yet run end to end.

## How it works

| Command | Phase | Input | Output |
|---|---|---|---|
| `/jstack:intent <idea>` | Intent | a rough idea | intent issue, after you confirm it |
| `/jstack:shape #<intent>` | Shape | intent issue | spec issue + task sub-issues, after you confirm the list |
| `/jstack:implement #<task>` | Implement | task issue | plan comment; after you add `state: approved` (or the charter clears it), a PR built test-first |
| `/jstack:prove #<task>` | Prove | task + PR | verdict comment from checks, reviewer, verifier and security reviewer |
| `/jstack:ship #<task>` | Ship | proven PR | merged after you say "merge", then deployed |

Run each command in a fresh session (`/clear` between phases). A repo can grant auto-merge of two-way-door PRs; Prove then merges eligible PRs itself.

## Set up a target repo

Merge a `.jstack/config.yml` to the default branch first: phases read it from there, and with no `checks` every task blocks. Minimal example:

```yaml
version: 1
setup:
  - npm ci
checks:
  - npm test
labels:
  prefix: state   # task labels read "state: approved"; rename to fit your repo
autonomy:
  plan: lit       # dark: plans that fit the charter build without your approval
```

`node scripts/config.mjs` prints every key with its default.

Every interface between phases (labels, artifact formats, gates, config) is defined in [`reference/contract.md`](reference/contract.md).

## Requirements

- `gh`, logged in with write access to the target repo
- Node 18+
- On Windows, Git Bash
- **Signed commits**: jstack commits without prompting, so your signing key must already be unlocked (`ssh-add` for SSH, a running gpg-agent for GPG). If it isn't, the task blocks and asks you to load it.

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
