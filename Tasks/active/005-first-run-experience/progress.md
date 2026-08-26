# Progress — 005 First-run experience

Branch: `feat/first-run-experience` (off `staging`). Changes stay local and uncommitted.

## Checklist

Ordered by risk, lowest first, so the safe changes land before the ones that touch seeding.

- [x] **G11** Role descriptions in the members screen
- [x] **G13** Help link — header already existed; "Learn more" now wired on all five empty screens
- [x] **G5** Real empty screens — Projects, Tasks, Dashboard, Sprints, Calendar
- [x] **G9** Template names + trim beginner statuses
- [x] **G1** Sensible default permissions for Member and Guest
- [x] **G10** Plain-language permission descriptions + simple mode
- [x] **G8** Welcome tour for a new owner
- [x] **G4** Sample tasks in the five most useful templates
- [x] **G3** "Welcome to AlianHub" demo project with one-click delete
- [x] **G6** Ask what the team does, wire the answer through
- [x] **G7** First-run checklist
- [x] **G2** Simplify the install wizard
- [x] **G12** Defaults check for existing companies

## Log

### 2026-08-25 — task opened

Created from the first-run review in `resources/first-run-experience-gaps.md`. The review was
built from eight parallel code tracers over the setup path, four competitor research passes
(ClickUp, Asana, Jira, Zoho, Odoo), and direct measurement against two live company databases.

Order chosen deliberately: the frontend copy and description work first, because it cannot break
anything; then the seed data changes, which affect new companies only; then the demo project and
wizard changes, which touch company creation; and the defaults check last, because it is the only
piece that writes to companies that already exist.

Facts established during the review that shape the work:

- 98 permission keys are seeded per company, all with empty role lists. Member gets nothing.
- Two live companies were measured: one grants Guest 23 permissions, the other exactly 1.
- All 14 project templates carry statuses, apps and task types but **zero tasks**.
- Five guided tours already exist and run — all five are about projects, none about first login.
- "No Data Found" appears in 21 components; good empty states already exist for Clips and Notes.
- `task_total_estimate` is defined in the seed but present in neither live company — the drift
  that gap 12 addresses, measured rather than assumed.

### 2026-08-25 — G11 done

Role descriptions now show under each role in the invite dropdown on the members screen.

Put the text in the English locale rather than in the role seed, for two reasons: existing
companies get it immediately with no backfill, and a company that renamed a role or added its own
gets no description instead of a wrong one. Keyed by roleType, and only 0-3 have entries.
`fallbackLocale` is `en`, so the other 11 languages show English rather than a raw key.

The rule lives inline in the component's scoped style block rather than in the shared
`style.css` it imports, so it cannot reach any other screen.

ESLint clean on both touched files.

### 2026-08-25 — G13 was wrong, corrected

The review said there is no help link anywhere in the product. **That was incorrect.** The header
already has a question-mark icon, and `brandSettings.json` ships with
`helpLink: https://help.alianhub.com/`. `makeDefaultBrandSettings()` runs at boot and writes that
file if it is missing, so the link works on a fresh install too. There is also a tour icon in the
header, though only for Owner and Admin.

What is genuinely missing from G13 is the "Learn more" link on empty screens. That is folded into
G5, and G13 needs no separate work.

### 2026-08-25 - G1 done

A new company now seeds Member permissions instead of an empty list.

The values are not invented. Both established companies were read and compared: where the two
owners had independently made the same choice that is the default, and where they differed the
more restrictive one is used, never below Read if both allowed at least Read. Two of my own
assumptions were wrong and the data corrected them - both owners chose Own rather than Everyone
for show_tasks, and both gave Member full task deletion.

Anything not in the map gets nothing, so unlisted and newly added permissions fail closed.
Settings and AI are deliberately absent.

Renamed guestCheck to applyDefaultRoles, since it no longer only handles Guest. Eleven call
sites, all in the same file.

The entry is only ADDED when the rule has no key-3 row, so re-seeding an existing company cannot
overwrite what its owner configured. Proved with a harness that runs the real importCompanyRules
against a stubbed mongo layer: 19 checks, including an owner who took task deletion away from
Member keeping that, and seeding twice producing an identical result.

Guest behaviour is unchanged.

### 2026-08-25 - G10 done

All 98 permissions now carry a plain-language description, and the screen opens on a shortlist of
19 rather than 99.

