---
id: 110
title: Connectors — per-tool permissions, workspace app switch and the tools screen
status: backlog
priority: high
depends_on: [109]
created: 2026-11-17
---

# 110 — Connectors — per-tool permissions, workspace app switch and the tools screen

Sub task of 107 (`Tasks/backlog/107-connectors-mcp-first-live-tools/task.md`). Its decisions apply here.

## Goal
The connection's owner sees every tool of their connection and decides how each may be used, as in Claude's Connectors settings. Owners and admins can turn an app off for everyone.

## Scope
- Permission per tool per connection: **Always allow**, **Needs approval**, **Off**. Default: reads Always allow, writes Needs approval. Only the connection's owner changes it; agents are refused (`agentsRefused`).
- Needs approval sends the call to the existing approval card (`writes.js`). Off removes the tool from every list.
- The owner can change a tool between read and write.
- Replaces `toolsOff` and its route; existing `toolsOff` values become Off.
- Workspace switch: owners and admins turn an app off for the workspace. Its tools leave every list and its calls are refused. Audited, socket event emitted.
- Connectors screen (task 101 layout): a connection's tools grouped read and write, the permission control, the changed warning with "looked at" to clear it, and gone tools.
- Strings through i18n; colours from tokens.

## Out of scope
- How AI uses the permissions (111). Custom servers (113).

## Acceptance criteria
- [ ] Off removes a tool from AI chat and agents; Needs approval goes to the approval card; Always allow runs it
- [ ] Only the connection's owner can change its permissions; another member and an agent are refused
- [ ] Clearing a changed warning records the current shape as looked at
- [ ] An app turned off for the workspace offers no tools and refuses calls
- [ ] Existing `toolsOff` settings carry over as Off
- [ ] `i18n:check` and `style:check` pass
