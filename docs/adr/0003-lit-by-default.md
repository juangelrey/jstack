# Every phase is lit by default; going dark requires an ADR

Each phase's autonomy mode is declared in the project config and defaults to lit: a human confirms intent, approves task lists and plans, and is the only one who merges. A phase is promoted to dark only through an ADR showing its checks are cheap, fast, consistent and hard to game. Dark never means unverified: every gate runs checks in both modes, and a human is added on top of the checks, never in place of them. This is back pressure applied by policy, to avoid comprehension debt building up behind green tests.
