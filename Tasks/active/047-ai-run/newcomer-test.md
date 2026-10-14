# 047: the newcomer test (S-6)

Written 2026-10-02 against `beta` as of pull request #1412. Tracker: AP-441, sprint "047 wave".

This is the script only. No session has been run yet.

What it is for: finish lines nine and ten in `task.md`. A person who has never seen the product goes from sign-up to a running project, and nobody helps.

`task.md` names the result file `newcomer-tests.md`. This script is `newcomer-test.md`. Results can go at the end of this file, or in that one.

## Who takes part

- **The newcomer.** A person who has never used AlianHub. For the first run it may be a QA agent that plays one: it reads only what is on the screen, never opens a help page and never types an address by hand. Real people as testers are the owner's call.
- **The observer.** Says each goal, runs the clock and writes things down. The observer does not help.

## Before the session

The observer checks these and writes the answers at the top of the score sheet.

1. **The build.** Which build is running.
2. **A new account is possible.** The newcomer needs an account that has never been used. To check: whether the local build lets a person create an account and a workspace without an invitation, and whether sign-up needs an email that the build cannot send.
3. **Which path for the AI.** Choose one before the session and keep to it.
   - **Path A, connect.** The newcomer has Claude and connects it in task 2. This needs the flags of `ai-benchmark.md` to be on, and the address to be reachable by Claude. To check.
   - **Path B, skip.** The newcomer skips "Connect your AI" in task 2 and works by hand.
4. **How a project is described (task 3).** To check, per path:
   - Path A: the first sentence the product offers is "Set up my project". Today the connected AI cannot make the project itself. It asks the person to make it under Projects and then fills it with lists and tasks.
   - Path B: "Create project with AI" exists in the web app and needs a server key. Without a key the newcomer makes the project by hand with "New project".
5. **A proposal for task 8.** One agent proposal must be waiting for the newcomer when task 8 starts.
   - Path A: the observer's goal in task 8 makes one. Adding a field always waits for approval.
   - Path B: to check how to seed one for a brand-new account. Two candidates: the project's "Project manager" switch, or a proposal filed by the observer with a token.
6. **A second address for task 10.** A test address the observer owns. If the build has no mail server, the invitation cannot be delivered. To check what the screen says then.
7. **The tour.** A short first-visit tour may start by itself. Do not switch it off. Write down what the newcomer does with it.
8. **The menu.** A new account should start on "Simple", with five places on the menu. To check on the account used. Task 9 is written for that start.
9. **The screen.** A desktop window. A phone-width run is a separate session.

## Rules for the observer

- Say the goal, word for word, and nothing else. Never say where to click, and never name a screen, a menu or a button.
- If the newcomer asks a question, answer: "Do what you think is right." You may repeat the goal.
- Start the clock when you finish saying the goal. Stop it when the pass rule is true on the screen.
- Ask the newcomer to think aloud. Write down their words, not yours.
- **Stopped** means one of three things: no action for 60 seconds, the newcomer says they do not know what to do, or the time limit passes.
- When the newcomer is stopped: write down the screen and the words on it. Then give the smallest hint that gets them moving, and mark the task "helped". A helped task is not a pass.
- **Help** means any of these: a hint from the observer, a help page opened, or a task finished by following the tour.
- **A settings page** is any screen under Settings or My settings. Write down each one the newcomer opens, and in which task.
- Do not fix anything during the session. Every stop becomes a finding afterwards.

The story to tell the newcomer before task 1, once:

> "You lead a small team. Next month your team moves to a new office. You want one place to plan the move. I will give you ten goals, one at a time. Do each one the way you think is right. I cannot help you, and there are no wrong answers. Please say aloud what you are thinking."

## The ten tasks

For every task, write down the same three things:
- **First wrong click:** the first thing clicked that did not lead toward the goal, and what the newcomer expected it to do.
- **Words not understood:** any word on the screen the newcomer asks about, reads twice or says aloud with doubt.
- **Where they stopped:** the screen and the words on it, if they stopped.

### Task 1: sign up

- **The observer says:** "Create an account for yourself and get into the app."
- **Pass rule:** the newcomer is signed in and sees the first screen after sign-up, without help, in under 2 minutes.
- **Also write down:** how many fields the form asked for, and any field the newcomer did not know how to fill.

### Task 2: connect your AI, or skip it

- **The observer says, path A:** "You use Claude. Link it to this app so it can work for you."
- **The observer says, path B:** "You do not want to link anything right now. Move on."
- **Pass rule, path A:** the screen says the AI is connected, without help, in under 3 minutes.
- **Pass rule, path B:** the newcomer has moved past the offer and is inside the app, without help, in under 1 minute.
- **Also write down:** whether the newcomer understood what connecting gives them, in their own words. On path A, each place they had to leave AlianHub and come back.

