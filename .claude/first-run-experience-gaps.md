# AlianHub — the first-run experience

What a brand-new, non-technical user gets on day one, how that compares with ClickUp, Asana, Jira, Zoho and Odoo, and what we should do about it.

Everything below was checked against the code on `staging` and against two real company databases. Nothing here is assumed.

---

## The first five minutes today

You download AlianHub and run the setup. The wizard has nine steps, and the first one asks for a MongoDB connection string. Then a storage bucket, then Firebase keys, then an AI key, then SMTP mail settings. A non-technical person stops here and calls a developer.

Say a developer gets you through it. You create your company, you log in, and you land on the dashboard. It is empty. Not "getting started" empty — literally nothing. The projects list says **"No project found"**. Your task list says **"No Data Found"**. There is no sample project, no example task, no welcome message, and nothing on the screen tells you what to do next.

You click "Create Project". You get a choice of 14 templates with names like **Development**, **UI/UX**, **Marketing** and **Backlogs and Sprints**. You pick one. It creates a project with a set of columns — and nothing in it. The same empty screen, now with column headers.

You invite a colleague. They log in and see even less than you do, because a brand-new company gives the Member role **zero permissions**. Before your team can work, you have to open Settings → Security & Permissions and set roughly 100 switches by hand, with no explanation of what any of them do.

That is day one.

---

## What we already have

This is the encouraging part. A lot is built. Much of it is simply not put in front of the user.

**The user meets these naturally**

| Thing | What ships |
|---|---|
| Project views | 20 — List, Board, Calendar, Table, Gantt, Timeline, Workload, Reports and more |
| Feature toggles ("apps") | 9 — Priority, Multiple Assignees, Time Estimate, Milestones, Tags, Custom Fields, Time Tracking, Incomplete Warning, AI |
| Project templates | 14 — including Backlogs and Sprints, Hiring Candidates, Support, Creative & Design, Quick Start: Marketing |
| Task statuses | 3 ready-made sets (Development, UI/UX, Marketing) |
| Task types | Task, Sub Task, Bug |
| Currencies | 40 |
| Notification types | 14 |

**Built, but buried or unfinished**

- **A working guided-tour system.** Five tours already exist and run — Project Tour, Project View Tour, Task Tour, Create Project Tour, Project Listing Tour. They only cover projects. Nothing greets a brand-new owner, explains the dashboard, or walks them through inviting the team.
- **We already know how to write good empty screens.** Clips says *"No clips yet. Record one to get started."* Notes says *"No notes yet. Create one to get started."* A new chat group gets a full welcome message. The main screens — projects, tasks, dashboard — get "No Data Found" instead.
- **Every permission has a description field.** It is almost entirely empty, so the settings screen shows around 100 unlabelled switches.

---

## The gaps

Ordered by impact. Effort assumes our team, not a rewrite.

### 1. A new company has no sensible permission defaults
**Impact: High · Effort: Small**

The permission rules are seeded with empty role lists. The Member role gets nothing at all. Guest gets one read-only entry. Until the owner sits down and configures around 100 switches, an invited teammate logs in to a product where most things are hidden.

We checked two real companies. Both had eventually been configured by hand — but completely differently. One grants Guest 23 permissions, the other grants Guest exactly 1. Every company is inventing its own rules from scratch because we never gave them a starting point.

**What we should do:** ship a sensible default set — Member can see projects, create and edit their own tasks, comment, and track time; Guest can view and comment only. Owners can still change everything. This is a data change, not a code change.

### 2. The setup wizard asks questions a normal person cannot answer
**Impact: High · Effort: Medium**

Nine steps, and most of them are infrastructure: database connection string, storage bucket, Firebase, AI key, SMTP. There is no "skip for now" and no plain-language explanation of what any of it is for.

**What we should do:** make everything except the database optional and clearly skippable, with a one-line explanation of what each thing enables and a "you can set this up later" note. Default file storage to the local disk so nobody needs a storage account to try the product.

### 3. The workspace is completely empty on day one
**Impact: High · Effort: Medium**

