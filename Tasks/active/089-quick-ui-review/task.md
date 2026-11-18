---
id: 089
title: Quick UI/UX review — fix small UI issues with before/after screenshots
status: active
priority: medium
depends_on: []
created: 2026-11-02
---

# 089 — Quick UI/UX review (PRD)

## Goal

Walk the main surfaces at 1440 px and 375 px and fix small, safe UI defects, each proven by a before/after screenshot pair.

## Scope

- Surfaces: login, home, projects list, project views (list, board, calendar, Gantt, table), task detail, docs, people, settings, notifications, search, inbox/chat.
- Fix: misalignment, spacing, tab/underline placement, truncated or overlapping text, inconsistent buttons/selects, missing hover/focus states, hard-coded colours, contrast, untranslated strings, broken empty states, phone overflow.
- Every fix: `screenshots/NN-name-before.png` and `-after.png`, same viewport and data.
- `report.html` in this folder, published as a private Artifact.

## Out of scope

- Redesigns and feature changes.
- `frontend/src/views/Timesheet/**`, TimeLog/CustomReports/VarianceReport/MilestoneReport views (task 086), AI Ask/chat (task 087), docs (task 088). Issues found there go in the report's "not fixed" section.
- Any data write to the shared demo database.

## Acceptance criteria

- Each fix committed separately with a Conventional Commit title on `fix/ui-quick-review`, not pushed.
- `npm run style:check` and `npm run i18n:check` pass; style baseline lowered where counts drop.
- Report lists every fix with severity, files and the image pair, plus larger issues not fixed.
