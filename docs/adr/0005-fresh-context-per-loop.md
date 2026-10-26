# Each loop starts with a fresh context; handoffs go only through artifacts

A loop never relies on chat memory from an earlier loop. It reads its inputs from GitHub (issue body, plan comment, PR) and writes its outputs back there. This keeps loops within the 3 to 10 steps where agents stay reliable, makes runs reproducible, and proves the artifacts are complete enough to hand off.
