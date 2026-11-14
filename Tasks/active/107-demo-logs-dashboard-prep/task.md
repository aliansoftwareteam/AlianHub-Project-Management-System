---
id: 107
title: Time logs and a fuller dashboard for the industry demos
status: active
priority: high
depends_on: [053, 054]
created: 2026-11-14
---

# 107 — Time logs and a fuller dashboard for the industry demos

This file is the PRD (Rule 2). The owner asked (2026-11-14) to fix two gaps in the industry demo
(`npm run demo:industries`, docs/DEMO-INDUSTRIES.md): no time-log entries, and a dashboard that looks
thin next to how deeply the agent layer (dispatcher, workflows, simulated runs) is already seeded.
Logs must read through yesterday, never today, so a nightly `--reset` always shows a week that just
finished rather than a half-logged today.

## Goal

A visitor opening any industry demo company sees a dashboard that actually has something to show on
every card: tasks by status, at risk, due soon, project pulse, the team's logged-vs-estimate chart and
the signed-in owner's own time card. The logged time is real `TIMESHEET` data written through the same
`manualLogTime` path a person uses, not a stub, and every task has a real effort estimate (`totalEstimatedTime`)
for the "logged vs estimate" chart to compare against. Nothing seeded is dated today or later.

## Decisions

- **No new projects.** The owner confirmed: match the depth already in the Agents feature (dispatcher,
  workflows, simulated runs) on the existing 3 projects per company; this task is logs + dashboard only.
- **Live agent actions stay fast and small.** Nothing this task adds triggers a live agent run; the only
  "real" agent action in the demo remains the deterministic `digest.ceo` **Run now** (no AI model, posts
  board counts, finishes in well under a minute). No slow or model-backed action is introduced.
- **Estimates are generated, not hand-authored.** Every top-level task gets a deterministic effort
  estimate (2–10 hours, hashed from its key) unless a scenario already sets `task.estimate`. This avoids
  hand-editing ~150 tasks across 11 scenario files.
- **Logs cover top-level tasks only**, not subtasks (subtask ids aren't tracked after creation today;
  adding that tracking is out of scope).
- **Window: the last 15 workdays (3 work-weeks), ending yesterday.** A task whose status is still the
  project's opening ("default_active") status gets no logged time — it hasn't started. A task in an
  "active" status gets ~45% of its estimate logged, split across its assignees (or lead); a "done"/"close"
  task gets ~90%. Each person's share lands in 2–3 entries on different workdays in the window, so entries
  spread out instead of landing in one block of the owner's day.
- **Known trade-off, accepted:** because logs stop at yesterday, a dashboard card scoped to "this week"
  (the default period for `logged_vs_estimate` and `my_time`) shows nothing on a Monday, when "this week"
  has not yet reached a logged day. The period selector lets a visitor pick "last week" or "last 30 days"
  instead; this is preferred over ever showing a partial, still-running "today".