### Task 3: make a project by describing it

- **The observer says:** "Get a project for the office move into the app. Describe it in your own words and let the app do the rest."
- **Pass rule:** a project for the office move exists and is open on the screen, without help, in under 3 minutes.
- **Also write down:** what the newcomer typed or said, where they typed it, and how much of the project was made for them and how much by hand.

### Task 4: add tasks

- **The observer says:** "Put three things that have to be done for the move into your project."
- **Pass rule:** the project shows three tasks with the names the newcomer chose, without help, in under 2 minutes.
- **Also write down:** how they added the second and third task. The same way as the first, or a faster way they found.

### Task 5: assign

- **The observer says:** "Make yourself the person responsible for one of them."
- **Pass rule:** one task shows the newcomer as its owner, without help, in under 1 minute.
- **Also write down:** the word they looked for. For example "owner", "assign" or "responsible".

### Task 6: set a date

- **The observer says:** "That one has to be finished by next Friday. Make the app know that."
- **Pass rule:** the same task shows next Friday as its date, without help, in under 1 minute.
- **Also write down:** whether the date picked was the right Friday, and whether a time was added that they did not ask for.

Stop the first clock here. Tasks 1 to 6 are the "running project" part.

### Task 7: find what to do next

- **The observer says:** "You have just sat down at your desk. Find out from the app what you should do first today."
- **Pass rule:** the newcomer points at the line or card that answers it and reads it aloud, without help, in under 1 minute. On Home this is the "What next" line.
- **Also write down:** where they looked first, and whether they could say why the app suggests it.

### Task 8: approve an agent's proposal

- **The observer says, path A, first:** "Ask your AI to add a place on your tasks to note the budget."
- **The observer says, both paths:** "Something in the app is waiting for your yes or no. Find it, read what it will change, and say yes."
- **Pass rule:** the proposal is approved and the change is visible, without help, in under 2 minutes. In the Inbox this is the "Needs your approval" tab.
- **Also write down:** whether the newcomer could say what would change before they approved, and who proposed it.

### Task 9: switch Simple mode off and on

- **The observer says:** "The menu shows only a few places. Make it show every place the app has. Then put it back the way it was."
- **Pass rule:** the menu showed every place, and then the short menu again, without help, in under 2 minutes. The two choices are named "Simple" and "Full".
- **Also write down:** where they looked for it first. This task needs My settings, so it is not counted against the "no settings page" rule.

### Task 10: invite a person

- **The observer says:** "A colleague will help with the move. Bring them into your workspace. Their address is (the test address)."
- **Pass rule:** the newcomer has entered the address and pressed the button that sends the invitation, without help, in under 2 minutes.
- **Also write down:** which role the form chose for the colleague, whether the newcomer noticed it, and what the screen said after sending.

## The score sheet

One page per session.

Date: ____  Build: ____  Observer: ____  Newcomer: person or QA agent ____  Path: A or B ____

Used a project tool before: yes or no ____  Tour: started by itself, yes or no ____  What the newcomer did with it: ____

| # | Task | Limit (min) | Time taken | Done without help | First wrong click | Words not understood | Where they stopped | Settings page opened |
|---|---|---|---|---|---|---|---|---|
| 1 | Sign up | 2 | | | | | | |
| 2 | Connect your AI, or skip | 3 (A), 1 (B) | | | | | | |
| 3 | Make a project by describing it | 3 | | | | | | |
| 4 | Add three tasks | 2 | | | | | | |
| 5 | Assign one | 1 | | | | | | |
| 6 | Set a date | 1 | | | | | | |
| | **Clock for tasks 1 to 6** | **under 10** | | | | | | |
| 7 | Find what to do next | 1 | | | | | | |
| 8 | Approve a proposal | 2 | | | | | | |
| 9 | Simple mode off and on | 2 | | | | | | |
| 10 | Invite a person | 2 | | | | | | |
| | **Clock for the whole session** | **under 60** | | | | | | |

Totals:
- Tasks done without help: ____ of 10
- Stops: ____
- Help pages opened: ____
- Tour followed to finish a task: yes or no ____
- Settings pages opened in tasks 1 to 6: ____

The two lines:
- Sign-up to a running project in under ten minutes, with no settings page: pass or fail ____
- The first hour without help or a tour: pass or fail ____

The three worst stops, each with the screen and the words on it:
1. ____
2. ____
3. ____

## The finish-line rules

