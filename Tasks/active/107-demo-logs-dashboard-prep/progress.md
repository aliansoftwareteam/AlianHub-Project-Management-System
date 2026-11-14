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
- [ ] Reseed the 8 blueprint companies on the shared demo DB with DISPATCHER=on WORKFLOW_ENGINE=on
- [ ] Spot-check one company's dashboard in the browser

## Notes

- Jest in this `.claude/worktrees/...` path finds no tests without a scratch config (see memory
  `worktree-tests-under-dot-claude`); used one from the scratchpad, not committed.
- Logs only cover top-level tasks, not subtasks (ids aren't tracked after creation) — called out as a
  deliberate scope cut in task.md, not a bug.
