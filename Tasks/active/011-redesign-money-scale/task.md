---
id: 011
title: Redesign stage 5 — money & scale
status: active
priority: medium
depends_on: [009]
created: 2026-09-03
---

# Redesign stage 5 — money & scale

## Goal
The agency/enterprise surfaces in the new shell: milestone billing and invoices, client view, reports, permission matrix, SSO/SCIM, custom fields with formulas, CSV import, offline, RTL, dashboard card catalogue, whiteboard/mind map.

## Scope (handoff option ids)
- Billing `19a` contract (fixed/hourly), `19b` hourly milestone, `19c` invoice, `19d` client view (guest-safe)
- Reports `16a` sprint, `16b` velocity + CFD, `16c` milestones, `16e` custom report builder; `11c` portfolio
- Settings `15a` permission matrix (finish), `11d` SSO (finish), SCIM, `17d` time off
- Fields & data `22a` field builder (10 types, formula/rollup), `22b` CSV import (4 steps), `22d` i18n/RTL (14 locales, RTL mirror rules)
- Dashboards `12d` hub, `20a–d` card anatomy + families (ship six cards first, catalogue behind "+ Card")
- Visual views `17a` whiteboard, `17b` mind map (cut line: last)
- `25c` people directory, `25e` external data & coding agents (overlaps 010)

## Out of scope
- Anything on the `25f` rejected list.

## Acceptance criteria
- [ ] Billing screens match mocks; every invoice line traces to tasks/time logs; audit trail on money changes.
- [ ] Reports match mocks and read in 30 seconds (sprint report).
- [ ] Field builder, CSV mapping step, offline queue and RTL behave per README.
- [ ] Build and tests pass.
