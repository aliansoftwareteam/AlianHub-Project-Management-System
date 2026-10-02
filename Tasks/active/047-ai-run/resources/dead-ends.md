# 047 S-5 — dead ends: the audit

Date: 2026-10-01. Read against `chore/integrate-046-batch-5`.

**The rule.** A new person is never stopped by a missing setting. When one is missing the server takes the company's own default, or the answer says in plain words what is missing and what to do. "You cannot do this" stays a refusal; no permission or access check was changed.

**How it was read.** For each kind a person creates in the first hour: every `required: true` path of its schema in `utils/mongo-handler/schema.js`, and every refusal on its create route that names a setting, a default or a precondition. The verdicts are DEFAULT IT (fixed here), EXPLAIN (the answer now names the cause), ALREADY (a default or a message existed before this slice), LEAVE (not a dead end, with the reason) and LEFT (needs a decision; the question is at the end).

## One finding first: what "the company's currency" is

A row of `currency_list` carries `isDefault` and `isDelete`. `isDelete: true` does **not** mean deleted. The settings screen (`SettingCurrencys.vue`) sets it to `true` when a currency is added to the company and to `false` when it is removed, and the project currency picker (`Currency.vue`) lists the rows where it is `true`. The seeded default (`utils/currency.json`, INR) is `isDefault: true, isDelete: true`.

The duplicate fix of this morning looked the default up with `{ isDefault: true, isDelete: { $ne: true } }`, so on a seeded company it found nothing and the copy got an empty currency. It no longer failed, but it did not get the company's currency either. The lookup now lives in one place, `Modules/Company/helpers/companyCurrency.js`, and reads the flag the way the screens do:

1. the default, when the company uses it;
2. else the only currency the company uses, when there is exactly one;
3. else the default, though it was switched off;
4. else nothing (`{}`), which the project schema accepts.

The web form uses the same rule (`frontend/src/utils/companyCurrency.js`).

## The table

