---
id: 040
title: Store each reference id in one form, with a migration
status: backlog
priority: medium
depends_on: []
created: 2026-09-26
---

# Store each reference id in one form, with a migration

## Goal
Every field that points at a project, sprint, folder or task is stored in one form, in every collection.
Then a query written with either form finds the same rows, and code no longer needs to match both
forms. Source: follow-up 124 (`Tasks/active/034-end-to-end-qa-programme/followups.md`) and the
survey of `origin/beta` at `6ae0b891`.

## What the survey found
- Mongoose converts values to the declared type on save, find and update, but not inside aggregate
  pipelines or in `Mixed`, `Object` or untyped `Array` paths. Legacy documents from before the schema
  may hold either form.
- **Project id**: ObjectId in tasks, comments, sprints, folders, epics, pages, forms and 8 more; String
  in timesheet, history, estimatedTime, milestone, notifications, mentions, projectRules, calls,
  userDashboard and the agent collections; `Mixed` in customFields (one id or an array).
- **Sprint id**: ObjectId in tasks, comments, importJobs, forms and knowledgeChunks; String in
  notifications, mentions, calls, recurringTasks and emailInboxes. `sprintArray` is an untyped Object
  whose `.id` and `.folderId` are never converted; `Sprints/controller.js:407-408` writes `folderId` as
  an ObjectId, so that nested field now holds both forms.
- **Folder id**: ObjectId in tasks (`folderObjId`), sprints and comments; String in notifications and mentions.
- **Task id**: ObjectId in reminders, intakeItems and pages; String in tasks.ParentTaskId, history,
  timesheet, estimatedTime, notifications, mentions and the agent collections; `Mixed` in
  comments.taskId (an ObjectId, or the literal `'default'`).
- **Company and user ids**: mostly String; tasks.CompanyId is an ObjectId. These are out of scope (below).
- **Unique indexes over these fields** (projectContracts `{ProjectID, deletedStatusKey}`,
  projectInvoices `{ProjectID, number}`, agentFindings `{taskId, factId}`) would treat both forms of one
  id as two different values. The agentRuns partial unique index filters on `taskId: {$type: 'string'}`.

## Scope

### Phase 1: fix the read paths that match one form only (no data change)
These can silently miss rows today, so each is fixed on its own, with a failing test first:
1. `Modules/Tasks/helpers/taskMongo/internals.js:159`: an aggregate `$match {ProjectID: projectId}`
   gets the request's raw string (from `create.js:85`), and aggregates do not convert, so no task rows
   match. The sibling branch at `:203` wraps the value in an ObjectId.
2. `Modules/Comments/controller.js:132, 201, 257, 540-545`: ObjectId-only filters on the `Mixed`
   comments.taskId.
3. `Modules/Comments/controller.js:405`: a `$lookup` from `sprintArray.folderId` to `folders._id`
   joins only the ObjectId form.
4. `Modules/projectSetting/controller.js:418, 432, 474`: string-only matches on `sprintArray.id` and
   `.folderId` miss the ObjectId form that `Sprints/controller.js:408` writes.

### Phase 2: one stored form per field
- **Canonical form: ObjectId** for project, sprint, folder and task references, because they point at
  `_id` values that are ObjectIds, and `$lookup` needs both sides in the same type. Exception: fields
  that hold non-id values (comments.taskId `'default'`, sprint-channel notifications that store a sprint
  id in `taskId`) keep their meaning. Those fields are split, or their sentinel is documented and
  handled, as each migration decides.
- **Per field, in this order:** declare the canonical type in `utils/mongo-handler/schema.js` →
  change the writers → one migration (`migrations/044-...` onward, `scope: 'company'`, idempotent:
  only documents still in the old form are touched, with `verify` reporting documents left in the old
  form) → keep reading both forms for one release → remove the both-forms code. One PR per field
  group, starting with sprintArray `.id`/`.folderId` (both forms already stored in one field) and then
  project ids in the String collections.
- **Indexes:** each migration checks that converting creates no duplicates under the unique indexes
  above, and reports them if it does, rather than failing halfway. The agentRuns partial index
  filter changes together with its field.
- **The generic `/api/v1/mongoOpration` route**, whose client chooses the form through the `objId`
  wrapper (77 uses in 35 frontend files): writes to migrated fields are converted on the server, so
  the client wrapper stops mattering for them.

## Out of scope
- Company and user ids, which are mostly String and whose forms mostly match. This includes
  tasks.CompanyId (an ObjectId) unless a Phase 2 migration touches the same documents anyway.
- The three `strict: false` collections (the userId counters, customFields, subscriptions), except
  customFields.projectId if Phase 2 reaches it.
- Changing API payloads. Clients may keep sending strings, and the server converts them.

## Acceptance criteria
- [ ] Phase 1: each of the four read paths has a test that fails on beta and passes after, one PR each.
- [ ] Phase 2, for every migrated field: the schema declares one type; every writer is covered by a
      test that the stored value has that type (checked against the real schema, not fakeMongo); the
      migration is idempotent (the "safe to run twice" test in `tests/migration-*.test.js`) and its
      `verify` reports zero documents in the old form; a dry run (`npm run migrate -- up --dry-run`)
      lists the counts per company before the real run.
- [ ] After the one-release period, the both-forms matching for that field is removed. A convention
      test fails if a `$in: [x, new ObjectId(x)]` pattern returns for a migrated field.
- [ ] `docs/BETA-LOG.md` and the upgrade steps in `Tasks/HANDOFF.md` name each migration and its dry-run
      command.

## Constraints & notes
- Migrations run at server start unless `MIGRATIONS_AUTO=false`, and stop at the first failure. Each
  company database is its own tenant, so a failing tenant makes the whole migration re-run: every step
  must be idempotent.
- History and notifications are likely the largest collections, because they are written on every task
  event. Batch their updates and log progress per company.
- The owner confirms this PRD, the canonical form and the Phase 2 order before any Phase 2 code.
  Phase 1 fixes are ordinary bug fixes and can start once this PRD is confirmed.

## Resources
- The survey is summarised above; the file:line references are from `origin/beta` at `6ae0b891`.
