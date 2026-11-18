# Progress: Agent settings page — tabs, a searchable project picker and one sticky Save bar

## Checklist

- [x] Tabs with `?tab=` and the `?rev=` jump
- [x] Sticky Save bar with the unsaved state and tab dots
- [x] Skills: chosen first, the rest folded
- [x] Projects: search, count, Chosen only, Choose shown / Clear, scrolling grid
- [x] Autonomy in a 2×2 grid
- [x] i18n keys and backfill; `style:check` baseline
- [x] Unit tests; checked in the browser

## Last step

Committed on the branch (tabs only) and checked against the demo data in the real app; not pushed and no PR yet.

## Blockers

None.

## Log

### 2026-10-27
- Task created from the request to shorten the agent page (screenshot of a workspace with about 100 projects).
- Built: tabs (Skills, Projects, Autonomy, Limits & schedule, Recent runs, History, Delete), the sticky Save bar with "Unsaved changes" and per-tab dots, the folded skill library, the project search grid and the 2×2 autonomy grid. 20 keys in `Ai`, backfilled.
- Decision: unticking and re-ticking a project is not a change (project ids are compared as a set), so the dot and Save agree.
- Found while checking: the revision link inside a run's detail sits on this page, so the page stays mounted when `?rev=` changes; a watcher now switches to History.
- Checks: `agentSettingsTabs.spec.js` (15 tests) and the existing agent page specs pass; `i18n:check`, `style:check` and ESLint pass. In the agent-related vitest run, `firstPaintSet` and `listSearchPlainText` fail on Windows path assumptions unrelated to this page.
- Browser: desktop (dark theme) and 375 px phone; no page-level sideways scroll, tab bar scrolls, Save stays pinned, a member sees five tabs and no Save.
- Ran the real app locally against the demo database (TechNova › Bug Triager): tabs, `?tab=`, project picker and Save bar behave on real data.
- Tried and dropped at the user's call: moving Recent runs out of the tabs (a panel beside the settings, then behind a toolbar button, then a full-height panel down the right edge, with runs opening in a drawer). Recent runs stays a tab. Worth keeping if it comes back: the month's spend sums every run of the workspace, so it should not be re-read on a 15 s poll, and `GET /agents/runs` has no cursor, so runs older than the newest 200 cannot be paged.
