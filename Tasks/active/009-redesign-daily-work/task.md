---
id: 009
title: Redesign stages 2–3 — first run and daily work in the new shell
status: active
priority: high
depends_on: [008]
created: 2026-09-03
---

# Redesign stages 2–3 — first run and daily work in the new shell

## Goal
Every screen people spend their hours in renders inside the stage-1 shell with the handoff tokens: first-run (signup/create company, sample project, checklist, tour), projects list and every project view, task relations, Inbox, ⌘K search, Chat, Docs, Timesheet, error/empty states, mobile Home/Board/Chat.

## Scope (handoff option ids)
- First run: `8a` signup steps (via invitation flow; no public signup route in this build), `8b` install wizard (skipped: `installation/` is not part of this tree), `8c` Create Project templates, `5d` checklist, `21f` tour, `18f` error states.
- Projects: `10a` list, `10b` Board, `14a` List, `14b` Calendar, `14c` Gantt, `14d` Workload, `14e` Forms, `10c` Members, `21d` relations/subtasks/quick menu, `21e` sprints & folders, `17c` recurring tasks, `13c` AI fields in Table (UI only; data from stage 4).
- Personal & global: `18d` Inbox, `18e` ⌘K, `18g` changelog, `22c` offline.
- Chat: `10d`, `21a`, `21b`, `21c`, `13f` meeting notes.
- Docs: `12c`, `25a`, `25b`, `25d`.
- Time: `10e`, `24b`, `24c`, `17e`, `16d`.
- Mobile: `12e`, `24a`, `24d`, `24e` rules.

## Out of scope
- AI agent surfaces (task 010) except placeholders typed in props.
- Billing, reports beyond variance, permission matrix, custom fields, CSV import, RTL (task 011).

## Acceptance criteria
- [ ] Each screen above matches its mock in layout, copy and states, using only tokens (`ah-*` classes / CSS variables).
- [ ] Task detail opens as an overlay from every view without a route change; deep links still work.
- [ ] Inline errors everywhere; no toasts for validation.
- [ ] Mobile: Home, task detail, log time, approvals, Planner, Chat, AI Inbox, Board (read + drag) usable at 375px with ≥44px targets; desktop-only views show "open on desktop".
- [ ] `cd frontend && npm run build` passes; touched jest tests pass.

## Constraints & notes
- Built by parallel agents from `scratchpad/AGENT_BRIEF.md`; each owns a file set. See progress.md for the wave plan.