**Finish line nine: sign-up to a running project in under ten minutes, with no settings page.**
- It passes when tasks 1 to 6 are all done without help, the clock from the start of task 1 to the end of task 6 is under ten minutes, and no settings page was opened in those six tasks.
- It is judged on the real clock, not on the task limits. A session can pass every task and still fail this line.
- "A running project" here means a project with three tasks, one of them with an owner and a date.
- To settle: `task.md` also asks for one view and one report in the running project. This script does not test those two.

**Finish line ten: the first hour passes without help or a tour.**
- It passes when all ten tasks are done without help, inside 60 minutes.
- A hint from the observer, a help page opened, or a task finished by following the tour each fail it.
- A tour that starts by itself and is closed or ignored does not fail it.

**For both lines**
- One session is one newcomer. A newcomer is never used twice.
- Every stop is filed as a finding with the screen and the words on it, whether the line passed or not.
- The first run spends no model budget on AlianHub's side. On path A the newcomer's own Claude plan is used.
- Run it once on the build as it is today, and again after "Describe your project" (S-2) is built.

## Run 1, 2026-10-13, AI newcomer, path B

Date: 2026-10-13, 14:56 to 15:05 IST. Build: `14.36.0-beta.866` (from `/health`). Observer and newcomer: one QA agent (Claude) playing both. Path: B (skip "Connect your AI", work by hand). Tracker: AP-500.

**An AI newcomer is not a real person.** The agent read the screen through page text and screenshots, never got tired or impatient, and knows other project tools. Its times are machine times, slowed by a browser tool whose screenshots lagged one step behind the page. Treat this run as a walk-through that finds walls, not as a measure of how long a person takes. Finish lines nine and ten still need real people.

Set-up as found:
- **Account.** The owner invited `s6.newcomer@example.test` and joined it through the invite link. The account's role is **Member** (My settings shows "Member · joined Oct 2026"). This matters more than anything else below: the script was written for a newcomer who owns a new workspace, and a Member cannot do tasks 3 and 10.
- **Window.** The Browser pane is 800 px wide, which gives the phone layout (bottom bar). The run used an emulated 1280 × 860 desktop window. Task 6 also used the narrow layout for a while.
- **Model budget.** None spent. The Ask box was opened but no question was sent.
- **Used a project tool before:** yes (an AI agent). **Tour started by itself:** no. Instead Home shows a "Get going" checklist, 1 of 4 done ("Connect your AI", "Open My Work", "Set your notifications" ticked, "Learn the shortcuts: press ?"). "Take the tour" is under More, Tools. Not opened.
- **Menu:** Simple, as the script expects. The rail shows Home, My work, Projects, Inbox and Ask (the five), plus **App connections**, plus New task and More. My settings says Simple is "Five places: Home, My work, Projects, Inbox and Ask. A place you open joins them", so App connections probably joined while the owner set up the account.
- **Home on first sight.** The "What next" line says **"6 things need your approval."** with a Review button, and a "Waiting on you 6" card lists them. None is the newcomer's. They are:
  - two from "Claude Code (app · claude.ai), for Local PM", 3 days old: create the task "NC BR-40 mounting hole burrs 10 Oct 2026" in Sweep Project W2d, and create "GitHub: each project picks its own repositories" in AlianHub Platform;
  - three from "Code Reviewer", dated 4 Sep: post pull-request reviews on SPWC-15;
  - one from "Daily PM", 4 Sep: break SPWC-14 into five subtasks.
  
  Every one has a live **Approve** button (and Decline, Edit) for this brand-new Member. The run did not press them, because they write into the owner's projects. Whether the server would accept the approval was not tested.

### Score sheet