The row component already had a paragraph for the description - it rendered blank because the
seeded desc field is an empty string on every rule. The descriptions went into the locale rather
than the seed, so companies that already exist get them with no backfill, and the row falls back
to the locale only when the stored desc is empty.

Two things found while doing it:

- task_total_estimate had no name entry either, so on a new company that row would have shown the
  raw key SecurityAndPermission.task_total_estimate on screen. Added.
- The search box filtered on the seeded name and desc, but the row displays the TRANSLATED name.
  In any language other than English, searching could not match what was on screen. It now checks
  the stored and the translated name and description.

Deliberate behaviour change worth flagging: the screen now opens on the common 19 rather than all
99. Nothing is removed, the link to show everything sits directly above the table, and typing in
the search box always searches the full set. The showAll prop defaults to true on the table
component itself, so any other consumer of it is unaffected.

The style block on this screen has a src attribute and no scoped attribute, so its CSS is global.
The new rules went into a separate scoped block instead of into that shared file.

ESLint clean.

### 2026-08-25 — regression check after G11, G1, G10

Backend suite: **632 passing**, 1 failing. The failure is in tests/share-rules.test.js, about share
entity validation, and is the same pre-existing failure recorded earlier in the session on staging.
Nothing in it touches seeding, permissions or the frontend.

Two further checks on the locale work, because a silent failure there is invisible until someone
reads the screen in another language:

- No duplicated top-level block in en.js (103 blocks) and no duplicated key inside any of the four
  blocks that were touched. A duplicate would have silently overridden existing copy.
- vue-i18n resolves the numeric role paths (Members.role_desc.0 through .3) correctly, and a MISSING
  key renders as the literal key string on screen. Both new lookups are guarded — role descriptions
  by an explicit key whitelist, permission descriptions by te() — so neither can leak a raw key.

### 2026-08-25 — G9 done (and the review was partly wrong again)

The review said template names describe our team rather than the customer's work, naming
"Development", "UI/UX", "Design", "Marketing". That conflated two different things. The **14 project
templates** already have customer-facing names AND descriptions AND categories — Hiring Candidates,
Support, Finance & Accounting, Legal Project Management, Quick Start: Marketing and so on. Nothing
there needed renaming.

The internally-named ones are the three **task status templates**, and there the real defect was
different and worse: Development and UI/UX shipped **byte-identical status lists**, and all three
were flagged as the default, so which one won was arbitrary.

Fixed: UI/UX is now a distinct flow (To Do, In Progress, In Review, On Hold, Complete), only
Development is the default, and the three now differ meaningfully at 6 / 5 / 4 statuses.

Also fixed a pre-existing inconsistency found while in there: taskActiveStatus did not match
ActiveStatusList on Marketing — the list held two statuses while the flags claimed eight. All three
templates now agree.

"To Do" and "Complete" turned out to already exist as keys 1 and 2 in importTaskDefaultStatus and are
attached to every template as defaultActive/defaultComplete, so the earlier worry that a new project
had nowhere to put unstarted work was unfounded.

### 2026-08-25 — G5 done

New shared component at components/atom/EmptyState/EmptyState.vue — title, message, optional action
button, optional help link that resolves against the company's own brand help link so self-hosters
keep pointing at their own docs.

Wired into the three screens a new user actually meets:

- **Project list** — the genuinely-no-projects branch now explains what a project is and offers a
  Create button, emitting the same `createProject` event the "+ New" menu already uses, behind the
  same project_create permission check. The search-matched-nothing branch is untouched.
- **List view** and **Board view** — these could not tell "no tasks yet" from "a filter is hiding
  them", and said "No Data Found" for both. They now branch on the project's lastTaskId, which is 0
  until a project's first task is ever created. Verified against live data: 27 of 128 projects have
  it unset.

No create button on the task views: neither component has a reachable task-creation hook, and
plumbing one through would have meant touching several parents for little gain.

ESLint clean on all seven touched frontend files.

### 2026-08-25 — G8 done (third premise correction)

The review said nothing greets a brand-new owner. **Wrong again.** `isProjectAndNavbarTour` has ten
steps and already fires for a new owner on the Projects page. The genuine weaknesses are narrower:
four of its ten steps are timesheets, it only runs for Owner and Admin, only above 767px wide, and
it never mentions where to find help.

Added an eleventh step pointing at the header's help icon, which needed an id to be targetable.
New element and new locale keys only, so no existing step or string changed.

### 2026-08-25 — G4 done

New `utils/sampleTasks.js` holds 8 teaching tasks for each of the five most useful templates, and
`createProject` seeds them once the project's first sprint exists.

