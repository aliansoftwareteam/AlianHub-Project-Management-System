---
id: 020
title: Automation comments show as Ghost User
status: backlog
priority: medium
depends_on: []
created: 2026-09-10
---

# Automation comments show as Ghost User

## Goal
A comment written by an automation rule reads as that rule, not as a missing user.

## Scope
- Cause: `Modules/Automations/engine/tools.js:115` writes `userId` as `automation:<ruleId>`. The
  UI resolves no user for it and falls back to a generic avatar and "Ghost User".
- Options: a reserved system actor per rule, or author rendering that understands the
  `automation:` prefix — and the `agent` actor from `Modules/Agents`, which should render as the
  agent.
- Both surfaces that show a comment author: the comment list and notifications.

## Out of scope
- Audit rows — they already carry `actor.kind:"automation"` and the rule name.
- Reworking the comments schema beyond what author rendering needs.

## Acceptance criteria
- [ ] A status-change rule that adds a comment shows the rule name and an automation icon in the comment list and in notifications.
- [ ] No "Ghost User" anywhere.
- [ ] One test covers the author rendering.

## Constraints & notes
- Found on 2026-08-24 while building task 005 (its progress.md, "New known issue"); filed here on
  2026-09-10 when 005 closed.
- Whatever resolves the `automation:` prefix should resolve the `agent` actor the same way.

## Resources
None.