| # | Task | Limit (min) | Time taken | Result | First wrong click | Words not understood | Where they stopped | Settings page opened |
|---|---|---|---|---|---|---|---|---|
| 1 | Sign up | 2 | not measured | done by the owner, not measured | — | — | Owner: with no email set up, the join link only appears after "Resend Invitation" | — |
| 2 | Connect your AI, or skip | 1 (B) | 0:06, 1 click | **pass** | none | — | — | none |
| 3 | Make a project by describing it | 3 | 0:40 to the stop | **fail** | "+ New" (expected "New project"; it offers only New task and New reminder) | "router", "read like review work" (Ask page) | No way to make a project anywhere: see finding 1 | none |
| 4 | Add three tasks | 2 | 0:53 | **pass, in Personal List** (no project to put them in) | none | — | — | none |
| 5 | Assign one | 1 | 1:01 | **pass, in Personal List** (already assigned) | none | "List Of User" | — | none |
| 6 | Set a date | 1 | 3:04 | **fail** (over time) | the Due Date "Empty" box in the side panel (expected a calendar; nothing opened) | — | — | none |
| | **Clock for tasks 2 to 6** | under 10 | 6:11 (task 1 not on the clock) | line nine: **fail** (task 3) | | | | |
| 7 | Find what to do next | 1 | under 0:30 | **pass, with doubt** | none | — | — | none |
| 8 | Approve a proposal | 2 | 0:10 to find and read | **not finished**: observer stopped before Approve | none | "task.create: Creates a task in a project at once…", "task.add reaches the whole project", "outside client (https://claude.ai/oauth/…)" | Inbox, "Needs your approval 6", none of them the newcomer's | none |
| 9 | Simple mode off and on | 2 | about 1:20 | **pass** | avatar menu (expected a "Simple/Full" or "Menu" item; it shows My profile, Settings, Dark theme, Keyboard shortcuts, Log out) | — | — | My settings (allowed) |
| 10 | Invite a person | 2 | about 1:00 to the stop | **fail** | avatar menu → Settings → Company (expected Members or Invite) | — | No invite or members place for a Member: see finding 2 | Company (Settings) |
| | **Whole session** | under 60 | about 9 min | line ten: **fail** | | | | |

Totals:
- Passes: 5 of 10 (tasks 2, 4, 5, 7, 9), two of them only in the Personal List. Helped: 0. Fails: 3 (tasks 3, 6, 10). Not finished: 1 (task 8). Not measured: 1 (task 1).
- Stops: 2 (tasks 3 and 10). No hint could move them: the role has no button to press.
- Help pages opened: 0. Tour followed: no. Settings pages opened in tasks 1 to 6: 0.
- Line nine (sign-up to a running project in under ten minutes, no settings page): **fail**, task 3 cannot be done.
- Line ten (the first hour without help or a tour): **fail**, tasks 3, 6 and 10.

Per-task notes:
- **Task 2.** "Skip for now" sits under the big "Connect your AI" button. One click, the checklist moves on to "Next: Open My Work". The newcomer could not say what connecting gives them: the card does not say.
- **Task 3.** Tried, in order: "+ New" (New task, New reminder), Projects (a table of ten projects with Filter and Portfolio view, no "New project"), Ask, More (Goals, Planner, Chat, Docs, Dash, Time, Portfolio, Automations, Integrations, Connections, External data, three reports, Notepad, Clips, Reminders, Talk to Text, Take the tour, Settings, Trash), the sidebar "PROJECTS" heading on hover, Portfolio. On Ask the placeholder reads "Ask, plan or build. Type / for a skill, @ to add a task, doc or project.", and "/" lists Intake, Reporter, Project Guide, Bug Triager, Tech Lead, Support Agent, Maintenance Planner, Non-conformance Recorder. A person told to "describe it in your own words" would type there and press Ask; this run did not, to keep the no-model-budget rule. What the newcomer would have typed: "We move to a new office next month. Plan the move: movers, IT equipment, telling clients the new address."
- **Task 4.** Home's Personal List card says "Somewhere to type before a project exists", so the tasks went there: "Book the movers", "Pack the IT equipment", "Tell clients the new address". The second and third were added the same way, typed into the top box and Enter. The box clears at once and the row shows up 2 to 5 seconds later. One typed task was lost once, possibly because of the browser tool.
- **Task 5.** Personal List tasks are assigned to their creator, so it was already done. The Assignee row shows only a grey avatar, no name; the name is only in the hover text. The newcomer looked for "Assignee" and found it. Clicking the add-person icon opens a drawer titled "List Of User".
- **Task 6.** "Next Friday" was read as Friday 16 October. In the wide layout, clicking the Due Date "Empty" box in the side panel opened nothing (the box is 163 px wide inside a 138 px cell and runs past the panel edge). In the narrow layout, under "Properties", it opened a calendar. A mis-click (the screenshot was a step behind) set Monday 28 September first; the second try set 16/10/2026 and the toast said "Due date updated successfully". No time was added. **The list behind the panel still showed "Sep 28"** after the change.
- **Task 7.** Home's "What next" reads "6 things need your approval." The newcomer read it aloud, but it points at other people's agents, not at their own work. "Book the movers, Fri" sits under "NEXT" in My Work, and "TODAY 0 · Your day is clear".
- **Task 8.** Review leads to Inbox, "Needs your approval 6". Each card has WHY and WHAT CHANGES, and the two "create the task" cards say clearly what would be made and where. Who proposed it reads "Claude Code (app · claude.ai), for Local PM": a person the newcomer has never heard of. No proposal was seeded in the newcomer's own space (script step 5 was left open), so all six belong to the owner.
- **Task 9.** Avatar menu, then My profile. The page heading says "My settings", while the menu said "My profile". The Simple / Full choice is low on that page, below Language, Time format, Working hours and a long Timezone list. Full turns the rail into Home, Everything, Goals, Projects, Inbox, Planner, Chat, AI, Docs, App connections, Dash, Time. **"My work" becomes "Everything" and "Ask" becomes "AI"**: the same places change names between the two modes. Simple put it back.
- **Task 10.** No "Invite" or "Members" anywhere a Member can reach: not the avatar menu, not Settings (My settings, Notifications, Sign-in & security, Company, Language & Region, Integrations, Templates, Task templates, Time Off, Time Tracking), not the More menu, not a project's page. The address `colleague.s6@example.test` was never typed, so what the screen says when mail cannot be sent was not reached.

