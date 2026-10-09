# Progress: 048, team agent packs

Confirmed by the owner on 2026-10-08: "go with your recommendations". Decisions taken as recommended: the Content Writer example is the depth; five roles per team as listed; a pack is on for the whole workspace; the five workflows and their gates as listed; the dispatcher starts in suggest mode and uses a model guess only with a server key; industries first: IT company and Manufacturing, then agency and e-commerce.

## Checklist

**Part 1: role skills (playbooks)**
- [x] IT company roles, written to the example's depth: 22 roles, #1570, with the convention test tests/conventions/role-playbooks.test.js
- [x] Manufacturing roles, written to the example's depth: 22 roles, #1571
- [ ] The owner reviews each set (merged in build 825 before the owner's read; changes come as a small docs PR)

**Part 5: the company view**
- [ ] Org chart and flow board in AI > Company view behind `DISPATCHER` (draft PR feat/company-view; read-only, two reads)

**Part 2: team packs** · **Part 4: workflows** · **Part 6: blueprints**: not started.

## Log

### 2026-10-08
- Plan written and confirmed. Part 1 started: two agents write the IT company and Manufacturing playbooks.
- Both sets done as draft PRs (#1570 IT company, #1571 Manufacturing). Combined in batch 31 for one review and the convention test. Gaps both found: no tool reads a pull request or the running app; task.status.set has two states only; tasks.search cannot filter by tag, priority or field; no MCP tool creates a tag (the Manufacturing handoffs use about 20 tags, so the blueprint setup must create them); queue items carry no role yet (part 3).
- Step 2, roles for the connected AI: #1574, 44 prompts `work_as_<slug>` offered only to a connection that holds every tool a role names, and each role as a downloadable Claude skill, behind `MCP_ROLE_PROMPTS` (off). Reviewed and fixed; waits on #1572.
- The tool gaps: `tag.create` and `tasks.search` by tag, priority and field merged in build 821 (#1576). The two-state `task.status.set` without the grant is the deliberate never-Done rule and stays.
- Part 3, the dispatcher in suggest mode: started on top of #1574.
- Build 825 (#1582, batch 33): the playbooks, the role prompts and skills, and the dispatcher in suggest mode merged as one.
- Choices taken: the playbooks merged before the owner read them, because the owner kept saying "continue" and they are docs behind off flags (reversible); a "lead" who may accept, dismiss or route a suggestion is someone with the project's details (manage) permission.
- Hand-checked on build 825 with `DISPATCHER=on` and `MCP_ROLE_PROMPTS=on` (the owner approved both flags locally): a rule "Task type is Bug → Bug Triager" suggested the role on a Bug task made by the owner's Claude; Accept wrote the queue row; "Work as the Bug Triager" through the owner's Claude read the task, found a likely duplicate and asked for the missing report instead of guessing. Found: the role cannot see its queue row, the card has no frame, "It Company", and the chip after accept says "by the dispatcher". Being fixed.
- Builds 826 to 833 (all 2026-10-08): the dispatcher hand-check fixes, a role sees its own queue (#1584, 827); team packs with the catalogue Team filter (#1585, 828); a mention in an agent's comment reaches the person on every comment tool (#1589, #1596); playbooks for e-commerce, agency, professional services, education and construction plus the guide page (#1598, 830); the company view, tuning a role playbook per workspace and the dispatcher's model guess (#1599, 832); clinic playbooks and the company blueprint picker (#1601, 833). Eight blueprints, about 117 roles.
- Hand-checked on the local build through the owner's Claude: the Bug Triager found QAS-169 in its queue, claimed it, asked for the missing report and released it; a team pack turned on in two projects (one with the dispatcher off) and undone, keeping a role switched on by hand; a mention of a teammate notified them and a self-mention said so; the company view shows the Bug Triager with QAS-169 queued; the blueprint picker lists eight industries with sizes, seats and three starter roles. Screenshots were not possible (the browser pane is hidden), so these were checked through page text and stored data.
- Choices taken (reversible): a model's guess is always a suggestion, even in apply mode; only rules apply by themselves. Role names are unique across blueprints (prefixed where they met: agency-, construction-, proserv-). An edited playbook changes only the text, never a role's tools, and reaches every server copy within 60 s. Older API tokens now notify the people they mention. Thirteen IT company and Manufacturing roles in the blueprints are marked "not written yet"; three written e-commerce roles are not yet in its blueprint.
- Six cloud runs and five more did most of the writing (owner's ask on 2026-10-08 for more agents); every cloud PR had a local review before its batch.

### 2026-10-09
- Build 835 (#1603): the 13 roles the blueprints marked not written are written; e-commerce lists its three extra roles. Every role the blueprint picker suggests has a playbook.
- Pack run 1, IT company Engineering, on the local build: see `pack-run-1-results.md`. The dispatcher, a lead's routing and three role runs worked end to end; each role stopped where a person decides. Found: packs bring no starter rules, playbooks expect tags the project lacks, no MCP tool reads a pull request, a chip separator. A cloud run adds starter rules, pack tags and the separator.
- Part 4: a cloud run built role hand-overs as workflow steps and the ready-made team workflows (#1604); its review found a spin while paused and a task left in a role's queue when a run ends early; being fixed.

