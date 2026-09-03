# Progress: Automation sentence builder UI + v2 rule API

## Checklist
- [x] `ruleSchemaV2.js` validator with field-level errors
- [x] v2 CRUD endpoints + routes
- [x] `AutomationsPage.vue` — list + sentence builder
- [x] Route, env constant, i18n keys
- [x] Unit tests for the validator
- [x] API verified end to end with a real authenticated request
- [ ] **Visual verification in a browser** — blocked, see below
- [ ] Dry run ("test on a real task" + "would have matched N times")
- [ ] Run-history drawer

## Last step
Built and API-verified. The rendered page has not been looked at.

## Blockers
Visual verification needs a signed-in browser session. The route is behind `requiresAuth`,
and signing in means entering the account password — not something Claude does. Needs the
user to log in and open `/:cid/automations`.

## Log

### 2026-08-24
- Task created after the fact: the UI was built in the same session it was requested, so the
  PRD documents what was built rather than gating it. Recorded here for honesty about
  CLAUDE.md Rule 2 rather than pretending the order was cleaner than it was.

**Verified**
- 10/10 validator unit tests.
- 10/10 live API checks against the running instance with a real JWT (a session row had to
  be seeded — `checkToken` requires `uid` + `refreshToken` plus a matching sessions
  document; no password involved, and the row was deleted afterwards):
  registry authenticated (200), manifest carries 3 actions, an invalid rule came back with
  `["name: required","steps: at least one action is required"]`, create returned
  `enabled:false`, the summary read `Task status changes → Add a comment`, list/toggle/runs/
  delete all behaved.
- `npx vue-cli-service build` succeeds and emits `Automations.e12221e9.js`; both the page
  chunk and `index.html` serve 200.
- Full suite 698/699 — the one failure is the pre-existing `share-rules` staleness.

**Not verified**
- Nobody has looked at the page. It compiles and its API works; whether the layout is right,
  the selects populate, and the flow feels like fifteen seconds is unknown.

**Note on the build**
`vue-cli-service build` wipes `frontend/dist` before writing it, so the app served 404s for
roughly five minutes mid-build. Worth knowing before running a build against an instance
someone is using.
