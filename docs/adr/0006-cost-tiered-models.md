# Models are tiered by how much judgment each role needs

To control cost, each role defaults to the cheapest model that can do it well: Opus for planning tasks in Shape (small output, highest leverage), Sonnet for Make and for review in Prove, Haiku for mechanical work (labels, GitHub operations), and no model at all for running checks in Prove, which is a script. Turning intent into a spec runs in the human's own session. The project config can override any role, and usage is logged per loop so cost stays visible.
