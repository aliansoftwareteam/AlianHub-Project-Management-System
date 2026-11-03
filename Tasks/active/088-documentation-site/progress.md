# Progress: Documentation site — in-depth user, admin, developer and API docs to replace help.alianhub.com

## Checklist

- [x] Inventory the old help site (GitBook, ~60 pages) and the repo docs
- [x] PRD (`task.md`) with decisions and information architecture
- [x] VitePress scaffold in `docs-site/`: config, sidebar, brand theme, local search, edit links, home page
- [x] API reference generated from `docs/API.md` (`scripts/build-api-reference.mjs`)
- [x] Getting started and user guide pages
- [x] Connect your AI pages
- [x] Admin guide pages
- [x] Developer guide pages
- [x] Help pages (FAQ, troubleshooting, changelog, support)
- [x] Screenshots from a local server (26 screens, 29 placements)
- [x] `npm run docs:build` with no dead links; checked in the browser (home, a guide page, an API page, dark mode, search)
- [x] Committed locally on `docs/documentation-site`
- [ ] Owner review
- [x] Hosting decided: GitHub Pages at docs.alianhub.com (workflow, CNAME, sitemap)
- [ ] Owner: Settings → Pages → Source: GitHub Actions; DNS `docs` CNAME `aliansoftwareteam.github.io`; Enforce HTTPS
- [ ] Point the in-app help links at docs.alianhub.com (follow-up)

## Last step

Site builds clean (92 written pages + 23 generated API pages, about 130,000 words). Committed locally, not pushed. Waiting for the owner's review.

## Pages still thin or unverified

- `user-guide/views/table.md` — short; little is Table-only.
- `user-guide/views/embed.md` — Comments, Activity, Dashboard, Reports, Mind Map and Canvas views get a few sentences each, from their `en.js` descriptions.
- `user-guide/milestones.md` — refund button name, whether the example statuses are the defaults, and what **Past** / **Future** does are unverified.
- `user-guide/templates.md` — the **Settings › Templates › New** steps are general.
- `user-guide/reports.md` — variance, capacity and portfolio sections are general (reports are being reworked in 086).
- `user-guide/ai-ask.md` — kept general; @-mentions left out while 087 lands.
- `user-guide/time-tracker-app.md` — who may use the tracker, whether admins see every recording, and auto-update are unverified (one code comment says there is no auto-updater, the tracker README describes one).
- `user-guide/integrations.md` — Teams, Zapier, GitLab and two-way Google Calendar save settings but nothing syncs; the page says so.
- `user-guide/notifications.md` — Quiet hours and Daily digest are saved but not applied yet; the page says so.
- `user-guide/agents.md` — how a run starts from "assign an agent" or a comment mention is from labels, not traced.
- `ai/connect.md` — no source documents Cursor; mentioned without steps.
- `ai/audit-log.md` — "Gated actions" and "Refusals" tabs listed by name only.
- `ai/architecture.md` — condensed from the 2026-09-10 review; may be out of date (the page says so).
- `developer/agent-actions.md`, `ai/mcp-server.md` — near-verbatim ports that keep the source's "To check" notes.
- `developer/writing-a-module.md` — the `Foo` example uses real helpers but is not a module in the repo.
- `admin/requirements.md` — RAM tiers are estimates built from the 2026-11-02 load test.
- `admin/install-manual.md` (cPanel), `admin/https.md` (nginx, Caddy), systemd/pm2 and mongodump examples — standard examples, not run on real hosting.
- `admin/mail.md` — Gmail app password and Microsoft 365 SMTP steps describe Google's and Microsoft's screens from general knowledge.
- Screens with no screenshot yet: setup wizard, Create Project window, custom field manager, ClickUp import, notification settings, My settings, tracker connect screen, Embed picker. The Gantt screenshot shows the empty state (the demo tasks have no start dates).

## Where the code differs from the older docs (the new pages follow the code)

- Storage also accepts `s3` and `S3_*` keys; mail tries Amazon SES before Resend and SMTP; AI has `openai_compatible` and `google` providers; the third OAuth provider is GitLab, not Microsoft; two-factor is per person, not enforceable.
- Socket events are `socketEmitter.emit('update', { module, companyId, … })`, not `emitEvent('TASK_UPDATED')` as `CLAUDE.md` shows; each company has its own database; the frontend store is Vuex, not Pinia; company-scoped routes go in the `verifyJWTTokenWithCRoute` list. `CLAUDE.md` and `.claude/*.md` could be corrected in a follow-up.

## Findings for the owner (not fixed here — no app code changes)

- `.env.example` ships sample `SOCKETIO_ADMIN_USERNAME` / `SOCKETIO_ADMIN_PASSWORD_HASH` values, and `npm run setup` copies them into `.env`, which turns on the Socket.IO admin page. The admin docs tell people to clear them; the example file should probably be fixed.
- The demo owner account on the live demo has its language set to Chinese, so the live demo opens partly in Chinese. Screenshots here forced English in the screenshot browser only.
- In-app help links still point at help.alianhub.com: `brandSettings.json`, `frontend/src/components/molecules/TaskFilter/TaskFilter.vue`, `Modules/Admin/common/controller.js`, `Modules/Scim/discovery.js`.
- `docs/guide/`, `docs/ADMIN-GUIDE.md`, `docs/DEVELOPER-GUIDE.md`, `docs/CONNECT-YOUR-AI.md`, `docs/MCP-AGENT-GUIDE.md` now duplicate site pages. Retire them or make them stubs pointing at the site, once hosting is decided.

## Blockers

None.

## Log

### 2026-11-03
- Header gained a **Try the live demo** button.
- Hosting: GitHub Pages workflow `.github/workflows/docs.yml`, `docs-site/public/CNAME`, sitemap for docs.alianhub.com. Branch rebuilt on `origin/staging` and opened as a PR into `staging`.

### 2026-11-02
- Worktree reset to `origin/chore/pre-staging` and branch renamed `docs/documentation-site`.
- Old site read through its `llms.txt` index and page Markdown (read only). Inventory recorded in `task.md`.
- VitePress 1.6.4 installed inside `docs-site/` only.
- Pages written in four parallel passes (getting started + user guide A; user guide B + help; admin; developer + AI), each read against the code and the existing `docs/` and `.claude/` sources.
- Screenshots: local server on :4430 against the demo database with migrations, cron, queue, indexer and agent engine off; demo login; `npm run atlas` (its read-only filter refuses every write in the browser), light theme, 1440×900, demo banner hidden, English forced. Converted to WebP (1.1 MB total).
- Build fixes: a bare `<event>` in `rules.md` and an inline `{{task.TaskName}}` that Vue interpolated; `env` fences switched to `ini`.
- `.claude/launch.json` gained a `docs-site` entry (preview on :4173).
