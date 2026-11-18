---
id: 093
title: Workload — cells show the hours, readable at any size
status: active
priority: medium
depends_on: [086]
created: 2026-11-12
---

# 093 — Workload: cells show the hours (PRD)

## 1. Problem

On Time → Workload a day cell draws the hours as a bar filled up to the person's capacity, with the number
inside the bar, and lays up to two task-name chips and a "+N" over it. Two things hide the hours:

1. With more than one task the chips cover the bar and its number, so a lead cannot read how many hours a
   person has that day without opening the cell.
2. With little time the bar is a sliver (30 minutes of an 8-hour day is about 4px), too short for the number,
   which is clipped away.

## 2. Goal

A cell answers one question at a glance: how many hours does this person have that day (or week/month).
The task breakdown stays one click away in the existing side panel.

## 3. Scope

1. **Hours only in the cell** — remove the task chips and "+N" from the grid cells. The cell shows the hours
   for the active mode (Estimated or Logged) as a large, centred number, and the capacity bar behind it.
2. **Readable at any amount** — the number no longer lives inside the bar: it sits on its own, readable over
   both the filled and the empty part, for 15 minutes as for 12 hours. A non-zero amount always shows at least
   a thin visible bar. Over capacity and next-week (tentative) keep their colours. Empty days stay blank.
3. **Click opens the panel** — unchanged: the side panel lists the tasks with their hours, estimated vs logged
   vs capacity, and opens a task.
4. **Rebalancing** — see §6 (decision).
5. Same for week and month buckets.
6. **i18n / tokens** — any new text through `en.js` + backfill; colours from tokens only.
7. **Tests** — the label and bar rules as pure helpers with unit tests; a spec for the cell markup (no chips,
   number present for small values).

## 4. Out of scope

- The side panel's content, the Balance suggestion logic, the server's workload route.
- The project-level Workload view under a project (`views/Projects/WorkloadView`).

## 5. Acceptance criteria

- [ ] A cell with several tasks shows its total hours, readable, with no task names over it.
- [ ] A cell with 30 minutes shows "0.5h" readable, and a visible bar.
- [ ] Over capacity is red, next week faded, as today; empty days are blank.
- [ ] Clicking a cell opens the side panel with the task list, as today.
- [ ] Logged mode and week/month buckets behave the same.
- [ ] Rebalancing works as decided in §6.
- [ ] `i18n:check`, `style:check`, ESLint and the tests pass; checked in the running app.

## 6. Decision: rebalancing

Today a task chip in a cell can be dragged to another day or person. Without chips in the cell, the drag moves
to the side panel (owner, 2026-11-12): in day columns each task row in the open panel can be dragged onto
another day or person in the grid, and the move works as before (same route, same hint, the grid reloads).
While a row is dragged the panel steps aside so every cell is a drop target. Week and month buckets stay
without dragging, as today. The Balance button is unchanged.
