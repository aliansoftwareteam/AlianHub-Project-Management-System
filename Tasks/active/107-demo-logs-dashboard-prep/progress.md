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

## Notes

- Jest in this `.claude/worktrees/...` path finds no tests without a scratch config (see memory
  `worktree-tests-under-dot-claude`); used one from the scratchpad, not committed.
- Logs only cover top-level tasks, not subtasks (ids aren't tracked after creation) — called out as a
  deliberate scope cut in task.md, not a bug.