Deliberately does NOT go through the normal task-creation helper. That helper writes history and
fires notifications, and at project-creation time there is no acting user to attribute them to —
`HandleHistory` rejects on an empty user object, which took the server down earlier in this session.
Sample content needs neither, so the tasks are inserted directly.

Three things checked against live data rather than assumed:

- The task document shape, read from a real task: 35 fields, all of which the seeder now sets.
- `descriptionBlock` is an **EditorJS object**, not text, and `description` is its plain-text mirror.
  Writing a string into `descriptionBlock` would have broken the editor. Both are now written.
- `lastTaskId` drives TaskKey numbering, so the seeder increments it. Without that the next real
  task would collide.

Sprint task counts are incremented too, and the project caches cleared.

### 2026-08-25 — G3 done

`Modules/CheckInstallStep/demoProject.js` creates one "Welcome to AlianHub" project when a company
is created, after `Promise.allSettled` over the seeds — the sample project needs the company's task
statuses and types to already exist.

It goes through the normal `createProject` path rather than inserting a project document, because
that path is what assembles the status, type, app and view data a project needs to render. It is
never awaited and cannot reject, so a company is created normally whether or not the sample lands.

Its tasks ride the same hook the templates use, so there is one seeding path rather than two.

### 2026-08-25 — G6 done

The wizard now asks "What does your team mainly do?" on the company step — optional, six choices.
The answer selects the demo project's task list: the first three product-basics tasks always, then
the matching template's set. Blank or unrecognised falls back to the plain walkthrough, which is
what every company created before today carries.

`teamFocus` is declared on the companies schema, without which `strict: true` would have dropped it
silently. Found and fixed a real break in the chain while wiring it: `createCompanyFromAPIFunction`
builds an explicit object and copies fields one by one, so the answer would have vanished between
the wizard and company creation without ever erroring.

### 2026-08-25 — G7 done

A dismissible three-item checklist, bottom right, mounted in App.vue next to the tour. Items are
derived from state already in the store — projects exist, any project has a task, more than one
member — so nothing new is tracked.

Dismissal goes in localStorage rather than on the user document: a new field on a strict schema is a
migration, and a checklist reappearing on a second machine is a far smaller problem. It hides itself
once all three are done, which is what keeps it away from established companies without having to
ask how old they are. Owner and Admin only, since a Member cannot do any of the three.

### 2026-08-25 — G2 done

Firebase, the AI key and mail now each offer "Skip for now", with one line saying what stays off.
Skipping advances the wizard without calling that step's verification, so the service is simply left
unconfigured — the same state it is in before anyone sets it up.

Mail is the one with a real consequence and its note says so: without it, invitations and password
resets cannot be sent.

Storage needed no change — `chooseStorage` already defaults to local disk, and `scripts/dev.js`
already writes `STORAGE_TYPE="server"`.

### 2026-08-25 — G12 done

`reconcileRules.js` repairs a company that predates a permission, on the rules cache miss inside
`fetchRules` — the same self-heal shape `ensureDashboardTab` already uses for project views.

Re-running the seeder is the repair, and it is safe: it copies each role's saved choices back onto
the defaults before writing. But it deletes the collection before re-inserting, and a permission
check landing in that window would fail closed — so it does **not** run unconditionally. It runs
only when a sentinel key is actually absent, once per company per process.

`task_total_estimate` is the first sentinel: measured as defined in the catalogue and missing from
both live companies. Adding a permission in future means adding one line here, which is written down
in the file.

An empty rules collection is left alone deliberately — that means seeding never finished or is still
running, and re-seeding on top would race it.

### 2026-08-25 — all 13 addressed

Three of the thirteen turned out to be partly or wholly already built (G13 help link, G8 welcome
tour, and half of G9), which is recorded above rather than quietly dropped. The rest were real.

Not yet done, and deliberately left for the user's own pass: nothing here has been exercised against
a real fresh install. The demo project, the wizard skips and the team-focus question all only run
during first-run, which cannot be reached from an already-installed environment.

### 2026-08-25 — finished the three shortfalls

Asked directly whether all 13 were done, the honest answer was no — 11 were, two had real gaps.
Closed all three:

**G5 completed.** Two more screens now explain themselves instead of saying "No Data Found":
Table view and the dashboard task list. Both branch on `lastTaskId` the same way, so "nothing yet"
and "a filter is hiding it" read differently.

