# Progress: 092 — Time reports: pick a whole team in the People filter

## Checklist

- [x] Pure helpers: `teamOptions` in `report/reportFacets.js`; `groupState`, `toggleGroup`, `groupMatching` in
      `views/Everything/filterGroups.js`.
- [x] `EverythingFilterChip.vue`: optional `groups` (+ `groupsLabel`, `optionsLabel`) drawn as a section above
      the options; ticked / partly ticked / empty; Find covers both; chip reads the team name when the pick is
      exactly one team.
- [x] `ReportFilterBar.vue`: People gets the store's teams (kept to the listed people), none when `singlePerson`
      (Mine).
- [x] i18n: `Reports.filter_teams`, `Reports.team_people`, `Everything.some_picked`; backfill run.
- [x] Tests: `tests/report-filter-facets.test.js` (teamOptions), `frontend/tests/unit/reportPeopleTeams.spec.js`
      (group helpers, chip, bar wiring).
- [x] Checks: `i18n:check`, `style:check`, ESLint on the changed files.
- [x] Visual check of the real chip with the app's CSS: dark + light, desktop + phone bottom sheet.
- [x] Check in the running app on Project, Workload, Tracker, Approvals and Variance with real teams.
- [ ] Delete the two TechNova test teams on the demo DB when the owner says (no team delete in the app).
- [x] Keep the local `alianhub-demo` entry in `.claude/launch.json` out of the commit.
- [x] Branch `feat/report-people-filter-teams` on `origin/staging`; PR into `staging`.

## Last step

PR into `staging` opened; two test teams stay in TechNova for now.

## Blockers

None.

## Log

### 2026-11-12
- Task created from the owner's request (screenshot of Workload's People filter).
- Decision (owner): a team pick adds its members to the People selection. The URL, any/all match, narrowing,
  data and export stay on people; no backend change. A link keeps the people picked when it was made.
- Mine left out: its People filter holds one person.
- Unticking a team keeps members that another fully ticked team still holds.
- Verified the chip in a throwaway Vite page with tokens.css and the Everything/report CSS: team pick, partial
  state after unticking a shared member, re-pick, two overlapping teams, Find "de" (teams + people), chip
  summary, screen-reader name "Mobile, 4 people, some picked".
- Ran this branch locally on :4000 against the demo DB (demo `.env` with MIGRATIONS_AUTO/CRON/inline queue/
  indexer off, AUTOMATION_ENGINE=false; 0 running agent runs checked first). With the owner's OK, created two
  teams in TechNova: Engineering (Chloe, Leo, Nina, Omar) and Product (Aisha, Grace, Omar).
- Workload: ticking Engineering showed only its 4 people, URL listed them, chip "People · Engineering",
  Product partly ticked. Project, Tracker, Approvals carried the pick and showed both teams; Variance:
  ticking Product picked 3 people. Mine shows no Teams section.
- The app has no team delete (no route, no button). Owner chose to keep the two teams for now.