There is no sample project and no example data. Every competitor solves this somehow: Zoho offers a sample project as one of four choices right after signup, Odoo ships a 24-step tour that makes you build a real project, Asana has you create your first project *during* signup so you land inside your own work.

**What we should do:** create a "Welcome to AlianHub" demo project at company creation, with around ten tasks whose titles and descriptions teach the product — one task per feature (assign someone, set a priority, leave a comment, attach a file, start the timer). Put a clear **"Delete this sample project"** button at the top so it never feels like clutter.

### 4. Our 14 templates are empty shells
**Impact: High · Effort: Medium**

Every template defines columns, task types and which features are switched on — but contains **zero tasks**. Picking "Hiring Candidates" gives you empty columns labelled for hiring, and no idea what goes in them.

By comparison, an Asana template carries tasks, subtasks, milestones, descriptions, assignee placeholders, custom fields and forms, with dates set relative to the project start so they still make sense a year later. Zoho templates carry milestones, task lists and dependencies.

**What we should do:** add 8–15 real sample tasks to our five most useful templates first (Backlogs and Sprints, Hiring Candidates, Quick Start: Marketing, Support, Creative & Design). Not every template needs it on day one.

### 5. Core screens say "No Data Found"
**Impact: High · Effort: Small**

That exact dead-end wording appears in 21 different places. It tells the user nothing.

We have already written good versions elsewhere — Clips and Notes both say "…yet. Create one to get started." The pattern exists; it just was never applied to the screens that matter most.

**What we should do:** rewrite the empty screens for Projects, Tasks, Dashboard, Sprints and Calendar. Each gets one sentence explaining what the screen is for and a button that creates the first item.

### 6. We never ask what the customer actually does
**Impact: High · Effort: Small–Medium**

Every competitor asks. Jira asks which of 14 kinds of work you do. ClickUp asks team size, use case and how complex you want things. Zoho asks for your industry at signup. They use the answer to decide which templates and features to put in front of you.

We ask nothing, so we show a law firm the same "Development" template we show a software team.

**What we should do:** add one question to the wizard — "What does your team mainly do?" with six or seven options — and use the answer to pick which demo project gets created and which templates are shown first. It does not need to change anything structural.

### 7. Nothing tells a new owner what to do next
**Impact: High · Effort: Medium**

After setup there is no checklist, no next step, no suggestion. ClickUp puts a small checklist in the bottom-right corner with items like "import your existing tasks" and "create a new list".

**What we should do:** a small dismissible checklist — create your first project, invite a teammate, create a task, try the Board view, set your notifications. It disappears when finished.

### 8. Our tours only cover projects
**Impact: Medium–High · Effort: Small**

The tour system works and five tours already run. But there is nothing for the moment that matters most — the first login, the empty dashboard, and inviting the team.

**What we should do:** add a short welcome tour using the system we already have. This is the cheapest item on the list relative to its value, because none of the machinery has to be built.

### 9. Template names describe our team, not the customer's work
**Impact: Medium · Effort: Small**

"Development", "UI/UX", "Design", "Marketing" are how *we* think. Competitors name templates after the customer's outcome: "New employee onboarding", "Sales pipeline", "Campaign management", "Bug tracking", "Event planning".

Also worth trimming: our "Backlogs and Sprints" template starts a beginner with nine statuses. Jira's business template starts with three — To Do, In Progress, Done.

**What we should do:** rename the templates to describe the job, add a one-line description and an icon to each, and cut beginner templates down to three or four statuses.

### 10. The permission screen is around 100 unlabelled switches
**Impact: Medium · Effort: Medium**

There is a description field on every permission. It is essentially empty, so the owner sees a long list of switches with short technical names and has to guess.

**What we should do:** write one plain sentence for each permission, group them under clear headings, and add a "simple / advanced" toggle so a small team only sees the ten that matter.

### 11. Roles have no explanation
**Impact: Medium · Effort: Small**

A new company gets four roles — Guest, Owner, Admin, Member — and nine job titles. Nothing on screen says what any of them can actually do.

