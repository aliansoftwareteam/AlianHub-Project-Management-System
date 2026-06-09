<div align="center">
<a href="https://alianhub.com">
    <strong style="font-size:32px;">AlianHub</strong>
</a>

<br/>
<br/>

<div align="center">
    <a href="https://alianhub.com">Website</a> |
    <a href="https://help.alianhub.com">Documentation</a> |
    <a href="./CONTRIBUTING.md">Contributing</a>
</div>
<br/>
<div>
    <a href="https://demo.alianhub.com" target="_blank">
      <img width="90" src="https://raw.githubusercontent.com/aliansoftwareteam/AlianHub-Project-Management-System/main/.gitbook/assets/DEMO_BTN.png" alt="Live Demo" />
    </a>
</div>
</div>

<br/>

<div align="center">
<strong>An open-source, full-stack project management system for teams that need control, extensibility, and self-hosting.</strong>
<br/>
<br/>
Built for enterprises, startups, and growing teams — without vendor lock-in.
</div>

<br/>

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.0-4baaaa.svg)](CODE_OF_CONDUCT.md)
[![GitHub release](https://img.shields.io/github/v/release/aliansoftwareteam/AlianHub-Project-Management-System?label=release&color=blue)](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/releases)
[![GitHub Discussions](https://img.shields.io/github/discussions/aliansoftwareteam/AlianHub-Project-Management-System)](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/discussions)
[![GitHub stars](https://img.shields.io/github/stars/aliansoftwareteam/AlianHub-Project-Management-System?style=flat&logo=github)](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/stargazers)

</div>

<br/>

<p align="center">
  <a href="https://demo.alianhub.com" target="_blank">
    <img src="https://raw.githubusercontent.com/aliansoftwareteam/AlianHub-Project-Management-System/main/.gitbook/assets/AlianHub_Main.png" alt="AlianHub — open-source project management dashboard" width="100%" />
  </a>
</p>

<br/>

---

## Quick Start

### 🐳 Option 1 — Docker (recommended for self-hosting)

```bash
# Grab the compose file and run
curl -O https://raw.githubusercontent.com/aliansoftwareteam/AlianHub-Project-Management-System/main/docker-compose.yml
# Set JWT_SECRET (required) — see .env.example for full env-var reference
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d
# AlianHub running at http://localhost:4000
```

Update to a newer version later:

```bash
docker compose pull && docker compose up -d
```

> Images are published to GHCR: `ghcr.io/aliansoftwareteam/alianhub:latest`. Multi-arch (amd64 + arm64).

### 🛠 Option 2 — From source (for developers)

```bash
git clone https://github.com/aliansoftwareteam/AlianHub-Project-Management-System.git
cd AlianHub-Project-Management-System
npm run setup
```

That's it. **No technical knowledge required.** `npm run setup` will:

1. Install all dependencies (root, frontend, wizard) in parallel
2. Generate a `.env` file with secure random secrets
3. Build the installation wizard UI
4. Start the backend and frontend dev server
5. **Auto-complete the installation wizard** — connects to MongoDB, sets up storage, skips optional services (Firebase / AI / SMTP), initializes the database, and creates an admin account
6. Open `http://localhost:8080` in your browser

When it's done, you'll see this in your terminal:

```
──────────────────────────────────────────────────────────
  ✓  AlianHub is ready!
──────────────────────────────────────────────────────────

  URL:       http://localhost:8080
  Email:     admin@admin.local
  Password:  admin123

  API:       http://localhost:4000
  Stop:      Ctrl+C in this terminal
──────────────────────────────────────────────────────────
```

**Prerequisite:** MongoDB running locally on `mongodb://localhost:27017`. If you don't have it: `docker run -d -p 27017:27017 mongo:7` or download from [mongodb.com](https://www.mongodb.com/try/download/community).

### Available commands

| Command | What it does |
|---------|--------------|
| `npm run setup` | Full setup — install, configure, start, auto-complete wizard, open browser |
| `npm run dev` | Fast restart — skips install, just starts the services |
| `npm run setup:reset` | Wipe `node_modules` and reinstall everything |
| `npm run setup -- --manual` | Skip auto-setup — open the interactive wizard instead |
| `npm run setup -- --no-open` | Start without auto-opening a browser |

### Custom admin credentials

```bash
SETUP_ADMIN_EMAIL=you@example.com SETUP_ADMIN_PASSWORD=secret npm run setup
```

Other env-var overrides: `SETUP_ADMIN_FIRST`, `SETUP_ADMIN_LAST`, `SETUP_COMPANY`, `SETUP_PHONE`, `SETUP_COUNTRY`, `SETUP_CITY`, `SETUP_STATE`.

> **Manual setup still works.** Everything above is an additive convenience layer. All existing scripts (`npm start`, `npm run nodemon`, `npm run basic-install`, etc.) and the original interactive wizard are unchanged. If `npm run setup` ever fails it falls back automatically to the wizard UI so you can finish manually.

---

## What is AlianHub?

**AlianHub** is a full-stack, open-source project management system designed for teams that require flexibility, transparency, and ownership over their workflows.

Unlike SaaS-only tools, AlianHub is built to be:
- **Self-hosted**
- **Extensible**
- **Customizable for real-world organizational needs**

It supports both web and desktop environments and is suitable for internal tools, enterprise deployments, and long-term team collaboration.

---

## Architecture

```mermaid
graph TB
    subgraph clients["Clients"]
        Browser["🌐 Web Browser<br/>Vue.js + Pinia"]
        Desktop["💻 Desktop App<br/>Electron"]
    end

    subgraph server["Server (Node.js + Express)"]
        API["⚙️ Express API<br/>/api/v2/*"]
        Socket["⚡ Socket.io<br/>real-time events"]
    end

    DB[("🗄️ MongoDB<br/>company-scoped<br/>multi-tenant")]
    Storage[("📦 Storage<br/>Wasabi S3 or local filesystem")]

    Browser -->|REST + WebSocket| API
    Browser -.->|live updates| Socket
    Desktop -->|REST + WebSocket| API
    Desktop -.->|live updates| Socket
    API --> DB
    API --> Storage
    Socket --> DB
```

> **Key principle:** all data is scoped to `companyId` for multi-tenancy. A single AlianHub instance can host multiple companies, each with isolated data.

Deeper architecture docs: [`.claude/ARCHITECTURE.md`](.claude/ARCHITECTURE.md) · [`.claude/DESIGN.md`](.claude/DESIGN.md)

---

## Tech Stack

AlianHub is built using a pragmatic and scalable stack:

- **Frontend**: Vue
- **Backend**: Node.js
- **Database**: MongoDB
- **Desktop**: Electron
- **Repository Structure**: Single repository

---

## Key Features

- **📋 Project & task management** — Create projects with custom milestones, sprints, statuses, and custom fields. Track tasks across **List, Board, Table, Calendar, and Workload** views with drag-and-drop, sub-tasks, checklists, attachments, comments, due dates, and reminders.

- **👥 Team collaboration with RBAC** — Assign tasks to users, manage role-based permissions per company, and create custom roles with dynamic permission rules. **Multi-tenant by design** — a single instance can host multiple companies, each with isolated data.

- **⚡ Real-time collaboration via Socket.io** — Changes propagate to every connected client instantly. No polling, no stale views, no `F5` refreshes.

- **🔍 Advanced search & saved filters** — Find tasks by project, status, assignee, creator, due date, or priority. Save frequently used filters for one-click reuse.

- **⏱️ Timesheets & reporting** — Project, user, and workload timesheets. Generate milestone and performance reports. Optional productivity tracking (screenshots / keystrokes / mouse events) for time-sensitive teams.

- **🤖 AI assistance** — Generate tasks, subtasks, checklists, descriptions, and project templates with AI. Multiple LLM providers supported.

- **💬 Built-in chat & channels** — Real-time messaging and dedicated channels per project or team.

- **💻 Web + desktop (Electron)** — Identical experience in the browser and as a native desktop app. **Multi-language UI** via vue-i18n.

- **🏠 Self-hosted, your data** — Run on your own servers with MongoDB and Wasabi/S3 (or local filesystem) storage. **No vendor lock-in, no per-seat pricing, no data leaving your infrastructure.**

> Features evolve continuously — see [ROADMAP.md](ROADMAP.md) for what's next and [CHANGELOG.md](CHANGELOG.md) for what just shipped.

---

## 📸 Screenshots

A quick tour of AlianHub. [Try the live demo](https://demo.alianhub.com) to explore for yourself.

### Dashboard

<p align="center">
  <a href="https://demo.alianhub.com" target="_blank">
    <img src="https://raw.githubusercontent.com/aliansoftwareteam/AlianHub-Project-Management-System/main/.gitbook/assets/screenshots/dashboard.png" alt="AlianHub customizable dashboard showing task-by-assignee, workload-by-status, and calendar widgets" width="100%" />
  </a>
</p>

<p align="center">
  <em>Customizable home dashboard with drag-to-arrange widgets — Task by Assignee, Workload by Status, and a live Calendar view.</em>
</p>

### Board View (Kanban)

<p align="center">
  <a href="https://demo.alianhub.com" target="_blank">
    <img src="https://raw.githubusercontent.com/aliansoftwareteam/AlianHub-Project-Management-System/main/.gitbook/assets/screenshots/board-view.png" alt="AlianHub Kanban board showing tasks grouped by status columns with due dates, assignees, and priority indicators" width="100%" />
  </a>
</p>

<p align="center">
  <em>Drag-and-drop Kanban board grouped by status (or any field). Cards show due date, assignee, priority, and sub-task count. Switch the same project to <strong>List, Table, Calendar, Workload</strong>, or a custom view at any time.</em>
</p>

### List View

<p align="center">
  <a href="https://demo.alianhub.com" target="_blank">
    <img src="https://raw.githubusercontent.com/aliansoftwareteam/AlianHub-Project-Management-System/main/.gitbook/assets/screenshots/list-view.png" alt="AlianHub list view with tasks grouped by status, showing assignee, due date, priority, and bulk-action toolbar" width="100%" />
  </a>
</p>

<p align="center">
  <em>Dense list view grouped by status with sortable columns — Chat, Assignee, Due Date, Priority, Key, Created Date, Created By. Select one or many tasks to bulk-edit status, priority, assignees, due dates, tags, or delete/archive in a single click.</em>
</p>

### Calendar View

<p align="center">
  <a href="https://demo.alianhub.com" target="_blank">
    <img src="https://raw.githubusercontent.com/aliansoftwareteam/AlianHub-Project-Management-System/main/.gitbook/assets/screenshots/calendar-view.png" alt="AlianHub monthly calendar view with tasks and sub-tasks as color-coded bars spanning days" width="100%" />
  </a>
</p>

<p align="center">
  <em>Monthly calendar with tasks rendered as color-coded bars spanning their start and due dates. Sub-tasks appear inline with their parent. Filter by yourself or any assignee, navigate month-to-month, or jump to today.</em>
</p>

### Task Detail

<p align="center">
  <a href="https://demo.alianhub.com" target="_blank">
    <img src="https://raw.githubusercontent.com/aliansoftwareteam/AlianHub-Project-Management-System/main/.gitbook/assets/screenshots/task-detail.png" alt="AlianHub task detail view showing description, sub-tasks, custom fields, and right-side metadata panel with status, assignees, dates, and time estimates" width="100%" />
  </a>
</p>

<p align="center">
  <em>Full task editor with <strong>Task Details, Comments, Activity Log, and Time Log</strong> tabs. Add sub-tasks, define unlimited custom fields (text, number, email, checkbox, currency, etc.), attach files, and track estimated vs. actual hours in the always-visible right sidebar.</em>
</p>

### Workload Report

<p align="center">
  <a href="https://demo.alianhub.com" target="_blank">
    <img src="https://raw.githubusercontent.com/aliansoftwareteam/AlianHub-Project-Management-System/main/.gitbook/assets/screenshots/workload-report.png" alt="AlianHub weekly workload timesheet showing logged vs. planned hours per user, drillable into projects and tasks" width="100%" />
  </a>
</p>

<p align="center">
  <em>Weekly <strong>workload + timesheet</strong> in a single view — see logged vs. planned hours per user, drill down into projects and individual tasks, navigate any date range, and toggle between automatically tracked time and manual entries. A capacity-planning differentiator that most open-source PMS tools don't ship.</em>
</p>

### Settings & Customization

<p align="center">
  <a href="https://demo.alianhub.com" target="_blank">
    <img src="https://raw.githubusercontent.com/aliansoftwareteam/AlianHub-Project-Management-System/main/.gitbook/assets/screenshots/settings.png" alt="AlianHub company settings page with task priorities, milestone statuses, multi-currency support, and a deep customization sidebar" width="100%" />
  </a>
</p>

<p align="center">
  <em>Deep, per-company customization — company info, <strong>custom task priorities with icons</strong>, milestone statuses with past/future calendar visibility, multi-currency support, members & teams, project templates, custom field manager, role-based security &amp; permissions, time-tracking rules, and notification preferences.</em>
</p>

### AI Assist

<p align="center">
  <a href="https://demo.alianhub.com" target="_blank">
    <img src="https://raw.githubusercontent.com/aliansoftwareteam/AlianHub-Project-Management-System/main/.gitbook/assets/screenshots/ai-assist.png" alt="AlianHub AI assist modal with prompt templates across Marketing, Sales, Email, SEO, and Services" width="100%" />
  </a>
</p>

<p align="center">
  <em>AI available everywhere — generate tasks, sub-tasks, checklists, project plans, and task descriptions from natural language. Pre-built prompt templates across <strong>Marketing, Sales, Email, SEO, and Services</strong> to jump-start your work without staring at a blank field.</em>
</p>

<!-- More screenshots added here as new modules are captured -->

---

## Documentation

📘 **Full user guide & API reference:** [help.alianhub.com](https://help.alianhub.com)

For development:

- 🤝 [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute
- 🌿 [BRANCHING.md](BRANCHING.md) — branching strategy and PR workflow
- 🛡️ [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — community standards
- 🔒 [SECURITY.md](SECURITY.md) — responsible disclosure for security issues
- 🆘 [SUPPORT.md](SUPPORT.md) — where to ask questions, report bugs, request features

---

## Demo

You can explore a live demo here:

👉 **https://demo.alianhub.com**

> Demo data may reset periodically.

---

## Roadmap

What we're working on, what's planned, and what we're considering — see [ROADMAP.md](ROADMAP.md).

Want to suggest something? [Open a feature request](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues/new?template=feature_request.yml) or [start a discussion](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/discussions).

---

## Contributing

Contributions are welcome — bug reports, feature ideas, documentation fixes, and pull requests of all sizes.

📖 **Start here:**

- 🤝 [CONTRIBUTING.md](CONTRIBUTING.md) — how to submit issues and PRs
- 🌿 [BRANCHING.md](BRANCHING.md) — branch model and PR workflow
- 🛡️ [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — community standards
- 🔒 [SECURITY.md](SECURITY.md) — responsible disclosure for security issues

Looking for something to work on? Browse [good first issues](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) or [help wanted](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22).

---

## Support & Community

| What | Where |
|---|---|
| 📘 **Read the docs** | [help.alianhub.com](https://help.alianhub.com) |
| 💬 **Ask a question** | [GitHub Discussions](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/discussions) |
| 🐛 **Report a bug** | [Bug Report issue](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues/new?template=bug_report.yml) |
| 🚀 **Request a feature** | [Feature Request issue](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues/new?template=feature_request.yml) |
| 🏢 **Commercial support** | [support@aliansoftware.net](mailto:support@aliansoftware.net) |

Full guide: [SUPPORT.md](SUPPORT.md).

---

## Governance

AlianHub is currently maintained by **core maintainers (company-backed)**.

The long-term goal is to transition toward a **community-driven project with dedicated maintainers**.

---

## Security

If you discover a security vulnerability, **do not open a public issue**.

Please report it responsibly using GitHub Security Advisories as described in  
[`SECURITY.md`](SECURITY.md).

---

## Contributors ♥️ Thanks

We extend our gratitude to all our numerous contributors who create plugins, assist with issues and pull requests, and respond to questions on GitHub Discussions.

AlianHub Project-Management-System is a community-driven project, and your contributions continually improve it.

<br/>

<a href="https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=aliansoftwareteam/AlianHub-Project-Management-System&max=400&columns=20" />
</a>

---

## Repo Activity

[![GitHub commit activity](https://img.shields.io/github/commit-activity/m/aliansoftwareteam/AlianHub-Project-Management-System?label=commits%2Fmonth)](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pulse)
[![Last commit](https://img.shields.io/github/last-commit/aliansoftwareteam/AlianHub-Project-Management-System)](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/commits)
[![Closed PRs](https://img.shields.io/github/issues-pr-closed/aliansoftwareteam/AlianHub-Project-Management-System?label=PRs%20merged)](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pulls?q=is%3Apr+is%3Aclosed)
[![Open issues](https://img.shields.io/github/issues/aliansoftwareteam/AlianHub-Project-Management-System)](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues)

<!--
  To replace the badges above with a richer sparkline embed (like
  Plane's https://repobeats.axiom.co/api/embed/<hash>.svg), sign up
  at https://repobeats.axiom.co with this repo and paste the
  generated URL here.
-->

---

## License

Licensed under the **MIT License**.  
See the [LICENSE](LICENSE) file for details.
