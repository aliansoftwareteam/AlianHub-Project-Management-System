# ADR: Gantt chart library

- **Status:** Accepted
- **Date:** 2026-06-18
- **Sprint task:** S5-01 — Gantt library spike (timeboxed)
- **Deciders:** AlianHub team

## Context

Sprint 5–6 builds the Gantt / timeline view (S5-02) — the most visible competitive
gap and a launch gate. Before committing ~6 weeks of build, we must choose the
charting foundation. The view's hard requirements:

- Render task bars from `startDate` / `endDate`.
- Drag to reschedule + resize to change duration.
- Draw **dependency arrows** from the task `relations` array (`blocks` → finish-to-start).
- Stay smooth at ~1,000 tasks.
- Show milestone markers.
- Day / week / month zoom presets.

Constraints: AlianHub is licensed **AGPL-3.0-or-later** (copyleft); the frontend is **Vue 3**.

## Options considered

| Library | License | Dependency arrows | Drag / resize | ~1k-task perf | Milestones | Vue 3 fit |
|---|---|---|---|---|---|---|
| **dhtmlx-gantt (GPL)** | GPL | ✅ built-in | ✅ built-in | ✅ virtual render | ✅ built-in | wrap (vanilla JS) |
| frappe-gantt | MIT | basic | ✅ | ⚠️ renders all bars | ⚠️ not first-class | wrap |
| vue-ganttastic | MIT | ❌ none out of the box | ✅ | ⚠️ | partial | ✅ native |

## Decision

**dhtmlx-gantt, GPL edition.**

It is the only candidate that satisfies *all* of S5-02's hard requirements out of the
box — dependency arrows, drag/resize, virtual rendering at 1k tasks, milestones, and
zoom presets — which minimizes custom work across the 6-week build. Its **GPL license
is compatible with AlianHub's AGPL-3.0** (AGPL is a superset of GPLv3); shipping it as
part of an AGPL application is permitted. The features the GPL edition lacks
(critical path, baselines, auto-scheduling, resource load) are exactly the items the
plan defers to **v2**, so the GPL edition is sufficient for v1.

## Consequences

- New frontend dependency **`dhtmlx-gantt`** (GPL). **Lazy-loaded** only when the Gantt
  view opens (`defineAsyncComponent` + dynamic `import()`), so its weight never enters
  the main bundle.
- Not Vue-native: wrapped in `views/Projects/GanttView/GanttView.vue` — init on mount,
  destroy on unmount, data synced through the gantt API.
- **Licensing:** the GPL edition keeps the distributed app copyleft (already AGPL, so no
  change). If AlianHub ever ships a non-AGPL / proprietary edition, that edition would
  need a dhtmlx commercial license. No impact on the current AGPL distribution.
- v1 ships **without** critical path, baselines, and auto-scheduling on dependency move
  (roadmap → v2).

## Fallback if a licensing review objects

frappe-gantt (MIT): accept reduced features and invest custom work in dependency-arrow
rendering, virtualization for 1k tasks, and milestone markers.