**What we should do:** one line of description under each role in the members screen.

### 12. New defaults never reach existing companies
**Impact: Medium now, High over time · Effort: Medium**

Default data is written once, when a company is created, and never updated. We measured this on two live companies:

- One is missing a permission that today's code defines.
- Both carry two permissions that no longer exist in the product — switches that control nothing.
- One has a permission the other does not.

So each company slowly drifts away from the product, and the settings screen shows a slightly different list to every customer. Because the settings screen is built from whatever is stored, nobody notices.

**What we should do:** a small startup job that compares each company's defaults against the current list, adds what is missing, and flags what is stale. It must add only — never overwrite what a customer has configured.

### 13. There is no help anywhere in the product
**Impact: Medium · Effort: Small**

No "?" button, no link to the documentation, no tutorial videos. Competitors all keep help one click away in the top bar.

**What we should do:** a "?" in the header linking to help.alianhub.com, plus a "Learn more" link on each empty screen.

---

## How the big players handle day one

| | Sample content on arrival | Templates | Asks about your work | Help for a beginner |
|---|---|---|---|---|
| **ClickUp** | A private Personal List so there is always somewhere to type. Two statuses only: To Do, Complete | ~1,700 | Yes — team size, use case, and how complex you want setup | 19-step signup wizard, checklist in the corner, welcome videos, free university |
| **Asana** | Your own first project, built by you during signup — nothing fake to delete | ~227 | Yes — during the wizard | The wizard *is* the tour; then around 66 guided prompts through your own project |
| **Jira** | Nothing until you pick a template. Sample data exists but is buried in a help article | 40–50 | Yes — 14 categories of work | Guided setup added 2026; AI can now generate a whole workspace from a description |
| **Zoho Projects** | Offers a **sample project** as one of four choices immediately after signup | ~30 | Yes — industry, at signup | Four-way launcher, free beginner video course, regular webinars |
| **Odoo** | No demo data in production, but every user gets seven ready-made personal task columns, and empty screens show greyed-out example rows | Few | Only via which apps you install | A 24-step interactive tour that makes you build a real project, ending in a celebration |
| **AlianHub** | **Nothing.** One empty list called "List" | 14, all empty | **No** | 5 project tours, no welcome |

Two things stand out. First, **nobody ships a big pile of fake data any more** — the modern answer is either a clearly-labelled sample you can delete (Zoho), or making the user build something real during setup (Asana, Odoo). Second, **everybody asks what you do**, and uses the answer.

---

## What I would do first

**Quick wins — days, not weeks**

1. Sensible default permissions for Member and Guest *(gap 1)* — a few hours, and it removes a wall that every single customer hits.
2. Rewrite the empty screens on Projects, Tasks and Dashboard *(gap 5)* — we already have the pattern in Clips and Notes.
3. A welcome tour using the tour system we already built *(gap 8)*.
4. Role descriptions *(gap 11)* and a help link in the header *(gap 13)*.
5. Rename the templates and trim beginner templates to 3–4 statuses *(gap 9)*.

**Next — a few weeks**

6. The "Welcome to AlianHub" demo project with a one-click delete *(gap 3)*.
7. Sample tasks inside the top five templates *(gap 4)*.
8. The "what does your team do?" question, wired to which demo project and templates appear *(gap 6)*.
9. The first-run checklist *(gap 7)*.

**Later — bigger pieces**

10. Simplify the install wizard and make everything but the database optional *(gap 2)*.
11. Write descriptions for all the permissions and add a simple/advanced mode *(gap 10)*.
12. The defaults repair job *(gap 12)*.

---

## The one thing that matters most

**Make the product show itself.** Right now every screen a new user meets is blank, and blank screens teach nothing. A demo project they can poke at, plus templates that actually contain sample tasks, would do more than any amount of documentation — because the user learns by reading real examples in the real interface, which is exactly how Zoho, Asana and Odoo all solve this.

Do gap 1 first, because it is a few hours of work and it currently stops teams from using the product at all. Then spend the next month on gaps 3 and 4.
