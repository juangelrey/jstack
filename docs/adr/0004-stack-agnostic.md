# jstack holds no stack knowledge; the target repo declares it

jstack must work on any target repo without changes. Everything specific to a stack (verify commands, protected paths, review rubric, autonomy modes, model overrides) lives in the target repo's `.jstack/config.yml`, which jstack reads. Hook scripts are written in Node so the same gates run on Windows and Linux CI.
