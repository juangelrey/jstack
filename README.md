# jstack

A stack-agnostic Claude Code plugin that runs a **lit-by-default software factory**: intake → plan → build → verify → review, driven by GitHub Issues, with human gates at plan approval and merge.

Built as a learning project. See `docs/adr/` for decisions and `docs/journal/` for lessons.

Status: v0, bootstrapping.

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
