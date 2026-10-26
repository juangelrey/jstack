# Every loop is lit by default; going dark requires an ADR

Each loop's autonomy mode is declared in the project config and defaults to lit: a human approves plans and is the only one who merges. A loop is promoted to dark only through an ADR showing its checks are cheap, fast, consistent and hard to game. This is back pressure applied by policy, to avoid comprehension debt building up behind green tests.
