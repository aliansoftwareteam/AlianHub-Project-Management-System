# 042 — Non-AI UX fixes from the ClickUp comparison

## Goal
Fix the non-AI problems found in the 2026-09-28 re-comparison with ClickUp. The owner asked on 2026-09-28 to start fixing them alongside task 041. The first three slices come from the live walk-through of build 519. More slices are added once the re-check of the 2026-09-24 gaps is written up.

## Scope (one slice and one PR each)
1. **Every view type can be added.**
   - The owner's workspace catalogue (`project_tab_components`) holds 3 of the 20 view types (Dashboard, List, Gantt View). Add View therefore can't offer Board, Table, Calendar, Workload, Timeline, Mind Map, Forms and the rest; another company on the same server has all 20.
   - Find why a company ends up with a partial catalogue.
   - Make company creation seed the full catalogue.
   - Self-heal existing companies idempotently, as `ensureDashboardTab` already does for Dashboard, and add a migration for the missing records.
   - Clear the `ProjectTabs:<companyId>` cache.
2. **Views and pages polish.**
   - The Add View menu closes on a view switch, a route change, Esc and an outside click. Today it stays open over Board with the old search text.
   - The Planner's day grid fills the page, with working hours in view and earlier or later hours reachable by scrolling. Today the grid ends at 17:00 above empty grey space.
   - Dashboard cards in the list show a real preview, or a clear static summary, instead of grey loading bars.
3. **Phone layout (390 px).**
   - The LIVE agent strip fits the width: 520 px of content currently scrolls sideways in a 390 px viewport.
   - The project page doesn't overflow (396/390).
   - Inbox is reachable from the phone tab bar.
   - The List filter toolbar takes one row, with the other filters in a sheet.

## Out of scope
The larger gaps from the re-check (threaded or assigned comments, more custom field types, templates, shortcuts and the like). They become later slices of this task.

## Acceptance
- Failing-first tests for each slice: jest for the catalogue seed, self-heal and migration; vitest for components; e2e for the 390 px checks where the harness supports them.
- Every string goes through i18n and the allowlist doesn't grow.
- Dark mode and 390 px checked; keyboard access; no regression in the axe checks.
- Company scoping and access rules unchanged.