### Findings, worst first

1. **A newcomer who joins by invitation cannot make a project.** The invitation made a Member, and a Member sees no "New project" anywhere: "+ New" offers only New task and New reminder, and the Projects page has only Filter and Portfolio view. The screen never says why or who can. Task 3, and with it finish line nine, cannot pass on this path. Either a newcomer must start their own workspace (script step 2, not checked here), or the Projects page should say "Only admins can make projects. Ask <owner>", or Members should be able to make one.
2. **A Member cannot invite anyone, and nothing says so.** No Members or Invite place exists for the role, and there is no "ask an admin" hint. Task 10 cannot pass.
3. **A brand-new Member's Home opens on six strangers' approvals, with live Approve buttons.** "What next" points at them instead of the newcomer's own task due Friday. They are three to five weeks old, sit on projects the newcomer never opened, and come from "Claude Code … for Local PM", "Code Reviewer" and "Daily PM". Two card titles are raw tool text: "task.create: Creates a task in a project at once, with as much as you know in one call…". The WHY lines read "task.add reaches the whole project; it came from an outside client (https://claude.ai/oauth/claude-code-client-metadata)". Should a person who joined a minute ago be able to approve another person's agent? To decide, and to check on the server.
4. **"Describe it in your own words" has no path without a model.** Ask is the only place to describe a project. It names no "make a project" skill, and on path B nothing says that a key or a connected AI is needed. The Ask page also greets a newcomer with "Your 100 most recently updated open tasks — 44 read like review work, 20 read like code changes…" and "Classified the way the router classifies them". That is team-wide work they have never seen, in words they do not know.
5. **The task list does not follow the side panel.** After the due date changed to 16/10/2026 in the panel (toast "Due date updated successfully"), the Personal List row still showed "Sep 28". In the wide layout the Due Date box in the panel runs past its cell, and clicking it opened nothing.
6. **Simple / Full is hard to find and renames places.** It is at the bottom of My settings, reached from a menu item called "My profile", with no rail or More entry. Switching to Full renames "My work" to "Everything" and "Ask" to "AI".
7. **The join link only appears after "Resend Invitation" when email is not set up** (reported by the owner, task 1).
8. **Small things.** "List Of User" as a title. Assignee shows an avatar with no name. "Get going" still reads 1/4 after "Skip for now". The "+ New" menu draws over the checklist's "Open My Work" button. The More menu is see-through over the second rail. Quick-add clears the box before the new row appears.

### Not tested, and why

- Task 1 was the owner's. The sign-up form, field count and "Create account" path without an invitation were not seen.
- Path A, and Ask with a model: no model budget in run 1.
- Pressing Approve: the only proposals belong to the owner's projects.
- What the screen says when an invitation cannot be mailed: the newcomer never reached an invite form.

Next run: give the newcomer a workspace of their own (or an Admin role), seed one proposal in their own project for task 8, and run it with a real person.

## Run 2, 2026-10-14, AI newcomer, path A

Date: 2026-10-14, 12:41 to 12:51 IST. Build: `14.37.0-beta.5`, commit `746d3114` (`staging`), plus the log-in fix in #1678. Observer and newcomer: one QA agent (Claude) playing both. It drove a headless browser (Playwright) for AlianHub and used Claude Code CLI as the newcomer's own AI. Path: A (connect, then say it). Tracker: AP-486.

**An AI newcomer is not a real person**, as in run 1. Its times are machine times. Two waits of about 30 seconds each came from the browser tool (tasks 3 and 10) and are left in the times. Treat this run as a walk-through that finds walls. Finish lines nine and ten still need real people.

