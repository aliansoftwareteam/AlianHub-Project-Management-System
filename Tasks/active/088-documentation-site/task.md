---
id: 088
title: Documentation site — in-depth user, admin, developer and API docs to replace help.alianhub.com
status: active
priority: high
depends_on: []
created: 2026-11-02
---

# Documentation site — in-depth user, admin, developer and API docs to replace help.alianhub.com

## Goal
Replace the two-year-old GitBook site at https://help.alianhub.com/ with documentation that lives in the repo, is built from it, and serves both people who manage work and the developers and admins who run and extend AlianHub — on par with mature open-source projects (GitLab, Plane, Mattermost, Supabase).

## What the old site covers (inventory, read 2026-11-02)
GitBook, about 60 pages in four groups:
- **App installation and start guide** (CodeCanyon buyers): Node.js configuration, generate a licence key, server startup, installation wizard (domain, MongoDB, Wasabi, Firebase, AI, payment — Chargebee and Paddle, Gmail SMTP, database initialisation, final builds), time tracker configuration.
- **Introduction to AlianHub**: create an account, user dashboard, create a project, project dashboard (folders, sprints, tasks, subtasks, time log, milestones, estimated hours), List, Activity, Calendar, Board, Workload, Table and Embed views, comments, project details, chats and channels, close or reopen a project, timesheet reports, milestone report, settings (company, projects, templates, upgrade plan, security and permissions, personal).
- **cPanel hosting guide**: Setup Node.js App, application root, startup file, upload, npm install, start, environment variables.
- **Docker installation** and **FAQs** (32 questions).

Nothing from it is lost: each topic maps to a page in the new site (getting-started/, user-guide/, admin/install-*, help/faq). Obsolete items (CodeCanyon licence key, Firebase push setup, Paddle) are not carried over because the current code no longer uses them.

## Decisions (made autonomously; owner away overnight)
- **VitePress 1.6** in a top-level `docs-site/` folder with its own `package.json` (`npm run docs:dev`, `docs:build`, `docs:preview`). The app is Vue, VitePress needs no extra framework, ships local search, dark mode, edit links and a dead-link check.
- **`docs/` stays where it is.** `npm run api:doc` and `npm run version:log` write there and other files link to it. The site *ports* the content of `docs/guide`, `docs/ADMIN-GUIDE.md`, `docs/ENV.md`, `docs/DEVELOPER-GUIDE.md`, `docs/MCP-AGENT-GUIDE.md`, `docs/CONNECT-YOUR-AI.md` and `.claude/*.md`. Retiring the duplicates (or pointing them at the site) is a follow-up for the owner.
- **API reference is generated, never hand-written.** `docs-site/scripts/build-api-reference.mjs` splits `docs/API.md` into one page per section at build time, rewrites its in-page links and copies `docs/api/openapi.json` to `/openapi.json`. The generated pages and sidebar are gitignored, so they cannot drift.
- **Brand**: AlianHub indigo `#2F3990` (light) and lavender `#A892FF` (dark) from `frontend/src/assets/css/tokens.css`, the app logo and favicon, Inter Tight / JetBrains Mono.
- **Edit links** point to `main` on GitHub (`docs-site/<path>`). Generated API pages turn them off.
- **Screenshots** come from a local server (port 4430) against the demo database, signed in as the demo owner, read-only. They live in `docs-site/public/screenshots/`.
- Reports, timesheet screens and Ask AlianHub are being reworked in parallel (tasks 086, 087); their pages describe purpose and main steps, not pixel detail.
- **Hosting (decided with the owner, 2026-11-03):** GitHub Pages at https://docs.alianhub.com, free for the public repo. `.github/workflows/docs.yml` builds on pull requests and deploys from `main`; `docs-site/public/CNAME` holds the domain. The owner turns on Pages (Source: GitHub Actions) and adds the DNS record `docs` CNAME `aliansoftwareteam.github.io`.
- Pointing the in-app help links (`brandSettings.json`, `TaskFilter.vue`, `Modules/Admin/common/controller.js`, `Modules/Scim/discovery.js`) at the new site are for the owner to decide.

## Information architecture
- **Getting started** — what AlianHub is, quick tour, concepts glossary, "Your first hour" (9 steps).
- **User guide** — projects, folders/lists/sprints, tasks, milestones, custom fields, rules, templates, views (overview + List, Board, Table, Calendar, Gantt, Workload, Embed), docs and whiteboards, chat and Inbox, notifications, people and roles, settings, time and timesheets, approvals, reports, desktop tracker, Ask AlianHub, agents, integrations, import from ClickUp.
- **Connect your AI** — connect, what it can do, approve, undo, limits, what it sees, audit log, things to say, team packs; MCP server reference and AI architecture for builders.
- **Admin guide** — requirements, Docker, manual (incl. cPanel), first run, HTTPS, Instance console, env reference, storage, mail, OAuth/SSO/SCIM, AI providers, security, upgrades, backups, monitoring, troubleshooting.
- **Developer guide** — architecture, module layout, multi-tenancy, Socket.io events, frontend, local setup, writing a module, agent actions and MCP tools, conventions, i18n, design tokens, testing, contributing, releases.
- **API** — generated from `docs/API.md`.
- **Help** — FAQ, troubleshooting, changelog, getting help.

## Scope
- `docs-site/` (config, theme, pages, generator script, screenshots), `.gitignore` entries for its build output and generated pages.
- This task folder and its row in `Tasks/index.md`.

## Out of scope
- Any application code change (including the in-app help links).
- Deploying the site or touching help.alianhub.com.
- Translating the docs into other languages.
- Deleting or moving files in `docs/`.

## Acceptance criteria
- `cd docs-site && npm install && npm run docs:build` succeeds with no dead links.
- Every sidebar entry opens a page with real content (no placeholders); user pages explain the why and the how with steps; developer pages cite real paths.
- Local search, sidebar, edit-on-GitHub links, light and dark theme with AlianHub branding work in the browser.
- Key user pages carry real screenshots.
- `progress.md` lists the pages that are still thin.
