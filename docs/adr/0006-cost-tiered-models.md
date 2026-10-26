# Models are tiered by how much judgment each role needs

To control cost, each role defaults to the cheapest model that can do it well: Opus for Shape and for per-task plans (small output, highest leverage), Sonnet for Implement and for review and verification in Prove, Haiku for mechanical work (labels, GitHub operations), and no model at all for running checks, which is a script. The Intent interview runs in the human's own session. The project config can override any role, and usage is logged per phase so cost stays visible.
