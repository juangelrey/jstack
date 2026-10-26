# Models are tiered by how much judgment each role needs

To control cost, each role defaults to the cheapest model that can do it well: Opus for planning (small output, highest leverage), Sonnet for building and review, Haiku for mechanical work (init, labels, GitHub operations), and no model at all for verify, which is a script. Intake runs in the human's own session. The project config can override any role, and usage is logged per loop so cost stays visible.
