# Progress — integration (all workstreams)

| Date | Step | Result | Evidence |
|---|---|---|---|
| 2026-09-04 | Merge B (14 commits) | clean | no conflicts |
| 2026-09-04 | Merge C (12 commits) | clean | no conflicts; i18n allowlist re-baselined |
| 2026-09-04 | Merge A (5 commits) | 10 conflicts resolved | index.js re-wired (requestLog, Trash init, errorHandler on A's boot), Setup calls ensureNotificationDefaults, first-run test combined, serviceFunction case blocks, locales backfilled for SetupV2/InstanceV2 |
| 2026-09-04 | Gate | green | lint 0 errors; jest 109 suites / 1366 tests; vitest 4 files / 9 tests; frontend build ok; i18n-check 0 missing; unused-components 0 |
| 2026-09-04 | Boot | ok | `/health` → status ok, db latency 3 ms, migrationsPending 0; `/api/v2/setup/status` installed:true |
| 2026-09-04 | Browser: Home | PASS | rail Home·Projects·Inbox·Planner·Chat·AI·Docs·Dash·Time; 4-step shell tour offered; owner checklist shows "Choose project apps · Remove the sample data"; More → Trash |
| 2026-09-04 | Browser: project @800px | PASS | "+ New" → New list → "Sprint created successfully", navigated to it; More grouped (Find/Insights/Share & export/Import/Project settings); Import dialog with 5 cards; list tour offered |
| 2026-09-04 | Browser: Settings → Projects | PASS | app toggles labelled with descriptions |
| 2026-09-04 | Browser: Instance console | PASS | Health (readiness 3/5, db 8 ms, storage writable, migrations 6/0, queue), Settings tabs with env chips, Backups "Back up now" → archive rows, Upgrade (v14.35.0 latest, migrations 6 applied), Logs tail of error-2026-09-04.log |
| 2026-09-04 | Browser: bulk delete → Trash → restore | PASS | 2 tasks deleted with typed confirm ("Updated 2 tasks."); Trash → Tasks lists both; Restore ×2 → "Restored.", Trash empty |
| 2026-09-04 | Merge B (last 4 commits) | 8 rename-only conflicts resolved | kept A/C logic, ran `i18n-rename-namespace.js --all` (V2 blocks 0, refs 0), `env-doc.js` regenerated with 7 new ops keys, 10 en.js keys restored, `.env.example` head reworded |
| 2026-09-04 | Gate after B | green | jest 111 suites / 1372 tests; lint 0 errors; env-doc in sync; i18n-check 0 missing; unused-components 0; `/health` carries `X-Request-Id`; `Prefer: status-codes` → 401 on a bad call |
| 2026-09-04 | Browser after B | PASS | header project switcher lists 6 projects and routes to the chosen one at 1440; vitest 5 files / 12 tests; no raw locale keys on Projects or Inbox after the namespace fold |
| 2026-09-04 | Drill: fresh instance (agent D) | PASS after 1 fix | empty Mongo → setup/status installed:false → setup/complete creates owner (isProductOwner), company, WELCOME project (14 tasks), 6 migrations ok → 409 on repeat; closed DB port → dbOk:false, /health 503, process alive. Fix: JWT_ALGORITHM/JWT_EXP defaults so a JWT_SECRET-only install can log in |
| 2026-09-04 | Drill: backup/restore (agent D) | PASS after 1 fix | archive 20 KB, manifest first; rename + new collection, restore with typed name → company name back, counts identical (30 collections / 322 docs). Fix: restore drops collections created after the backup |
| 2026-09-04 | Gate after drills | green | jest 112 suites / 1375 tests; lint 0 errors; env docs in sync |
| 2026-09-04 | PR #542 opened; AR-58 filed + In Review | done | MCP task.create without a list id failed schema validation → fixed (oldest live list); live check SPWC-11 created; jest 112 suites / 1376 tests |
| 2026-09-04 | Drill: Docker (agent E) | PASS after 7 fixes | image 1.56 GB, build ~3.5 min; compose from empty volumes healthy in 12 s; setup/complete 200 with session; restart keeps data and login; teardown clean. Fixes: dropped check-version COPY, pageContent alias file copied, 4 GB heap for the webpack build, thumbnail.json shipped, JWT_ALGORITHM/JWT_EXP env defaults, TURN guard moved into the coturn container, seed icons shipped |
| 2026-09-04 | Follow-ups (not in scope) | filed on AR-58 | History validation "UserId required" ×3 during the demo seed (Sprints/controller.js:173/235); wasabi "Some uploads failed" with empty detail; dead Modules/notification/routes.js; compose hardcodes container/volume names; restore leaves databases of companies created after the backup orphaned |
