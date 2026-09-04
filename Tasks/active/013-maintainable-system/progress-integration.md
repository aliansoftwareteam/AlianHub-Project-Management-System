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
