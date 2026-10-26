# Resume or reshape

Pick the case, show the human what exists, then rejoin the main steps.

- **Open spec**: an earlier filing stopped midway. Keep the spec and its confirmed list, and redo step 5, reusing each task already filed (a trusted open issue with the same title and `jstack:task spec=#<spec>`) and linking only what is unlinked.
- **Closed intent, nothing reopened**: already shaped. Name its spec and stop. To reshape, the human reopens the intent.
- **Reopened intent with a closed spec**: a reshape. Run steps 1 to 5 anew. After filing, close the old spec's tasks still `ready` or `planned`: `gh issue close <t> --reason "not planned" --comment "Reshaped into #<new spec>"`. Tasks past `approved` stay, listed in the new spec as existing work.
