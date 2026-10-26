# jstack holds no stack knowledge; the target repo declares it

jstack must work on any target repo without changes. Everything specific to a stack (the checks Prove runs, protected paths, review rubric, autonomy modes, model overrides) lives in the target repo's `.jstack/config.yml`, which jstack reads. Hook and gate scripts are written in Node, and run commands with POSIX sh semantics, so the same gates run on Windows and Linux CI. The config is read from the default branch, so a change cannot weaken its own checks.
