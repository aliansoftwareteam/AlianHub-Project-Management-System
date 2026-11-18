---
id: 092
title: Time reports — pick a whole team in the People filter
status: active
priority: medium
depends_on: [086]
created: 2026-11-12
---

# 092 — Time reports: Teams in the People filter (PRD)

## 1. Problem

The People filter on the Time reports lists every person one by one. A lead who wants to see one team's
time has to find and tick each member, and redo it on every visit. People in AlianHub already belong to
teams (Settings → Teams), so the filter should offer the team itself.

## 2. Goal

The People filter offers the company's teams above the people. Ticking a team picks all its members at
once; individual people can still be ticked on top of, or taken out of, a team pick.

## 3. Scope

1. **Where** — every report whose People filter takes several people: Project, Workload, Tracker,
   Approvals and Variance. They all render `ReportFilterBar` → `EverythingFilterChip`, so the change
   lives there once.
2. **Teams section** — in the People popover, a "Teams" heading with one row per team that has at least
   one selectable member (team colour mark, name, member count), then a "People" heading with the people
   as today. Find searches both. No teams (or a plan without teams) → the popover looks as it does today.
3. **A team pick adds people** — ticking a team adds its members to the People selection. The URL,
   match any/all, the narrowing of the other filters, the data and the export keep working on people,
   unchanged. No backend change.
4. **Team row state** — ticked when all its members are picked, partly ticked (dash) when some are,
   empty otherwise. Clicking a ticked team takes its members out, except members of another team that
   is still fully ticked. Clicking a partly ticked or empty team picks all its members.
5. **Chip summary** — when the picked people are exactly one team's members, the chip reads the team's
   name instead of a count.
6. **i18n** — the headings, member count and partly-ticked label go through `en.js` + backfill.
7. **Tests** — pure team helpers (rows from teams + people, row state, toggle) in jest; the chip's
   Teams section in a vitest spec.

## 4. Out of scope

- **Mine**: its People filter holds one person at a time, so a team pick does not apply there.
- A saved "team" filter that follows later membership changes (a link keeps the people picked when it
  was made).
- Team filters on non-Time screens (Everything, project views, dashboards).

## 5. Acceptance criteria

- [ ] On Project, Workload, Tracker, Approvals and Variance, the People popover shows a Teams section
      above People when the company has teams.
- [ ] Ticking a team selects all its members; the report reloads showing just them, and the URL lists them.
- [ ] Unticking that team clears them again; a member also in another fully ticked team stays.
- [ ] A team with some of its members picked shows as partly ticked.
- [ ] Individual people can still be added or removed next to a team pick.
- [ ] With one team picked, the chip reads that team's name.
- [ ] Find narrows teams and people together.
- [ ] Mine is unchanged.
- [ ] No hard-coded colours or bare strings; `i18n:check`, `style:check` and the new tests pass.
