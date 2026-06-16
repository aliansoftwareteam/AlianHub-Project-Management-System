# AlianHub Roadmap

This page sets out two things: our **commitment on what stays free**, and where the project is **heading next**.

---

## Our promise: free stays free

Everything that works in AlianHub today — and everything marked _planned_ below — is and will remain **free and open-source under AGPL-3.0**. We will **not** move a feature that works today behind a paywall. This is a deliberate, public commitment so teams can adopt AlianHub without fear of a future bait-and-switch.

### Always free

- **All project views** — List, Board (Kanban), Table, Calendar, Workload — and the upcoming **Gantt / timeline**
- **Time tracking** — timesheets plus optional screenshots / activity capture, and the desktop tracker
- **Custom fields**, **custom roles**, and per-company **RBAC**
- **Dashboards & widgets**
- **Sprints, milestones & reports**
- **AI** task / sub-task / project generation (using your own provider API key)
- **Built-in chat & channels**, real-time sync
- **Webhooks, importers, public share links, API tokens**
- **Self-hosting** with full data ownership — no per-seat pricing, no telemetry lock-in

### What may become paid (new enterprise add-ons)

To fund sustained development, some **enterprise-grade** capabilities may ship as paid add-ons. These are needs that teams without compliance or large-scale governance requirements generally don't miss — and they are **new** capabilities, never a take-back of what's free today:

- **SAML / SCIM / LDAP** single sign-on & user provisioning
- **Audit-log API** & advanced governance / retention controls
- **Managed cloud hosting** (we run it for you)
- **SLA-backed priority support**

> If a future paid add-on is ever built on top of something free today, the free version keeps working. The boundary moves _up_ (new enterprise features), never _down_.

---

## Where we're heading

This is direction, not a dated commitment. For what *just* shipped, see [CHANGELOG.md](CHANGELOG.md).

### 🔭 Now
- Third-party sign-in hardening and additional OAuth providers
- Platform integration surface (webhooks, API tokens, public REST API)

### 🛠 Next
- **Gantt / timeline view** with dependencies and milestones — the most-requested missing view
- Velocity & cumulative-flow reports on top of sprints
- More first-class integrations (Slack/Discord presets, n8n)

### 💡 Later / exploring
- Additional importers (Trello, Jira)
- Recurring tasks
- Guest / client role + read-only public boards
- Deeper automation rules

---

## Suggest something

Have an idea or a need? We prioritize from real demand:

- 💬 [Start a discussion](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/discussions)
- 🚀 [Open a feature request](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues/new?template=feature_request.yml)

_This roadmap is a living document and will change as priorities and community feedback evolve. The "free stays free" commitment above will not._