- **Dashboard cards: add `logged_vs_estimate` and `my_time` to all 11 scenarios**, bringing every company
  to 6 cards (the validator's max). `scripts/demo/industries/lib/scenario.js`'s `CARDS` list is missing
  `my_time` (a real gap against `Modules/Agents/dashboardRequests.js`'s `CARDS`) and is fixed alongside.
- **Reset cadence:** the server-side nightly cron (`0 3 * * * cd /app && npm run demo:industries -- --reset`,
  documented in docs/DEMO-INDUSTRIES.md) is not installed on demo.alianhub.com yet, per the owner. Setting
  it up requires server/ops access this session does not have; this PR makes the seed itself correct
  (logs always computed relative to the day `--reset` runs, so whenever that cron is added later, or
  whenever anyone runs `--reset` by hand, the result is always "through yesterday"). Flagged to the owner
  as a follow-up outside this repo.
- **Reseed the live shared demo database** once the code is ready and tested, using this worktree's
  existing `.env` (already pointed at the shared cluster with `DEMO_MODE=true` and the four safety
  switches) — the owner explicitly asked for this. Only the 8 blueprint companies already on that
  cluster (`--only technova,forgeline,brightwave,cartwheel,northgate,maplegrove,carewell,hartleymoss`),
  with `DISPATCHER=on WORKFLOW_ENGINE=on` so the existing agentic layers are kept, not dropped.

## Addendum (2026-11-14, same session): an executive dashboard

The owner asked separately for "an executive level dashboard... proper organized and proper working".
AlianHub has no dedicated executive-dashboard feature, but it does support a dashboard scoped to the
whole company (`visibility: 'workspace'`) rather than one project — the AI-plan path the per-project
dashboard above uses (`Modules/AIProjectGenerator/planDashboard.js`) can only make a project or private
one, so this calls `Modules/UserDashboard/controller.js`'s `createSharedDashboard` route directly.

Every company now also gets a second dashboard, **"Executive overview"**, workspace-visible (shows up
to everyone, not just project members), with six cards — every one company-wide/team-scoped, never a
"mine" card (an executive looks at everyone's work, not their own task list): Tasks by status, At risk
today, Project pulse, Logged vs estimate, Free capacity, Agent spend. Verified in a real running local
server (not just the seed's own report) that every card renders real, non-empty data off the existing
seed — including Free capacity (defaults to 8h/day per person, no separate capacity-planning seed
needed) and Agent spend ($0 of the $12 cap, correctly "Paused" — real, not broken: agents cost nothing
until switched on with a model, per the demo's existing "real but switched off" convention).

## Scope

1. `scripts/demo/industries/lib/build.js`: a `defaultEstimateHours(key)` helper; `seedTasks` fills in
   `task.estimate` when the scenario didn't set one; a new `seedTimeLogs` step logging real time via
   `adapter.logTime` for every top-level task past its opening status.
2. `scripts/demo/industries/lib/adapter.js`: a `logTime` function that calls
   `Modules/LogTime/controllerV2/manualLogtime.manualLogTime` through the existing `viaHandler` helper
   (the same pattern `personComment` uses for `Modules/Comments/controller.save`).
3. `scripts/demo/industries/lib/scenario.js`: add `my_time` to `CARDS`.
4. All 11 `scripts/demo/industries/scenarios/*.js`: add `logged_vs_estimate` and `my_time` to `dashboard.cards`.
5. `tests/demo-industries.test.js`: `logTime` on the fake adapter; assertions that every scenario logs
   time on at least one task, that `report.timeLogs` matches, and that no scenario's dashboard exceeds 6
   cards or uses an unknown card key.
6. `docs/DEMO-INDUSTRIES.md`: document the time logs, the "through yesterday" rule, the dashboard cards,
   and flag the still-missing server cron as a follow-up for the owner.
7. Reseed the live demo database (see Decisions) and sanity-check one company's dashboard in the browser.

## Out of scope

- New projects, new agents, new workflows.
- Subtask time logs.
- Installing the nightly reset cron on demo.alianhub.com (no server access from here).
- Any live-triggerable agent action beyond the existing deterministic digest.

## Acceptance criteria

- [x] `npx jest tests/demo-industries.test.js` passes for all 11 scenarios (65/65, scratch jest config).
- [x] Every scenario's dashboard has 1–6 known card keys, including `logged_vs_estimate` and `my_time`.
- [x] Every top-level task has a `totalEstimatedTime`; verified against a real throwaway MongoDB and
      against the live shared cluster directly: real `TIMESHEET` rows dated on workdays up to and
      including yesterday, none today or later.
- [x] `npm run i18n:check` and `npm run style:check` pass.
- [x] The 8 blueprint companies on the shared demo database were reset and rebuilt, each with its
      dashboard's 6 cards (including the 2 new ones) and its dispatcher/workflow layers intact —
      confirmed directly in the database.
- [ ] **Not yet visible on demo.alianhub.com itself.** The live server process hasn't been restarted
      since the reset, so it is still serving a cached, now-deleted company and an old 4-card dashboard
      (this is the same "needs a restart" gotcha the `demo-db-shared-with-live-demo` memory already
      recorded from 2026-10-17 — it recurred, not a defect in this change). Needs the owner or ops to
      restart demo.alianhub.com; this session has no access to do that.
