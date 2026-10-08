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

