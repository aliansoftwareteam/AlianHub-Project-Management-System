# Pack run 2: Manufacturing

Run on 2026-10-10 on the local build 852 by the coordinator (Local PM). The project was Sweep Project W2d (key SPWD). No MCP tool creates a project, so an unused sweep project was used instead of a new "[Pack run] Manufacturing".
- **Flags:** `DISPATCHER=on` and `MCP_ROLE_PROMPTS=on`.
- **Agent:** the owner's Claude Code over OAuth (`alianhub-oauth`). The pack's server-key agents stayed paused.
- **How each step ran:** one fresh non-interactive run per step (`claude -p`, only the AlianHub connection allowed). The role runs used the MCP prompt `work_as_<role>`. The lead's steps were done as Local PM in the Browser pane.
- **Difference from run 1:** the three role runs ran at the same time, not one after another. That surfaced finding 4.

## Steps

| Step | Result | Time |
|---|---|---|
| AI > Team packs, company blueprint: Manufacturing, 3 starter roles, on Sweep Project W2d | Order Intake, Non-conformance Recorder and Maintenance Planner turned on, with one paused agent per role. The page said the project's dispatcher was off. The project card showed no routing rules and the Inbox held no tag proposal. | under a minute |
| The owner's Claude makes four tasks | Every create waited in the Inbox, because the connection is an outside client. The lead approved them: SPWD-12 (burrs on BR-40, 7 of 50 failed, lot S-552), SPWD-13 (Steelco coil slips a week), SPWD-14 (press 3 hydraulic leak), SPWD-15 (Example Pumps PO 55102, 2 lines) | 60 s, 14 turns, plus 4 approvals |
| The lead switches the dispatcher to "Suggest a role" (project details card) | Saved. The tasks already made were not routed, because the dispatcher only acts on a new task or a change. | under a minute |
| The owner's Claude tags the tasks (non-conformance, supplier-delay, maintenance, customer-order) | The project had no tags. The 4 new tags waited for approval, and the lead approved them. A second run put the tags on, applied at once. | 37 s, 13 turns, and 22 s, 9 turns |
| The dispatcher routes them | All four landed in Needs routing. No rule existed, so even SPWD-12, tagged non-conformance, got no suggestion. | at once |
| The lead routes (Needs routing, Send) | SPWD-12 to Non-conformance Recorder, SPWD-14 to Maintenance Planner, SPWD-15 to Order Intake. SPWD-13 stays in Needs routing, because Supplier Follow-up is not among the three starter roles. | under a minute |
| Non-conformance Recorder works its queue | Claimed SPWD-12. Found no duplicate record. Proposed the record "NC BR-40 mounting hole burrs 10 Oct 2026" with only the reported facts (it waits in the Inbox). Commented the cause draft marked "proposal", with three branches and what would confirm each. Searched for affected lots and shipped orders (none) and named SPWD-13 as the next BR-40 run. Asked once for the requirement with units, the inspector and the quality engineer. Released the item. Left disposition, root cause and action to the engineer. | 186 s, 34 turns |
| Maintenance Planner works its queue | Read SPWD-14. Found no machine plan, closed preventive work, hour reading, production window or named lead. Asked once for the six inputs its playbook needs. Made no doc and no work order. Named the decision to keep a leaking press running as the lead's safety call. Could not claim the item (see finding 4). | 121 s, 26 turns |
| Order Intake works its queue | Read SPWD-15. Found no earlier order or part list to compare with. Created no order lines from a guess. Asked once for the owner, units, address, terms and special requirements, plus the missing `order-to-confirm` and `ready-for-planning` tags and fields. Flagged that the plant has no record of HP-220 or HC-10. Its release failed: its claim had been released by the Non-conformance Recorder run. | 100 s, 28 turns |

Each of the three roles stopped where its playbook says a person decides. None of them recorded a quantity, a disposition, a schedule or an order line it had no evidence for.

## Found

1. **The company blueprint path brings no starter rules and no tag proposals.** "Turn on 3 starter roles" calls `applyStarterRoles`, which sends neither `starterRules` nor `proposeTags`. The pack's own page sends both. The project card showed "No routing rules yet", and no tag proposal reached the Inbox. So in this run the dispatcher matched nothing, and the lead routed every task by hand, the gap #1616 was meant to close. Next: send `starterRules: true` and `proposeTags: true` from the blueprint picker too.
2. **A starter rule on a missing tag is not added later.** Even through the pack page, the rule `tag:non-conformance` is skipped while the tag waits for approval. The page says to apply the pack again after the approval. In a new project every tag starts missing, so the first apply makes no tag rules. Next: add the waiting rule when the pack's tag proposal is approved.
3. **The pack leaves the dispatcher off.** That is by design ("a project's dispatcher mode is never changed here"), and the page says so. But the tasks made before the lead switched it on were never routed, until a later change, here the tags, touched them. Next: offer "Suggest a role" as a choice when the pack is applied, or route a project's open tasks once when its dispatcher is switched on.
4. **One connection holds one queue item at a time, across roles.** The three role runs ran at the same time through the same OAuth connection:
   - The Maintenance Planner could not claim SPWD-14.
   - The Non-conformance Recorder released SPWD-15, which Order Intake had claimed, so Order Intake's own release then failed.

   A person working several roles in parallel from one Claude account will hit this. Next: hold one item per connection and role, or say in the claim refusal which role holds the item.
5. **Every create and every new tag waits for approval for the outside OAuth client.** That was 8 Inbox approvals before any role started, and the Non-conformance Recorder's record is still waiting. This is the intended guard. It makes the first pack run on a new project slow, and finding 2 makes it slower.
6. **Manufacturing playbooks expect fields and documents a fresh project lacks:**
   - **Fields:** customer, part, revision and quantity.
   - **Tags:** `order-to-confirm` and `ready-for-planning`.
   - **Documents:** a part list, machine plans and production windows.

   Each role asked once and stopped, as its playbook says, but none could deliver its main output. A blueprint project template with these fields, tags and a sample machine plan would let the next run reach the hand-overs.

## Cost

As reported by Claude Code, on the owner's Claude plan, not the server key:
- **Owner's setup runs:** $0.96, $0.90 and $0.77.
- **Role runs:** $2.18 (Non-conformance Recorder), $1.74 (Maintenance Planner) and $1.56 (Order Intake), about $5.48.
- **Total:** about $8.12.
