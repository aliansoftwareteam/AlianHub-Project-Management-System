# Progress: Connectors — GitHub through its MCP server, the first registered MCP app

## Checklist
- [ ] GitHub entry and allow-list
- [ ] Sign-in: registered app (self-hosted, shared service) and personal token
- [ ] `pull_request.get` → `github.pull_request.read`; link to task
- [ ] Admin notice about the 049 sync
- [ ] Setup page
- [ ] Fake GitHub MCP server and tests

## Last step
Not yet started.

## Blockers
Waits on 092, 093, 100.

## Log

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track B in the two-track split; depends only on its own track and the 063 contract.

### 2026-11-12
- Rewritten for PRD v2.0 (decisions 18, 21, 22, 27). GitHub is a Phase 1 app reached through GitHub's MCP server, with a registered app or a personal token. The research and allow-list are done here. Removing the old sync and its migration moved to 079. Priority high.
