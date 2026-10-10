---
id: 049
title: Each project picks its own GitHub repositories
status: active
priority: high
depends_on: []
created: 2026-10-10
tracker: AP-524
---

# 049 — Each project picks its own GitHub repositories

Owner decision (2026-10-10): one GitHub sign-in per workspace (the App connections GitHub connection, OAuth, #1607/#1619/#1625), and each **project** picks its own repositories.

## Goal

Replace the single `config.repo` + `projectIds` on the GitHub connection with a mapping `repos: [{ repo: 'owner/name', projectIds: [...] }]`. A project may map to several repositories and a repository may feed several projects. Pull requests sync per repository, and only into that repository's projects.

## Scope

1. **Data.** `repos` on the connection row (declared in the strict schema). Each entry keeps its own sync state (`sync.cursor`, failures, backoff). Migration 075 turns `config.repo` + `projectIds` into one entry. Code reads the old shape until the row is migrated, and upgrades a row the first time the mapping API writes it.
2. **API** (owner/admin, `agentsRefused('integration.update')`):
   - `POST /api/v1/integrations/connections/:id/repos` `{ repo, projectId }` adds a mapping; the token must read the repo (`canReadRepo`), the project must be a live, non-personal project of the workspace that the person who connected GitHub can open.
   - `DELETE /api/v1/integrations/connections/:id/repos/:projectId?repo=owner/name` removes it.
   - `GET /api/v1/integrations/github/projects/:projectId` the project's view: connected or not, may manage, one-click ready, the repositories mapped to it, any egress block. Anyone who can open the project reads it.
   - `GET /api/v1/integrations/github/authorize?projectId=` signs the return path into the OAuth state, so the sign-in comes back to that project's details tab. The origin allow-list stays.
   - Audit, socket emit and cache clear like the sibling routes. `PUT /connections/:id/repo` goes; `PUT /connections/:id/projects` refuses a GitHub row once it holds a mapping (projects are chosen per repository).
3. **Sync.** The runner loops over the mapped repositories, each with its own cursor and backoff; a pull request's task keys match only within that repository's projects. No repository mapped: "waiting", not a failure.
4. **MCP `pull_request.get`.** The repositories that apply come from the task's project. With a number or address, the tool takes `repo`, which must be mapped to a project the caller can see; when the caller's projects map to several repositories and none is named, it asks which one. The #1622 access rules stay.
5. **UI.**
   - App connections GitHub card: a Project → Repository table with Add (pick project, pick repository from the picker with search, Save always visible) and Remove.
   - Project details tab: a "GitHub repositories" card. Not connected: "Connect GitHub" (owner/admin; returns to this project) or "Ask an admin to connect GitHub." Connected: the project's repositories, "Add repository" (picker) and Remove for admins. Egress blocked: the same message and "Allow api.github.com" button as the card (one shared component).
   - Project header: a small GitHub chip naming the mapped repositories, opening the card.
6. **Tests.** Migration; mapping API (rights, other company, unreadable repository, project the connector cannot open); sync isolation (a PR in repo A never touches a project mapped only to B); MCP tool with two repositories; vitest for the table, the project card (not connected admin/non-admin, connected with none, adding, return after OAuth) and the chip.

## Out of scope

- A second GitHub sign-in per project, GitHub Apps, webhooks.
- The pasted-token form keeps writing the old shape (one repo + linked projects); it is read the same way and upgraded on the first mapping write.
- `api:doc` (runs in the follow-up docs PR).

## Acceptance criteria

- Migration 075 moves `config.repo` + `projectIds` into `repos[0]` with the cursor kept, and a second run changes nothing; down restores a one-entry mapping.
- A member gets 403 on the mapping routes; another workspace's project, a personal project, a project the connector cannot open and an unreadable repository are refused with 400; nothing is written.
- Sync: two repos mapped to two projects; a PR in repo A naming a key of the project mapped only to B links nothing. One repo failing backs off alone; the other still syncs.
- `pull_request.get` with a task in a project mapped to two repos reads the linked PR of the right repo; with a number and two repos visible and no `repo`, it asks which; a `repo` mapped only to a project the caller cannot see is refused as not visible.
- The project card and chip render with i18n keys and tokens only; style and i18n checks pass.
