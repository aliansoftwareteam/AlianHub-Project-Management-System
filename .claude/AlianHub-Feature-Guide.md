# AlianHub Features Guide

A capability-by-capability guide to the features shipped across three releases — each with what it's for, where to find it, how to use it, and why it helps.

**52 features · 8 capability areas · v14.4.0 → v14.6.0**

---

## Contents

1. [AI & Smart Assistance](#-ai--smart-assistance)
2. [Project Views](#️-project-views)
3. [Reports & Dashboards](#-reports--dashboards)
4. [Automation & Integrations](#-automation--integrations)
5. [Time & Timesheets](#️-time--timesheets)
6. [Admin, Security & Access](#-admin-security--access)
7. [Collaboration](#-collaboration)
8. [Tasks, Fields & Sharing](#-tasks-fields--sharing)

Each feature lists **Where** it lives, **How** to use it, and the **Benefit**.

---

## 🤖 AI & Smart Assistance
*Plan, write, and estimate with AI — not a bolt-on.*

### AI Assist — plan a project · `v14.6.0`
Generate a whole set of sprints and tasks for an existing project from a short prompt.
- **Where:** Inside any project — the *AI Assist* action on the board.
- **How:** Open the project → *AI Assist* → describe the work → review the proposed sprints & tasks → *Accept* to create them live.
- **Benefit:** Turns a blank project into a structured, ready-to-work plan in seconds.

### Write with AI · `v14.5.0`
Generate, clarify, or rewrite task and project descriptions.
- **Where:** The description field of any task or project.
- **How:** In the description → *Write with AI* → generate or clarify → preview → *Apply*.
- **Benefit:** Clear, consistent descriptions instead of a blank box.

### Grounded AI time estimates · `v14.5.0`
AI time estimates calibrated on your team's real historical data.
- **Where:** When estimating time on a task.
- **How:** Request an AI estimate → it factors in past actuals and calibrates automatically.
- **Benefit:** Estimates that sharpen over time instead of generic guesses.

---

## 🗂️ Project Views
*Five ways to see the same project — same data, a different lens. Switch from the project's view switcher.*

### Timeline / Gantt · `v14.4.0`
Schedule work on a horizontal timeline with durations and dependencies.
- **Where:** Project → View switcher → Timeline.
- **How:** Switch to Timeline → drag task bars to set dates → link tasks for dependencies; pairs with recurring tasks.
- **Benefit:** See the schedule and what blocks what at a glance.

### Mind Map · `v14.5.0`
Explore tasks and sub-tasks as an expandable node graph.
- **Where:** Project → View switcher → Mind Map.
- **How:** Switch to Mind Map → expand/collapse nodes to drill into sub-tasks.
- **Benefit:** Understand structure and hierarchy visually.

### Whiteboard · `v14.5.0`
A freeform canvas for brainstorming and visual planning.
- **Where:** Project → View switcher → Whiteboard.
- **How:** Switch to Whiteboard → add and arrange elements freely.
- **Benefit:** Think visually without leaving the project.

### Canvas / dynamic layout · `v14.5.0`
Arrange tasks in flexible, custom layouts not tied to a fixed board.
- **Where:** Project → View switcher → Canvas.
- **How:** Switch to Canvas → position tasks spatially to suit the work.
- **Benefit:** Organize work the way you think about it.

### Map · `v14.5.0`
Plot location-based tasks on an offline SVG map.
- **Where:** Project → View switcher → Map.
- **How:** Switch to Map → tasks with a location appear as pins.
- **Benefit:** See field or location-based work geographically.

---

## 📊 Reports & Dashboards
*A full reporting suite, from a drag-together builder to public sharing — under the Reports / Dashboards area.*

### Custom report builder · `v14.5.0`
Build your own reports by choosing metrics, filters, and grouping.
- **Where:** Reports → New report.
- **How:** Pick a data source → choose metrics → add filters & grouping → Save.
- **Benefit:** Answer your own questions without waiting on a developer.

### Portfolio rollup · `v14.5.0`
Roll status and progress up across many projects into one view.
- **Where:** Reports → Portfolio.
- **How:** Select the projects → read the combined status and progress.
- **Benefit:** A leadership-level view across the whole portfolio.

### Dashboard cards · `v14.5.0`
Three new card types to compose at-a-glance dashboards.
- **Where:** Dashboard → Add card.
- **How:** Add a card → pick one of the new types → configure it.
- **Benefit:** Richer, more informative dashboards.

### Estimate-vs-actual variance · `v14.5.0`
See exactly where estimates drifted from time actually spent.
- **Where:** Reports → Estimate vs Actual.
- **How:** Pick a project/period → read the variance per task.
- **Benefit:** Improve future estimates using real data.

### Agile reports · `v14.4.0`
Burndown, velocity, and cumulative-flow (CFD) charts.
- **Where:** Reports → Agile.
- **How:** Choose the chart → pick the sprint/range → Export PDF (branded).
- **Benefit:** Standard agile metrics, plus share-ready PDFs.

### Capacity planning · `v14.5.0`
Compare team capacity against assigned load.
- **Where:** Reports → Capacity.
- **How:** Select a team and period → spot over- or under-allocation.
- **Benefit:** Balance workload before anyone burns out.

### Reusable report templates · `v14.5.0`
Save a report's configuration as a template and duplicate it.
- **Where:** Any report → Save as template.
- **How:** Configure a report → Save as template → duplicate when needed.
- **Benefit:** Standardize reporting and stop rebuilding.

### Scheduled / emailed reports · `v14.5.0`
Reports that run on a schedule and email themselves.
- **Where:** A report → Schedule.
- **How:** Open a report → set a schedule → add recipients.
- **Benefit:** Stakeholders get the numbers automatically.

### Export to CSV & Excel · `v14.5.0`
Download any report as CSV or XLSX.
- **Where:** Any report → Export.
- **How:** Open a report → Export → choose CSV or Excel.
- **Benefit:** Take the data into spreadsheets or BI tools.

### Share via public link · `v14.5.0`
Publish a read-only report link for stakeholders.
- **Where:** A report → Share.
- **How:** Open a report → Share → copy the public link.
- **Benefit:** Share results outside the workspace, safely.

---

## 🔄 Automation & Integrations
*Connect your stack and automate the busywork — managed from one Integrations hub under **Settings → Integrations**.*

### Integrations hub · `v14.5.0`
One registry to browse, connect, and manage every integration.
- **Where:** Settings → Integrations.
- **How:** Open the hub → connect or manage any integration from one place.
- **Benefit:** Central control of everything connected.

### Integrations marketplace · `v14.5.0`
A catalog to discover and enable available integrations.
- **Where:** Settings → Integrations → Marketplace.
- **How:** Browse the catalog → enable the ones you need.
- **Benefit:** Find and add integrations without hunting through docs.

### Automation builder · `v14.5.0`
Create "when this happens, do that" rules.
- **Where:** Settings → Integrations → Automations.
- **How:** Create a rule → set the trigger → set the action.
- **Benefit:** Eliminate repetitive manual steps.

### Email-to-task · `v14.5.0`
Turn incoming emails into tasks automatically.
- **Where:** Settings → Integrations → Email-to-task.
- **How:** Get the inbound address → email or forward to it → a task is created.
- **Benefit:** Capture work straight from your inbox.

### Calendar feed (iCal) · `v14.5.0`
Subscribe to your tasks and deadlines from any calendar app.
- **Where:** Settings → Integrations → Calendar feed.
- **How:** Copy the iCal URL → subscribe in Google/Outlook/Apple Calendar.
- **Benefit:** Deadlines live alongside the rest of your calendar.

### Slack slash-command bot · `v14.5.0`
Create and manage tasks from Slack.
- **Where:** Settings → Integrations → Slack.
- **How:** Connect Slack → use the slash command in any channel.
- **Benefit:** Capture work without leaving the conversation.

### Custom iframe apps · `v14.5.0`
Embed your own tools or pages as apps inside AlianHub.
- **Where:** Settings → Integrations → Custom apps.
- **How:** Add an app → point it at your URL → it embeds in the workspace.
- **Benefit:** Bring external tools into one place.

### Outgoing webhooks · `v14.4.0`
Notify external systems when events happen.
- **Where:** Settings → Integrations → Webhooks.
- **How:** Add a webhook → set the target URL → choose which events fire it.
- **Benefit:** Connect AlianHub to anything that can listen.

### Importers · `v14.4.0`
Bring existing work in from other tools.
- **Where:** Settings → Import (Asana, Monday.com, Trello, CSV).
- **How:** Choose the source → connect or upload → map fields → import.
- **Benefit:** Migrate without re-keying everything by hand.

---

## ⏱️ Time & Timesheets
*An end-to-end time module, from the stopwatch to the invoice.*

### Timesheet approvals · `v14.5.0`
Submit, review, and approve timesheets.
- **Where:** Timesheets → Approvals.
- **How:** A member submits → an approver reviews → approve or reject.
- **Benefit:** Clean, signed-off time records to bill and pay from.

### Billable flag & summary · `v14.5.0`
Mark entries billable and read billable summaries.
- **Where:** On each time entry, and the Timesheets summary.
- **How:** Toggle *Billable* on entries → read the billable-vs-non-billable summary.
- **Benefit:** Separate client-billable time from internal time.

### Rates & invoicing · `v14.5.0`
Apply billing rates and generate invoices from logged time.
- **Where:** Timesheets → Billing / Invoices.
- **How:** Set rates → select a period → generate the invoice.
- **Benefit:** Bill straight from tracked time, no spreadsheet round-trip.

### Locked approved periods · `v14.5.0`
Entries lock once their period is approved.
- **Where:** Timesheets (automatic on approval).
- **How:** Approve a period → its entries lock against further edits.
- **Benefit:** Protects approved and billed records.

### Payroll CSV export · `v14.5.0`
Export time data for payroll.
- **Where:** Timesheets → Export.
- **How:** Pick the period → Export CSV.
- **Benefit:** Hand payroll clean, ready-to-process data.

### Idle-time auto-pause · `v14.5.0`
The tracker pauses itself when you go idle.
- **Where:** The time tracker.
- **How:** Start the timer → it auto-pauses after detecting idle time.
- **Benefit:** Accurate logs without inflated timers.

### Daily entry reminders · `v14.5.0`
A daily nudge to fill in time entries.
- **Where:** Notifications (per-user).
- **How:** Enable reminders → a prompt fires each day to log time.
- **Benefit:** Nothing slips through unlogged.

### Story points · `v14.4.0`
Estimate tasks in story points on a configurable scale.
- **Where:** On a task's estimation fields.
- **How:** Set story points on a task using your chosen scale.
- **Benefit:** Agile sizing alongside time-based estimates.

---

## 🔐 Admin, Security & Access
*Controls for larger teams and compliance, under **Settings → Admin**.*

### Enterprise SSO · `v14.5.0`
Single sign-on over SAML and OIDC.
- **Where:** Settings → Admin → SSO.
- **How:** An admin configures the identity provider → users sign in via SSO.
- **Benefit:** One secure, centrally-controlled login.

### SCIM provisioning · `v14.5.0`
Auto-provision and de-provision users via SCIM 2.0.
- **Where:** Settings → Admin → SCIM (paired with SSO).
- **How:** Connect your identity provider via SCIM → users sync automatically.
- **Benefit:** Onboarding/offboarding without manual user admin.

### Audit logs · `v14.5.0`
Tamper-evident logging of activity, with retention.
- **Where:** Settings → Audit logs.
- **How:** Open Audit logs → filter by user, action, or date.
- **Benefit:** Accountability and a compliance-ready record.

### Guest role & scoped access · `v14.5.0`
A guest role limited to assigned projects, tasks, and comments.
- **Where:** Member / role management.
- **How:** Assign the *Guest* role → scope which projects they can see.
- **Benefit:** Safely involve clients and contractors.

### Offline mode · `v14.5.0`
Keep working offline; changes sync on reconnect.
- **Where:** App-wide (automatic).
- **How:** Keep working when the connection drops → changes sync when you're back online.
- **Benefit:** No lost work on a flaky connection.

### Time-off / PTO · `v14.5.0`
Track leave, with capacity reduced during time off.
- **Where:** The PTO / time-off section.
- **How:** Request and approve time off → team capacity adjusts during leave.
- **Benefit:** Realistic planning that accounts for who's away.

---

## 🎥 Collaboration
*Lightweight tools that keep context attached to the work.*

### Clips — screen & voice · `v14.5.0`
Record screen/voice clips and attach them to tasks.
- **Where:** The global clip recorder; the *My Clips* library.
- **How:** Start a clip → record (minimize-to-background supported) → attach to a task or save to My Clips.
- **Benefit:** Explain something in 30 seconds instead of a wall of text.

### Reminders · `v14.5.0`
Personal task reminders that fire on a schedule.
- **Where:** On a task → Reminder.
- **How:** Set a reminder on a task → it notifies you at the chosen time.
- **Benefit:** Never forget a follow-up.

### Notepad · `v14.5.0`
Personal notes you can convert into tasks.
- **Where:** The Notepad.
- **How:** Jot a note → convert it to a task once it's actionable.
- **Benefit:** Capture ideas now, organize later.

### Pages with live task chips · `v14.5.0`
Embed live, status-aware task chips inside docs.
- **Where:** Pages.
- **How:** Insert a task chip in a page → it shows the task's live status.
- **Benefit:** Docs that stay in sync with the work.

### @mention notifications · `v14.4.0`
Notify people when you @mention them.
- **Where:** Comments and descriptions.
- **How:** Type *@* and pick a person → they get an action-aware alert.
- **Benefit:** Pull the right people in at the right moment.

---

## 🧩 Tasks, Fields & Sharing
*More expressive tasks, and tighter control over what leaves the workspace.*

### Formula & rollup fields · `v14.5.0`
Computed custom fields: formulas over fields, and rollups from sub-tasks.
- **Where:** Custom field setup.
- **How:** Add a field → choose *Formula* or *Rollup* → configure the expression or aggregation.
- **Benefit:** Live calculations on tasks — no exporting to a spreadsheet.

### Subtask completion badge · `v14.6.0`
Parent tasks show the percentage of sub-tasks completed.
- **Where:** On any parent task (automatic).
- **How:** Add sub-tasks → the parent shows a completion-% badge as they're closed.
- **Benefit:** Progress at a glance, without tallying sub-tasks.

### Epics · `v14.4.0`
Epics with dates, owner, priority, progress, and blocked-task warnings.
- **Where:** The Epics area.
- **How:** Create an epic → set its fields → group related tasks under it.
- **Benefit:** Track big initiatives above the task level.

### Recurring tasks · `v14.4.0`
Tasks that regenerate automatically on a schedule.
- **Where:** A task → Recurrence.
- **How:** Set a recurrence rule → new instances generate automatically.
- **Benefit:** Automate routine, repeating work.

### Move sprints to folders · `v14.5.0`
Re-group sprints into folders without drag-and-drop.
- **Where:** The sprint menu.
- **How:** Open a sprint's menu → Move to folder → pick the folder (re-groups live).
- **Benefit:** Organize many sprints quickly, even on touch.

### Hardened public links · `v14.4.0`
Secure, read-only public links.
- **Where:** Share → public link settings.
- **How:** Create a link → set expiry and a password → hard-revoke any time (rate-limited).
- **Benefit:** Share externally while keeping full control.

---

*Coverage: v14.4.0 → v14.6.0 · features only. For the full change history including fixes, see [CHANGELOG.md](../CHANGELOG.md).*