| Kind | What stopped the person, or what they saw | Verdict | What was done |
|---|---|---|---|
| Project (duplicate) | The copy of a project with no currency got an empty currency on a seeded company, because the default lookup excluded currencies in use. | DEFAULT IT | The shared lookup. A source whose currency is an empty object now counts as having none. |
| Project (create) | `ProjectCurrency` is required. The web form sent the row whose code is `"INR"`, hard-coded, or `{}` when the currency list had not loaded; a body with no currency failed the save. | DEFAULT IT | `createProject` takes the company's currency when the body names none or an empty one. The form picks by the same rule instead of by `"INR"` (`CreateProjectSidebar.vue`, `TemplateAllDetail.vue`). |
| Project (made by the AI) | Every AI-generated project was created in USD, hard-coded in `AIProjectGenerator/orchestrator.js`. | DEFAULT IT | The generator reads the company's currency with the rest of its context. |
| Project (create) | A body without `customFiedlsValue` failed with `"undefined" is not valid JSON`. | DEFAULT IT | No custom fields is read as none. |
| Project (create) | Any failure answered `statusText` as a nested object (`{ status, statusText: <ValidationError> }`); the web shows "The project couldn't be created. Try again." | EXPLAIN | The answer is a sentence: "The project was not created: ProjectType, statusType are missing." The web banner is unchanged, see LEFT 1. |
| Project (create) | `ProjectType`, `statusType`, `ProjectRequiredDefaultComponent`, `projectIcon` are required and sent by the form as constants (`"Fix"`, `"active"`, the template's default view, a colour from the name). | LEAVE | The form always sends them, and a caller that does not is now told which are missing. A server default for the billing type is a decision, see LEFT 2. |
| Project (create) | No template named (`useTemplateProj` and `TemplateId` absent) answers "error in getting template without category". | LEFT | See LEFT 3. The form always names one. |
| List | Required: `name`, `projectId`, `private`, `deletedStatusKey`. | ALREADY | `addSprintFun` fills `private` and `deletedStatusKey`; a new project gets its first list from the server. |
| Folder | Required: `name`, `projectId`, `deletedStatusKey`. | ALREADY | The server fills `deletedStatusKey`. |
| Task, subtask | Status, type, priority, key and leader are required and come from the composer. The list and board composers picked the status marked `default_active` and nothing else, so a project with no status marked that way sent a task with no status, which the schema refuses. | DEFAULT IT | Both composers use the rule quick create and the server-side creators already use: the opening status, else the first one (`defaultStatus` in `quickCreateTask.js`). |
| Task (other composers) | Voice to task, note to task, message to task and the chat composer still read `default_active` only. | LEFT | Same one-line change in five files, none of them a first-hour path. See LEFT 4. |
| Task (by a connected agent, a form, mail-in, a recurring rule, an automation) | — | ALREADY | Each picks the project's opening status, else its first. An automation on a project with no statuses says "project has no statuses". |
| Subtask | A parent on the third level, or a parent that is gone. | LEAVE | A clear refusal already ("says the reason the server gave", `createTaskTreeRefusal.spec.js`). Not a setting. |
| Doc | `title` is required: "A title up to N characters is required." | LEAVE | The web sends "Untitled" from i18n; a server default would be an English word in the database. The message is clear. |
| Field | `fieldType` and `type` have schema defaults. | ALREADY | Nothing required of the person beyond the field itself. |
| View | `name` is required; `userId` is the caller. At most N views: "A person can keep at most N views." | LEAVE | A limit said clearly, not a setting. |
| Goal | `ownerUserId` and `visibility` are filled by the server ("needs only a name"). | ALREADY | — |
| Goal (money target) | A money target with no currency code was refused: "targets.0.currencyCode is required". On the web the picker started at "Choose a currency" and refused the form until one was chosen. | DEFAULT IT | The server counts the target in the company's currency when it names none (create and add target). The form starts on the company's currency. In a company with no currency at all the refusal stays and names the field. |
| Time entry | `companyOwnerId` is required of the request and used only to copy the owner in on the notice. A page that had not loaded the owner (`useTimer.js`, `TaskTimerChip.vue` send `""`) got "companyOwnerId is required" and nothing was logged. | DEFAULT IT | `manualLogTime` and `deleteManualLogtime` look the owner up when the request names none (`Modules/Company/helpers/companyOwner.js`, the lookup project history already used). |
| Time entry | `LogDescription` is required. | ALREADY | The web sends a default note when the person writes none. |
| Time entry | `dateFormat` is required. | ALREADY | The web falls back to `DD/MM/YYYY` when the company chose none. |
| Time entry (timer under a minute) | Nothing was logged and nothing was said. | ALREADY | "Timer under a minute — nothing logged" (`TaskPanel.timer_too_short`). |
| Time entry (approved week) | A timer in an approved week refuses only at Stop. | LEFT | A permission-like refusal, said clearly; refusing at Start is a behaviour change. See LEFT 5. |
| Time entry (desktop tracker) | `tracker.js` still requires `companyOwnerId`. | LEFT | The desktop app is a separate client that always sends it; not a first-hour path. See LEFT 6. |
| Comment | `project`, `type` come from the composer; `userId` is the caller. | ALREADY | Nothing depends on a setting. |
| Invite | Mail cannot go out when SMTP is unset. | ALREADY | The invite is saved and answered with its join link; the web says "Couldn't email this invite. Copy the join link instead." (`invite-mail-fallback.int.test.js`, `membersInvite.spec.js`). |
| Invite | `designation` is required by the route. | ALREADY | The form sends 0 when none is chosen, and hides the picker in a company with no designations. |
| Import dialog | Could not list a project's lists on a fresh load. | ALREADY | Fixed in #1373, on this branch's base. |
| Working days | A project or a company with none. | ALREADY | `workingDaysFor`: the project's, else the company's, else Monday to Friday. |
| AI not configured | "AI is not integrated in your system", "No AI provider is configured." | LEFT | T-1 owns this ("no AI surface looks broken without a server key"). Not touched here. |
| Storage not configured | Not read in this slice. | LEFT | See LEFT 7. |
| Gantt drag on the Weeks scale | Snaps back with no message (benchmark run 2). | LEFT | Not a missing setting; needs the Gantt owner. See LEFT 8. |
| Empty list | "Cannot tell why it is empty" (benchmark run 2). | LEFT | Belongs to S-4 and the empty states. |

## The rule for the future

`tests/no-dead-ends.test.js` holds two things.

1. **The walk.** A company seeded with nothing but its members and (in some cases) the currency list creates a project, builds the document of an AI-made project, and creates a goal with a money target and a time entry. Every save in that file is held against the real schema, so a missing required field fails the test the way Mongoose fails the write.
2. **The ratchet.** For each of the eleven first-hour schemas, every required field with no schema default is listed under who supplies it: `given` (the person), `server`, or `form` (sent by the web form from the project or the company, never typed). The test compares that list with the schema. A new required field fails it until someone says who supplies it.

What it is not: a walk of all twelve kinds through their real routes. The list, folder, task and comment routes are legacy handlers with many side effects (history, notices, counters, sockets); driving them needs a mock for each, and such a test would mostly test its mocks. The ratchet is the cheap part that holds for all of them.

## LEFT, with the question

1. **The create-project banner.** The server now gives a sentence, in English. Should the banner show it, or should each cause get its own translated line? Today: "The project couldn't be created. Try again."

   **Answer (second pass, for the owner to review): keep the translated banner; add one translated line per cause later.** Reason: the server's sentence is English, and every sentence a person reads goes through i18n. Not built: it needs the server to answer a cause code.
2. **Billing type of a project.** The web always sends `ProjectType: "Fix"`. Should the server take that as the default for a caller that names none, or should it be a company setting?

   **Answer: the server takes `Fix` when a caller names none.** Reason: it is what the web form always sends, so an API caller gets what the form gives, and no new company setting is needed. Not built: server change.
3. **No template named.** Should a create with no template mean the Blank template? It is one line, but it changes what an API caller gets.

   **Answer: yes, no template named means the Blank template.** Reason: the form already treats Blank as the default; refusing a caller who names nothing helps nobody. Not built: server change.
4. **The other five composers** (voice, note, message, chat, comments). Apply the same opening-status rule? No risk seen; left out to keep this slice to the first hour.

   **Answer: yes, the same opening-status rule.** Reason: no risk was seen and the other composers already agree with it. Built: voice, note, message, chat and comment composers use `defaultStatus` (`composerOpeningStatus.spec.js`).
5. **Timer in an approved week.** Refuse at Start instead of at Stop?

   **Answer: refuse at Start, naming the week.** Reason: a person should not run a timer that will be refused later. Not built: the web does not know the week is approved without a server answer.
6. **Desktop tracker and `companyOwnerId`.** Look the owner up there too? Better still: stop taking the owner from the request anywhere, since project history already ignores it.

   **Answer: yes, look the owner up there too, and stop taking it from the request.** Reason: project history already ignores the request's value. Not built: the desktop app is a separate client.
7. **Storage.** What does a person see when they attach a file and storage is not set up? Not read here.

   **Answer: say that storage is not set up, and who can set it up, in the same place as the attachment.** Reason: the person should read the cause where they met it. Not built: the web has no signal that storage is missing; it needs the server to answer a cause code.
8. **Gantt drag on the Weeks scale.** Say why it snaps back, or allow it?

   **Answer: say why, do not allow it.** Reason: a week-wide scale cannot place a bar on a day; letting it would move dates by guess. Built: a drag that ends on the dates it began on tells the person "the bar went back because this scale moves it a week or more at a time. Switch to Days to move it by a day" (`ganttDragSnap.spec.js`).
9. **Choosing the company's default currency.** No screen changes `isDefault`; it stays on the seeded INR. The lookup above gets the right answer for a company that uses one currency. A company that uses several and has switched INR off still gets INR. Should the currencies screen let an owner mark the default?

   **Answer: yes, the currencies screen lets an owner mark the default.** Reason: the lookup already reads `isDefault`, so the screen is the only missing piece. Not built: needs a server route.
10. **`isDelete` on a currency.** The name says the opposite of what it means. Rename it (a migration), or leave it and keep the comment in the two helpers?

   **Answer: leave the name, keep the comment in the two helpers.** Reason: a rename is a migration for no change a person sees; the cost is a confusing name. Not built.

These ten answers were made without the owner, by choosing the least surprising option. They are reversible; the owner may overrule any of them.
