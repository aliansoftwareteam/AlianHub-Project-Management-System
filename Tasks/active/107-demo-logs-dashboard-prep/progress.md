# 107 — Progress

- [x] `adapter.js`: add `logTime` (via `manualLogTime` through `viaHandler`, same pattern as `personComment`)
- [x] `build.js`: `defaultEstimateHours`/`hashOf`, estimate fallback in `seedTasks`, `seedTimeLogs` step wired into `buildShowcase`
- [x] `scenario.js`: fix `CARDS` (was missing `my_time` against the real catalogue)
- [x] 11 scenario files: dashboard cards +`logged_vs_estimate`, +`my_time` (6 cards each, at the validator's max)
- [x] `tests/demo-industries.test.js`: fake adapter `logTime` + `createTask` now records its id; new assertions
      (estimate on every top-level task, logs through yesterday never today, ordering, no log on a
      not-started task, CARDS matches the real catalogue, every dashboard has 1–6 cards incl. the new two)
- [x] `docs/DEMO-INDUSTRIES.md`: new "Time logged and the dashboard" section, real/illustrative table
      updated, flagged the still-missing nightly cron on demo.alianhub.com
- [x] `npx jest` (scratch config, see below) — 65/65 passing; `npm run i18n:check` and `npm run style:check` — clean
- [x] Reseed the 8 blueprint companies on the shared demo DB with DISPATCHER=on WORKFLOW_ENGINE=on
- [x] Spot-check one company's dashboard in the browser — found a pre-existing ops gap, see below

## Live reseed (2026-11-14)

- First attempt failed before writing anything: Node's resolver on this machine gets ECONNREFUSED on
  the Atlas SRV lookup (`querySrv ECONNREFUSED _mongodb._tcp.singleproduct.qzedf10.mongodb.net`) even
  though the OS resolver (`nslookup`) answers fine — Node isn't using the local resolver (192.168.0.2)
  by default on this network. Fixed for this session with a `--require` preload calling
  `dns.setServers(['192.168.0.2'])`; not committed anywhere, a one-off for this machine.
- Second attempt (`--only technova,forgeline,brightwave,cartwheel,northgate,maplegrove,carewell,hartleymoss --reset`,
  `DISPATCHER=on WORKFLOW_ENGINE=on AUTOMATION_ENGINE=true`) completed cleanly, exit 0. All 8 dropped
  and rebuilt; each logged time (49–62 entries), kept its dispatcher (18–23 suggestions) and workflow
  (1 run waiting at approval), and automations actually fired this time (3–4 runs each — they hadn't on
  the very first local-only test because this worktree's `.env` sets `AUTOMATION_ENGINE=false`).
- Verified directly against the live database (not just the UI): TechNova's new company
  (`6af83a4ecd7eb77bab3861f2`) has real `TIMESHEET` rows dated through 2026-11-13 (yesterday) and its
  dashboard document has all 6 cards, `TeamLoggedVsEtaCard` and `MyTimeCard` included.
- **The live site (demo.alianhub.com) still shows the old 4-card dashboard and an old TechNova company
  id that no longer exists in Mongo** (confirmed: `listDatabases()` has no such database any more). This
  is the server process serving stale cached state — the build's own closing line says it every run,
  "Restart a running server so it reads the new members," and `Config/config.js`'s `node-cache` is
  exactly the kind of cache CLAUDE.md's gotcha #4 warns about. Nobody has restarted the
  demo.alianhub.com process since the reseed; this session has no server/ops access to do that (same
  limitation as the missing nightly cron, see task.md). The seeded data itself is correct and verified;
  only the live page needs that restart to show it.
- **Proved it with a real local server against the same shared database** (not just raw queries): safety
  check first (`Modules/Agents/init.js` reaps every "running" agent run across every company at startup —
  confirmed 0 running runs across all 8 before starting anything). Added a temporary `.claude/launch.json`
  entry (`node -r <dns-fix> index.js`, reverted after), started it, signed in with "Try the demo"
  ("You belong to 8" — the correct, fresh count), and opened TechNova's and CareWell's dashboards:
  **Logged vs estimate** showed real aggregates (-48%, -59%), **My time** correctly showed "No hours...
  yet" on TechNova (the owner isn't assigned any task there) and real "2h 29m logged" on CareWell. This
  is the exact page demo.alianhub.com will show once its own process restarts.

## Executive dashboard (2026-11-14, later the same session)

- [x] `adapter.js`: `createWorkspaceDashboard` — calls `Modules/UserDashboard/controller.createSharedDashboard`
      via `viaHandler`, `visibility: 'workspace'`, up to 60 cards (not the AI-plan path's 6-card cap)
- [x] `build.js`: `EXECUTIVE_CARDS` (6 company-wide cards, no "mine" cards), `buildShowcase` now also
      calls `createWorkspaceDashboard` for every company — no scenario file edits needed (bypasses the
      `scenario.dashboard`/`CARDS` validation entirely, since it's a different route, not the AI planner)
- [x] `tests/demo-industries.test.js`: fake adapter `createWorkspaceDashboard`; asserts exactly one
      per company, named "Executive overview", and that it never includes `DueSoonCard`/`MyTimeCard`
- [x] `npx jest` 65/65; `npm run i18n:check` / `npm run style:check` clean
- [x] Verified for real: rebuilt TechNova on the throwaway local mongod, ran the actual app server
      (temporary `local-preview-wrapper.js` + `.claude/launch.json` entry, both reverted/scratchpad-only
      after), signed in, opened "Executive overview" — all 6 cards render real data (9 tasks/3 projects,
      8 at risk, -48% logged vs estimate, 40h free capacity across 5 people, $0.00 of $12 agent spend,
      each agent correctly "Paused"). Screenshot sent to the owner.
- [ ] Not yet reseeded on the live/shared 8 companies — this addition landed after that reseed; needs
      another `--reset` run (same command as before) to appear there, and demo.alianhub.com still needs
      its separate restart regardless (see above) before any of this is visible live.

## Notes

- Jest in this `.claude/worktrees/...` path finds no tests without a scratch config (see memory
  `worktree-tests-under-dot-claude`); used one from the scratchpad, not committed.
- Logs only cover top-level tasks, not subtasks (ids aren't tracked after creation) — called out as a
  deliberate scope cut in task.md, not a bug.
