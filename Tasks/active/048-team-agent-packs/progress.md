# Progress: 048, team agent packs

Confirmed by the owner on 2026-10-08: "go with your recommendations". Decisions taken as recommended: the Content Writer example is the depth; five roles per team as listed; a pack is on for the whole workspace; the five workflows and their gates as listed; the dispatcher starts in suggest mode and uses a model guess only with a server key; industries first: IT company and Manufacturing, then agency and e-commerce.

## Checklist

**Part 1: role skills (playbooks)**
- [x] IT company roles, written to the example's depth: 22 roles, #1570, with the convention test tests/conventions/role-playbooks.test.js
- [x] Manufacturing roles, written to the example's depth: 22 roles, #1571
- [ ] The owner reviews each set

**Part 2: team packs** · **Part 3: the dispatcher** · **Part 4: workflows** · **Part 5: the company view** · **Part 6: blueprints**: not started.

## Log

### 2026-10-08
- Plan written and confirmed. Part 1 started: two agents write the IT company and Manufacturing playbooks.
- Both sets done as draft PRs (#1570 IT company, #1571 Manufacturing). Combined in batch 31 for one review and the convention test. Gaps both found: no tool reads a pull request or the running app; task.status.set has two states only; tasks.search cannot filter by tag, priority or field; no MCP tool creates a tag (the Manufacturing handoffs use about 20 tags, so the blueprint setup must create them); queue items carry no role yet (part 3).
