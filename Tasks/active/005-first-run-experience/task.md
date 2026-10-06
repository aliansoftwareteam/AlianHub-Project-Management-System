---
id: 005
title: First-run experience — close the 13 gaps
status: active
priority: high
depends_on: []
created: 2026-08-25
---

# First-run experience — close the 13 gaps

## Goal

A person who has never seen AlianHub should be able to install it, land on the dashboard, and
understand what the product is and what to do next — without a developer, without documentation,
and without a blank screen.

Today none of that is true. Every core screen a new user meets is empty, all 14 project templates
contain zero tasks, a newly invited teammate has no permissions at all, and the setup wizard opens
by asking for a database connection string.

## Scope

The 13 gaps identified in `resources/first-run-experience-gaps.md`, grouped as they are in the
tracker:

**AHE-3932 — quick wins**
1. Sensible default permissions for Member and Guest
5. Real empty screens on Projects, Tasks, Dashboard, Sprints, Calendar
8. A welcome tour for a brand-new owner
9. Template names that describe the customer's work, and fewer beginner statuses
11. Role descriptions in the members screen
13. A help link in the header and on empty screens

**AHE-3933 — make the product show itself**
3. A "Welcome to AlianHub" demo project with one-click delete
4. Sample tasks inside the five most useful templates
6. Ask what the team does, and use the answer
7. A first-run checklist

**AHE-3934 — the bigger pieces**
2. Simplify the install wizard — everything but the database becomes optional
10. Plain-language descriptions for every permission, plus a simple mode
12. A defaults check that keeps existing companies current

## Out of scope

- Rewriting the permission model itself. Defaults change; the mechanism does not.
- Redesigning the dashboard. Empty states are in scope, layout is not.
- Backfilling demo projects into companies that already exist.
- Any change to the chat channel side of the sprints collection.
- Translating new copy into the other 11 locales beyond English.

## Acceptance criteria

- [ ] A Member invited into a brand-new company can create and edit tasks without the owner
      opening the settings screen first
- [ ] Projects, Tasks, Dashboard, Sprints and Calendar explain themselves when empty and offer a
      button, instead of showing "No Data Found"
- [ ] A brand-new owner is offered a welcome tour on first login
- [ ] Every role shows a one-line description; every permission shows a plain-language description
- [ ] Help is reachable from the header on every screen
- [ ] Template names describe the job, and no beginner template starts with more than four statuses
- [ ] A new company arrives with a demo project of readable example tasks, removable in one click
- [ ] The five chosen templates create projects that already contain sample tasks
- [ ] Setup asks what the team does, and the answer visibly changes what gets created
- [ ] A new owner sees a dismissible checklist of next steps
- [ ] The install can be completed with only a database; every other step is skippable
- [ ] The defaults check adds what is missing, overwrites nothing a customer configured, and is
      safe to run twice
- [ ] **No existing functionality or module breaks** — verified per change, not just at the end

## Constraints & notes

- **Nothing existing may break.** This is the user's hard constraint and it outranks completeness
  on any individual gap.
- Mongoose runs `strict: true`. A field that is used but not declared in the schema is silently
  dropped — it works in-session and vanishes after a reload. Declare first, then use.
- The `sprints` collection also stores chat channels (`mainChat: true`). Any query or mutation
  added here must exclude them.
- Roles are dynamic per company. Only roleType 1 (Owner) and 2 (Admin) are fixed. Never hardcode
  any other role number — this has caused a production incident before.
- Seeds run once at company creation. Changing a seed affects new companies only, which is exactly
  why gap 12 exists.
- `POST /api/v1/importSettings` takes its `companyId` from the request body and never compares it
  to the caller's session. That is a separate, known security issue — do not build on that pattern,
  and do not widen it.
- Changes stay **local and uncommitted** until the user says otherwise.

## Resources

- `resources/first-run-experience-gaps.md` — the full review: what ships today, how ClickUp,
  Asana, Jira, Zoho and Odoo handle day one, and the 13 gaps with suggested fixes
- Tracker: AHE-3929 (parent), AHE-3930, AHE-3932, AHE-3933, AHE-3934