Set-up as found:
- **No self-service sign-up.** AlianHub stays invitation-only (the owner's decision, 2026-10-14). A newcomer who owns a workspace is the person who installs it, so this run started at the install wizard on a throwaway server: `node index.js` on port 4071 with an empty MongoDB in its own container, no AI keys, mail pointed at a closed port, and the MCP flags of the local `.env` (`MCP_OAUTH=both`, `MCP_OAUTH_DCR`, `MCP_TOOLS_DATA`, `MCP_TOOLS_MANAGE`, `MCP_TOOLS_WORK`, `MCP_ROLE_PROMPTS`). The server, its database and the Claude config were removed afterwards. The owner's instance on port 4000 was not touched.
- **Account.** `newcomer2@example.test`, "Nova Newcomer", Owner of the workspace "Office Move Co". A colleague, `colleague.nc2@example.test`, joined as a Member through task 10's link, to recheck run 1 as a Member. The passwords live only in a private hand-off file.
- **The AI.** Claude Code CLI, with a throwaway `--mcp-config` file and `--strict-mcp-config`, run from a scratch folder outside the repository. The model was the newcomer's own Claude. No AlianHub server key was set, so no server-side model budget was spent.
- **Window.** 1280 × 860, desktop.
- **Used a project tool before:** yes (an AI agent). **Tour started by itself:** yes, "Step 1 of 4, The navigation goes everywhere", first on the token page in task 2 and again on later pages. The newcomer ignored it until it covered the project row in task 3, then pressed "Skip tour".
- **Menu:** Simple. The rail shows Home, My work, Projects, Inbox, Ask **and App connections** from the start. Dash joined later, after the AI made a dashboard.

### Score sheet

| # | Task | Limit (min) | Time taken | Result | First wrong click | Words not understood | Where they stopped | Settings page opened |
|---|---|---|---|---|---|---|---|---|
| 1 | Sign up (install wizard) | 2 | 0:24 | **pass** | none | "What does your team mainly do?" (no choice fits a move; picked "Something else") | — | none |
| 2 | Connect your AI | 3 (A) | 2:02 | **pass** | Typed the token name into "Link account"'s Label box. It has the same placeholder, "laptop CLI", as the token's name box below it. The form then said "Give the token a name". | "Mode: Workspace key / Personal CLI account / Self-hosted model", "Provider", "Project scope", "MCP", "WHAT THIS TOKEN MAY CALL" with about 90 raw tool names | — | none (AI, Accounts is not under Settings) |
| 3 | Make a project by describing it | 3 | 1:52 | **pass** | none | "j k ↵ r e s" at the top of the Inbox | The tour card lay over the "Office Move" row on Projects, so the row could not be clicked until "Skip tour" | none |
| 4 | Add three tasks | 2 | 1:00 | **pass** | none | — | — | none |
| 5 | Assign one | 1 | 0:10 | **pass** (the AI had already made the newcomer the assignee of all three in task 4) | none | — | — | none |
| 6 | Set a date | 1 | 0:38 | **pass** | none | — | — | none |
| | **Clock for tasks 1 to 6** | under 10 | **6:35** | line nine: **pass** (machine time, no help, no settings page) | | | | |
| 7 | Find what to do next | 1 | 0:08 | **pass, with doubt** | none | — | — | none |
| 8 | Ask the AI for a budget field, then approve it | 2 | 0:32 to ask, 0:23 to find, read and approve | **pass** | none | — | — | none |
| 9 | Simple mode off and on | 2 | 0:20 | **pass** | none | — | — | My settings (allowed) |
| 10 | Invite a person | 2 | 1:34 | **pass** | none | — | — | Members (reached from Home's "Invite team") |
| | **Whole session** | under 60 | **about 10:00** | line ten: **pass** (machine time; the tour was closed, not followed) | | | | |

Totals:
- Passes: 10 of 10, task 7 with doubt. Helped: 0. Stops: 0.
- Help pages opened: 0. Tour followed: no, closed once. Settings pages opened in tasks 1 to 6: 0.
- Line nine: **pass** on machine time. Line ten: **pass** on machine time. Both still need a real person.

Per-task notes:
- **Task 1.** `http://localhost:4071/` opens "Set up AlianHub. Create the owner account and the first workspace. Takes under a minute." It asks for six fields (first name, last name, email, password, workspace name, "What does your team mainly do?") and has one box, "Start with a sample project", ticked by default. "Create workspace" leads straight to "ONE LAST STEP, Connect your AI".
- **Task 2.** The page offers Claude (a custom connector by address), ChatGPT, and "Claude Code and other tools: Create a token, then run the command the page gives you". The newcomer uses Claude Code, so "Create a token" was the right way. It opens AI, Accounts (`?tab=link`), headed "Coding accounts". That page first shows a "My coding agent … Link account" form, a month's spend card and a command preview that already reads "connected · 86 tools · protocol 2025-06-18" before anything is connected. "New token" asks for a name, Mode, Provider, Project scope, Expires after (30 days) and three unticked boxes. The newcomer ticked "Let this agent manage tasks" and "Let this agent write docs". The page then shows the exact `claude mcp add --transport http alianhub "http://localhost:4071/mcp?companyId=…" --header "Authorization: Bearer ahp_…"` command once. The placeholder before it read `ah_pat_••••••••`. The newcomer left AlianHub once, for the terminal. On the first question ("Are you connected to AlianHub? Who am I there?") Claude answered "You are Nova Newcomer, … owner". AI, Connect your AI then read "Connected. Your AI app was last seen here around 14/10/2026, 12:42 PM." and offered "SAY THIS TO IT FIRST: Set up my project". Did the newcomer understand what connecting gives? Yes. The page says "ask it to set up and run your projects. It sees and changes only what you can."
- **Task 3.** What the newcomer said to Claude: "Set up my project. We move to a new office next month. Plan the move: movers, IT equipment, telling clients the new address." Claude asked no questions. It filed one proposal and said so: "The project proposal is waiting for your approval in your AlianHub Inbox." The Inbox, on "Needs your approval 1", showed "My Claude (MCP), for Nova Newcomer wants to create the project “Office Move”", with WHY, the project's description, four lists, a Blocked status, four fields (Vendor, Cost, Move Phase, Confirmed), four views, a "Move readiness" dashboard, and "Untick anything you do not want. Only what is ticked is made." The AI made everything. The newcomer only pressed Approve. After that the Inbox said "Approved. Undo" with no link to the new project, so the newcomer opened it from Projects.
- **Task 4.** "For now put just these three things in it: Book the movers, Pack the IT equipment, Tell clients the new address." Claude filed them as one "set up the project" proposal, one task per list, each "for Nova Newcomer". One Approve made all three (OM-1 to OM-3). The second and third tasks came with the first, from the same sentence. The sidebar counts and the list headers kept saying 0 until the page was reloaded. The project opens on an empty default list called "List", with the four real lists folded.
- **Task 5.** Already done by the AI. The task panel shows "Assignee: Nova…". In the list row the assignee is a grey avatar with no name.
- **Task 6.** "Book the movers is mine, and it has to be finished by next Friday." It was applied at once, with no approval. Claude said: "now due Friday 23 October 2026 … I read 'next Friday' as 23 October rather than this coming Friday, 16 October. If you meant the 16th, say so". The row showed "Oct 23" without a reload. No time was added.
- **Task 7.** Home's "WHAT NEXT" read "You have one task for today. Show today." That task is the sample project's "Start here — this project is a sandbox", due today. The newcomer's own "Book the movers" sits under "NEXT 4 · FROM THE SAMPLE PROJECT", after three sample tasks. The newcomer could read the line aloud, but it points at sample data, not at the move.
- **Task 8.** "Add a place on my tasks to note the budget." Claude filed one proposal, and said it would sit beside the Cost field it had made in task 3. The Inbox showed "My Claude (MCP), for Nova Newcomer wants to add the fields “Budget”", "WHY Add a Budget field so each move task can record its planned spend (an agent never makes this kind of change on its own)", "New fields: Budget, Where: Office Move, Field: Budget: Money". The newcomer could say what would change and who proposed it. After Approve, "Budget" showed under Custom Field on every task. Home's "What next", read just after the proposal was filed, did not mention it until the page was reloaded.
- **Task 9.** Avatar menu, then "My settings", then "How much to show": Simple or Full. Full turned the rail into Home, Everything, Goals, Projects, Inbox, Planner, Chat, AI, Docs, App connections, Dash, Time. Simple put it back.
- **Task 10.** Home's checklist ("3/5 Set up Office Move Co, Next: Invite your team") has an "Invite team" button. It opens Settings, Members: "1 · UNLIMITED", Invite. The form chose the role **Member** and explained it: "Member: Works on projects and tasks day to day." The newcomer noticed it and kept it. After Send, the screen said "Couldn't email this invite. Copy the join link instead." with "Copy link" and the link itself. The agent appears on Members as "My claude-code, Agent, Connected by Nova Newcomer · Takes no seat and has no role of its own". The token was named "My Claude".

### Findings, worst first

1. **After making an account from the join link, the person lands on Log in, not inside the app.** The colleague filled "Create your account. You're joining Office Move Co." (name, password) and pressed Continue. The next screen was "Log in", with no word that the account was made. After logging in they reached Home, skipping the "One last step, Connect your AI" page that the install wizard shows. Seen once on the throwaway server (session cookies are httpOnly there, as in the e2e harness). To check on a normal set-up.
2. **The first-visit tour covers the work.** It starts on whatever page the newcomer is on (here, the token page) and comes back on the next pages. On Projects its card lay over the "Office Move" row, and the row could not be clicked until "Skip tour".
3. **Counts do not follow what the AI makes.** After the AI's tasks were approved, the sidebar ("Office Move 0, 0 tasks") and the list headers ("Movers & Logistics 0", above a list holding a task) stayed at 0 until a reload. The project also opens on an empty default list, "List", that the AI's setup did not ask for, with the real lists folded.
4. **The token page is built for developers, not newcomers.** "Create a token" lands on "Coding accounts" with a "Link account" form first, and both forms use the placeholder "laptop CLI". The command preview claims "connected · 86 tools" before anything is connected. The placeholder token reads `ah_pat_…` while real tokens start `ahp_`. About 90 raw tool names are listed under "WHAT THIS TOKEN MAY CALL". The page has no way back to the welcome step.
5. **"What next" points at sample data first.** On a new workspace with the sample project ticked by default, "You have one task for today" is "Start here — this project is a sandbox", ahead of the newcomer's own work. It did not show a newly filed approval until a reload.
6. **Approve leads nowhere.** After approving "create the project", the Inbox says "Approved. Undo" with no link to the project it made.
7. **Words.** The Inbox header shows "j k ↵ r e s" with no explanation. Simple says "Five places: Home, My work, Projects, Inbox and Ask", but the menu starts with six (App connections too). The agent is named "My claude-code" on Members, not "My Claude". In the list row the assignee is a grey avatar with no name.
8. **"Set up my project" did not ask questions.** The Connect page promises "It asks a few questions and shows you a plan. Nothing is made until you say yes." The second half held, because the plan was the Inbox card. Claude asked no questions and asked about the move date only after filing. This depends on the AI as much as on the product prompt.
9. **Claude.ai and ChatGPT cannot reach a local server.** The page rightly says "this address must be reachable from outside your network". On `localhost` only the token path for Claude Code works, so the OAuth consent screen was not exercised.

### Run-1 findings, rechecked on screen

| Run 1 | Status | What the screen showed |
|---|---|---|
| 1. A Member cannot make a project and is not told why | **CHANGED, seen** | As the Member: Projects shows "Only an admin can create projects. Ask Nova Newcomer to create one or to change your role." There is still no New project for a Member. |
| 2. A Member cannot invite and is not told | **CHANGED, seen** | As the Member: Settings shows "Only an admin can invite people. Ask Nova Newcomer to invite them or to change your role." Members is not in the Member's settings menu. |
| 3. A new Member's Home opens on strangers' approvals | **NOT REPRODUCED** | A new workspace has no team proposals. The newcomer's own proposals were titled in plain words ("My Claude (MCP), for Nova Newcomer wants to create the project “Office Move”"), not tool text. |
| 4. "Describe it" has no path without a model | **FIXED on path A, path B not retested** | Described in one sentence to the newcomer's own Claude: the project, its lists, fields, views and dashboard were made after one approval. |
| 5. The list does not follow the side panel; the date box runs past its cell | **FIXED, seen** | In the Personal List at 1280 px, clicking Due Date opened a calendar, and the row read "Fri" right after a date was picked, without a reload. |
| 6. Simple / Full is hard to find and renames places | **STILL OPEN, partly changed** | The avatar menu now says "My settings", the same as the page. Full still renames "My work" to "Everything" and "Ask" to "AI". |
| 7. The join link appears only after "Resend Invitation" | **FIXED for the first send** | "Couldn't email this invite. Copy the join link instead." and the link appear right after Send. After a reload, the link comes back only through "resend", then "Copy link". |
| 8. Small things | **MOSTLY FIXED** | The panel shows the assignee's name ("Nova…"). The checklist counts its own steps ("3/5"). The list row still shows only an avatar. |

The log-in fix (#1678) was also seen on the throwaway server: "Log in. Log in to your workspace. No account yet? Ask your workspace admin to invite you."

### Not tested, and why

- Path B, and Ask or "Create with AI" with a server key: path A was chosen, and no server-key spend was allowed.
- The OAuth consent screen and Claude.ai or ChatGPT connectors: they need an address reachable from the internet, and for Claude Code the page points to a token.
- A real person, a phone-width window, and the owner's local instance: out of scope for this run.

Next run: a real person on path A, on a server reachable from Claude.ai, so the connector and consent screen are covered.
