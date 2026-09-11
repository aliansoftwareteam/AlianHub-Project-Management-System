---
id: 034
title: End-to-end QA programme — sweep every function, keep it covered in CI
status: active
priority: high
depends_on: []
created: 2026-09-11
---

# 034 — End-to-end QA programme — sweep every function, keep it covered in CI

Status: active · runs in parallel with the sprint work, one agent per area · owner decision 2026-09-11

## Goal
Every function of AlianHub is exercised end to end, through the API and the browser, as each role, and stays covered by an automated suite that runs on every pull request, while development continues in parallel.

## Why
There was no end-to-end tooling on 2026-09-11. The 166 backend test files run against a fake database and the 16 frontend specs are unit tests; CI runs lint, those tests and the build. The product has 100 modules, 656 API routes and 88 screens, and bugs that only appear with a real database, a real browser or a second role have no net.

## Scope
1. **Demo team (local only).** A seed creates eight people with IT roles (engineering manager as admin, frontend, backend, QA, design, DevOps, business analyst, and an intern on the most restricted role), a "QA Sandbox" project with a sprint and realistic tasks, and four demo AI agents at autonomy L1 scoped to that project. It refuses non-local databases and production, tags what it creates, and has an unseed. Passwords are written only to a gitignored local file; QA scripts get short-lived session tokens from a local-only script, so nobody types a password.
2. **Harness.** Playwright for screens and a jest `integration` project for the API, both against a throwaway MongoDB (port 27018 locally, a service container in CI), with fixtures that create each role through the real APIs. A CI `e2e` job runs on pull requests. `docs/TESTING-E2E.md` explains how to add an area.
3. **Area waves.** One agent per area, each doing both halves:
   - **Sweep:** exercise every route and screen of the area on the local server as owner, admin, member and the restricted role, using the demo team. Write `findings/<area>.md` with severity, reproduction and the failing request or screen. Only change records created during the sweep.
   - **Suite:** turn the checked behaviour into `tests/integration/<area>.int.test.js` and `e2e/specs/<area>.spec.js`, including a regression test for every confirmed finding.

   | Area | Modules |
   |---|---|
   | Access and accounts | Auth, SSO, Scim, OAuth, googleOAuth, githubOAuth, gitlabOAuth, ApiTokens, Users, UserId, Setup, Company, Teams, trackerUserPermission |
   | Projects and planning | Project, createProject, projectSetting, projectRules, projectTabs, projectClose, ProjectTemplates, ProjectDashboard, Milestone, Epics, Sprints, Portfolio, CapacityPlanning, Calendar, RecurringTasks |
   | Tasks and collaboration | Tasks, taskIndex, Comments, Reactions, CustomField, AdvancedGlobalFilter, GlobalSearch, History, RecentVisits, PersonalList, Notes, Clips, MediaFiles, storage, CloudStorage, Trash |
   | Time and money | TimeSheet, LogTime, TimesheetApproval, EstimatedTime, Pto, ScreenshotRetention, trackerDownload, Invoice, SubscriptionPlan, subscription, PlanFeature, Affiliate, VarianceReport |
   | Messages and inbox | notification, notification1, notification-count, EmailNotification, emailTemplate, EmailIn, Inbox, MainChats, Calls, Reminders, GeneralReminders, Changelog, tours |
   | Pages, forms, import and export | Pages, Forms, PublicShares, Export, ExportJobs, Importers, ImportSettings, Apps |
   | Reports and integrations | UserDashboard, CustomReports, AgileReports, ScheduledReports, Webhooks, Integrations |
   | Automations and AI features | Automations, AI, AIProjectGenerator, Mcp |
   | AI agents | Agents, AICore |
   | Instance and administration | Instance, settings, Admin, Audit, common, Template, swaggerAPI, typesense |

4. **Fixes in parallel.** Each confirmed finding of high or critical severity becomes a fix PR from a development agent while the next wave runs; the rest are filed into the owning task or `Tasks/backlog/021-maintainability-leftovers/`.

## Out of scope
- Load and performance testing.
- Security testing beyond role and scope checks (Sprint 8, task 031).
- The desktop tracker app and mobile clients.
- Flows that need real third-party accounts (Slack, GitHub, Google, Microsoft); tested up to the redirect or the stored configuration only.
- Email delivery, because SMTP is not configured locally.

## Acceptance
- [ ] Demo seed and unseed are idempotent and refuse non-local databases; the member session can call the API with member restrictions applied.
- [ ] The `e2e` CI job runs the integration and Playwright suites against a throwaway database and is green on `beta`.
- [ ] Every area has a findings report listing the routes and screens exercised against the area total, per role.
- [ ] Every area has an integration spec and a Playwright spec in CI, with a regression test per confirmed finding.
- [ ] Every critical and high finding is fixed and merged, or filed with an owner and a reason.

## Decisions
- Owner, 2026-09-11: sweep now and build the permanent suite, in parallel with development; demo team members with IT roles and demo agents for the member-role checks.
- Claude never types a password or creates an account through a sign-up form; demo users are local test data created by script, and API sessions come from a local-only token script.
- The CI suite never touches anyone's data: its own database, its own fixtures, created fresh per run.
