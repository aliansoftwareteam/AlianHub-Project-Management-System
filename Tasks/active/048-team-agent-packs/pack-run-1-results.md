# Pack run 1: IT company, Engineering

Run on 2026-10-09 on the local build 835, by the coordinator, as Local PM.
- **Flags:** `DISPATCHER=on` and `MCP_ROLE_PROMPTS=on`.
- **Agent:** the owner's Claude Code over OAuth (`alianhub-oauth`).
- **How each step ran:** one fresh non-interactive run per step (`claude -p`, only the AlianHub connection allowed). The role runs used the MCP prompt `work_as_<role>`.

## Steps

| Step | Result | Time |
|---|---|---|
| AI > Team packs: IT company, Engineering, on QA Sandbox | 8 roles turned on; Bug Triager was already on (9 in the team) | under a minute |
| The owner's Claude makes three tasks | QAS-170 (Bug, checkout on iPad Safari), QAS-171 (release notes for build 835), QAS-172 (review the team packs test change) | 26 s |
| The dispatcher routes them | QAS-170: suggested Bug Triager by the rule "Task type is Bug". QAS-171 and QAS-172: Needs routing | at once |
| The lead decides (project details card and task chip) | Accepted Bug Triager on QAS-170; sent QAS-171 to Release Manager and QAS-172 to Code Reviewer | under a minute |
| Bug Triager works its queue | Claimed QAS-170; searched for duplicates (none); rewrote the description as Summary, Steps, Expected, Actual, Where, Who is hit, Source; set High with the playbook's reason; filled Priority tag, Stage and Summary; posted a triage note that notified Rahul Mehta; proposed the tags bug, checkout and ready for planning; released the item | 112 s, 29 turns |
| Release Manager works its queue | Claimed QAS-171; found no scope (no sprint, dates or closed tasks for build 835) and saw that the High bug QAS-170 could block the release; asked once for scope, date, approver and checklist doc, then stopped as the playbook says; released the item | 118 s, 28 turns |
| Code Reviewer works its queue | Claimed QAS-172; judged the one-line test change right, with the reason; posted a review note; moved the task to In review; proposed a tag; released the item | 317 s, 88 turns |

Each of the three roles stopped where its playbook says a person decides. None of them guessed a priority, a scope or a verdict that it had no evidence for.

## Found

1. **Only one task in three matched a rule.** A pack switches roles on but brings no routing rules, so the lead routes most tasks by hand. Next: each pack could offer its starter rules (for example "Task type is Bug → Bug Triager"), switched on with the roles in suggest mode.
2. **The playbooks expect tags the project does not have.** Bug Triager wanted bug, checkout and ready for planning; Code Reviewer wanted review note posted. Each became a proposal waiting in the Inbox. Next: applying a pack could propose the pack's handoff tags once, as one approval.
3. **The Code Reviewer read the change from the local checkout, not through AlianHub.** The command-line agent can read local files. Through MCP alone it could not have seen the diff, because no tool reads a pull request (a gap the playbooks listed on 2026-10-08). It was also the slowest role, at 88 turns.
4. **The chip wording runs together:** "accepted by Local PMrule 1" needs a separator before the rule.
5. **The Release Manager's stop was right but costly.** It found nothing to release because QA Sandbox has no closed tasks for build 835. A real pack run needs a project with finished work.

## Cost

The three role runs were reported at $1.70, $1.62 and $4.08 of model use (about $7.40 in all), on the owner's Claude plan, not the server key.
