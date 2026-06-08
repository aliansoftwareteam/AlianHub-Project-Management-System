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
      <img width="90" src=".gitbook/assets/DEMO_BTN.png" />
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

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.0-4baaaa.svg)](CODE_OF_CONDUCT.md)

</div>

<br/>

---

## Quick Start (One Command)

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

## Tech Stack

AlianHub is built using a pragmatic and scalable stack:

- **Frontend**: Vue
- **Backend**: Node.js
- **Database**: MongoDB
- **Desktop**: Electron
- **Repository Structure**: Single repository

---

## Key Features

- Project and task management
- Team collaboration and role-based access control
- Real-time updates
- Activity tracking and audit logs
- Web and desktop (Electron) support
- Self-hosted deployments

> Features and capabilities may evolve as the project grows.

---

## Getting Started

AlianHub is currently set up by following the official installation documentation.

📘 **Installation & Setup**
- Refer to the [documentation](https://help.alianhub.com) for environment configuration, setup steps, and deployment guidance.

A quick-start guide may be added once the project reaches further stability.

---

## Demo

You can explore a live demo here:

👉 **https://demo.alianhub.com**

> Demo data may reset periodically.

---

## Contributing

Contributions are welcome.

- Anyone can open issues or pull requests
- Pull requests are reviewed by the core maintainers
- A detailed `CONTRIBUTING.md` will be added soon

Please follow:
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)

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

## License

Licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

See the [LICENSE](LICENSE) file for the full license text and [COPYRIGHT](COPYRIGHT) for the copyright notice.

> **What AGPL-3.0 means for you:**
> - ✅ You can use, modify, self-host, and distribute AlianHub freely.
> - ✅ You can run a private modified version internally without publishing changes.
> - ⚠️ If you run a **modified** version as a **public network service** (SaaS), you must publish your modifications under the same license.
> - 📩 Need a different license for commercial / closed-source use? Contact us at [support@aliansoftware.net](mailto:support@aliansoftware.net).
