# 075 — progress

## Checklist

- [x] PRD agreed (2026-10-30): both hosted and self-hosted get the layout; self-hosted keeps env names on hover; the own-SMTP link goes with the Mail tab.
- [x] Catalog: `CRON_TZ` is type `timezone`, refused unless `Intl` knows it (`err_timezone`); TURN fields owned by the customer.
- [x] `settingsLayout.js`: sections, provider/sign-in conditions, TURN login choice, time-zone list.
- [x] `InstanceSettingField.vue`: one row, with "When on / When off" and per-option descriptions.
- [x] `InstanceSettings.vue`: hosted hides locked rows and empty tabs; sections with notes, links and the address to paste.
- [x] Strings in `en.js`, backfilled; changed English values re-queued for translation; unused `managed_*` keys dropped.
- [x] Tests: catalog, ownership, precedence, controller, platform-provision (jest); `instanceSettingsManaged.spec.js` (vitest).
- [x] Checked in the browser on a hosted instance (:4210, local test DB): General, AI provider switch, Sign-in, Calling, Security.

## Decisions

- Hosted hides every `locked` row (managed, env, platform-pushed, read-only): the owner cannot act on any of them.
- ICU lists some zones under old names (`Asia/Calcutta`); the list shows the current ones (`Asia/Kolkata`), which the server accepts too.
- The TURN login choice is page-only: saving clears the method not picked, since the server prefers the shared secret when both are set.
- `tests/conventions/style-check.test.js` "baseline file is in the form style:baseline writes" fails on this Windows checkout from line endings; the file is untouched here.
