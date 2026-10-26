# jstack is a Claude Code plugin, not an orchestrator app

We build the factory as a Claude Code plugin (skills, subagents, hooks) rather than a standalone app driving the Agent SDK or a workflow framework like LangGraph. Every piece stays readable markdown or a small script, which suits learning, and it maps directly onto loops and harnesses. A scripted orchestrator may come later, but only for loops promoted to dark.
