# Progress: Connectors — Notion, the first app that registers itself

## Checklist
- [x] Notion entry: `providers/notion/` (MCP, registers itself, endpoints from Notion's published metadata)
- [x] Tools: `notion.pages.search`, `notion.page.read`, `notion.page.create` (write, approval card), all with `shape: null`
- [x] Registration once per workspace; re-registration (built and tested in 100 against a fake server)
- [ ] Pin the three shapes with `scripts/connector-tool-shapes.js` and a Notion test account
- [ ] One manual run against Notion itself
- [ ] Phase 1 joint end-to-end test with GitHub (self-hosted and hosted)

## Last step
The definition is in. Notion can be connected wherever `CONNECTORS` names it, with nothing in `.env`. Its tools stay off until their shapes are pinned with a real account.

## Blockers
A Notion test account, to pin the shapes and run it once for real.

## Log

### 2026-11-12
- Task created from PRD v2.0 of 056 (decision 27). Track A.
- Read Notion's published sign-in metadata: protected resource `https://mcp.notion.com/mcp` → authorization server `https://mcp.notion.com`, with `/authorize`, `/token`, `/register` (dynamic registration and client ID metadata documents), PKCE S256, `none` accepted at the token endpoint, scope `default`.
- `providers/notion/index.js`:
  - Transport `mcp`, `registration: 'dynamic'`, and one product, `workspace`, with no scopes; the consent asks for none (an empty scope is now left out of every consent address).
  - The account comes from the token answer's `workspace_id`, `bot_id` or `owner.user.id` when present (`tokenAccount.js`), else one stable id per person.
- `providers/notion/tools.js`: search (`notion-search`), read (`notion-fetch`, arg `id`) and create a page (`notion-create-pages`, a write with an approval card). The server tool names and arguments come from Notion's public client documentation; they are confirmed when the shapes are pinned.
- Tests: `tests/connector-mcp-apps.test.js` (validates, offered with nothing set, tools off until pinned, no scope asked for); 100's `connector-mcp-sign-in.test.js` covers registering once and reusing it.