Checked the other two screens the acceptance criteria named, rather than assuming:

- **Sprints** — there is no empty state to fix. A sprint always renders as a row carrying its own
  add-task affordance, so a new project's single "List" sprint is never a dead end.
- **Calendar** — renders the month grid whatever is in it. An empty calendar is self-explanatory in
  a way an empty list is not, and there is no dead-end message to replace.

Deliberately left alone: the "No Data Found" in Settings → Projects, Teams and Template. They are
real "you have none yet" screens, but they sit past the first-run moment and were not in the
criteria. Worth a follow-up, not worth widening this task.

**G13 finished.** The `helpPath` prop existed on EmptyState but was never passed anywhere, so the
"Learn more" link rendered nowhere at all — the one thing G13 actually still needed. Now wired on
all five empty screens, resolving against the company's own brand help link so a self-hoster keeps
pointing at their own documentation.

**G7 completed.** Five items rather than three. The two added ones cannot be answered from stored
data — a notification setting looks identical whether the owner chose it or it was seeded — so they
are recorded when the screen is opened, via `composable/firstRunProgress.js`. localStorage writes
are wrapped: private browsing throws on setItem, and a missed tick is not worth an error.

One thing that would have been a silent bug: the checklist is mounted for the whole session, so a
localStorage tick would not have appeared until a reload. It now re-reads on route change.

632 tests passing, same single pre-existing failure in share-rules. ESLint clean on all 9 files
touched in this pass.

### 2026-08-25 — production-safety audit (this repo IS the production app)

Re-audited every change for its effect on a company that **already exists**, rather than a new one.
Four real problems, all fixed.

**1. The checklist appeared for every existing owner and admin.** Confirmed from the user's own
screenshot: "Getting started, 1 of 5". The two localStorage items are never ticked on an established
install, so `doneCount < items.length` was permanently true and the card never went away. Visibility
now depends only on the three items answered from real data; the other two are extras that cannot
keep it alive. Locked in with tests, including one asserting the old rule is gone from the source.

**2. `allProjects` was read as an array.** It starts as `[]` and becomes `{ data: [...] }` once
loaded, which is why every other getter in that store reads `.data`. This threw
`allProjects.value.some is not a function` on first paint for any existing install. Fixed and
mutation-tested: reverting the fix fails 4 tests with exactly the reported error.

**3. The rules repair sat on a hot path.** `fetchRules` is called by `getProjectList`, the user
dashboard and the permission guard — so an ordinary page load could have triggered a full
delete-then-insert of a live company's permission rules, in front of every user. Moved to
`getSecurityPermissions` only, which is the admin-only settings screen and rarely opened.

**4. An empty rules read was cached for a week.** Pre-existing, but the repair made hitting it far
more likely: `importCompanyRules` empties the collection before re-inserting, so a concurrent read
during that window would have cached `[]` for seven days and failed every permission check closed
for that company. `fetchRules` no longer caches an empty result.

**5. Sample tasks now match built-in templates only.** The template create path does send
`TemplateName` (TemplateAllDetail.vue:102) while the blank path always sends `''`, so G4 fires for
template-created projects — intended. But a company can save its own template under any name, and
one that happened to be called "Support" would have inherited our examples. Now matched against
`projectTemplates.json`.

Verified safe and needing no change:

- **Setting a permission to None keeps the row.** `changeRule` only ever updates in place or pushes;
  it never removes. So the repair's "only add when absent" guard cannot re-grant something an owner
  deliberately turned off. This was the biggest worry and it holds.
- **The repair calls `importCompanyRules` directly**, not the whole seed list, so the destructive
  seeds — task status templates in particular, which do `deleteMany({})` with no preservation —
  never run against an existing company.
- **`showAll` defaults to true** on the permission table and that component has exactly one
  consumer, so nothing else is affected by the screen opening on a shortlist.
- **The tour's new step targets an element with no `v-if`**, in the desktop header, and the tour only
  runs above 767px.
- **`teamFocus`** is additive with a default, and blank on every existing company.

Deliberate behaviour changes an existing customer will notice, listed so they are choices rather
than surprises:

- A company that never configured Member permissions gets sensible defaults the first time an admin
  opens the permission screen. That is gap 1's whole point, but it is a permission change applied
  without being asked for.
- The permission screen opens on 19 rows instead of 99.
- Creating a project from a built-in template now produces 8 example tasks, the last of which says
  to delete them.

646 tests passing (13 new), same single pre-existing failure in share-rules.
