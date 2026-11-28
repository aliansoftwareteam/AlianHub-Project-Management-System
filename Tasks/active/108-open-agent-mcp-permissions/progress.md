# Progress: Open agent permissions — self-service scope checkboxes, no admin gate, taint off by default

## Checklist
- [x] Backend: consent offers all enabled scopes, grants ticked set up to person's role (consentController offerParts/grantedFrom/standingIn; details + answer reworked)
- [x] Backend: remove admin-approval ceiling — approvals.isClientApproved→true, approvals.approvedScopes→offeredScopes(); this redirects grants.ceilingOf and Mcp/oauthAuth automatically. Agent clients read-only list + revoke still TODO on the FE
- [ ] Backend: self-service scope add/remove endpoint for a connection (personalGrants + routes)
- [x] Backend: AGENT_TAINT_ROUTING default off + read from instance settings when env unset (taint.js, settingsCatalog) — editable toggle renders from catalog, no FE change
- [x] Migration for taint default (migration 088 keeps existing installs' current effective value; new installs off; holdUntilApplied wired in index.js)
- [ ] Frontend: Consent.vue — all scopes as checkboxes, drop admin-waiting states
- [ ] Frontend: Connected apps — edit a connection's scopes; Agent clients — read-only list + revoke
- [ ] Frontend: Settings → Security — editable taint toggle
- [ ] i18n keys + `npm run i18n:backfill`; style tokens + baseline
- [x] Approval made OPTIONAL via AGENT_CLIENT_APPROVAL (default off); both code paths behind the flag; old suites run with it on
- [x] Tests: open-path (grant-beyond-request, member-eligible, self-service edit, manage-when-ticked) + taint default/off; ~930+ pass across ~19 suites
- [x] Docs: env-doc.meta.json (taint default off + new AGENT_CLIENT_APPROVAL) → regenerated .env.example/ENV.md (env:doc:check in sync); api-doc.meta.json + `node scripts/api-doc.js` → API.md/openapi.json carry POST /oauth-grants/:id/scopes; updated connect.md (open consent flow + self-service + optional-approval note), MCP-AGENT-GUIDE overview, admin security.md, env-reference.md
  - RESIDUAL (follow-up): dense reference prose still states approval as unconditional — docs-site/ai/mcp-server.md (the MCP_OAUTH paragraph), docs/CONNECT-YOUR-AI.md, and MCP-AGENT-GUIDE.md lines ~37/60-69/232. Accurate when AGENT_CLIENT_APPROVAL is on; should be reworded to "only when approval is required" in a follow-up pass.

## Last step
DESIGN CHANGE (owner, 2026-11-26): admin approval is now OPTIONAL, not removed — new setting `AGENT_CLIENT_APPROVAL` (security, default off). Off = the open model (consent offers all enabled scopes, grants beyond request, member-eligible, no gate). On = the full old approval gate, unchanged. Backend branches on `config.approvalRequired()` in consentController (details/answer), approvals (isClientApproved/approvedScopes), which redirects grants.ceilingOf + Mcp/oauthAuth automatically. Private-sprint opt-in only exists when approval is on; when off, no private-list delegation (safest default — owner can revisit).

TESTS: all rewritten/green under the scratch jest config. Existing suites run with `AGENT_CLIENT_APPROVAL='on'` (old contract preserved): oauth-consent (75), oauth-approval-enforcement, oauth-server, mcp-oauth-actions, mcp-proposal-approval, mcp-oauth-tokens/person, connector-write-approvals, mcp-approver-rights, migration-oauth-*, agent-standing-approvals, etc. NEW tests: 5 open-path tests in oauth-consent ("with approval not required (the default)"), 2 taint default-off tests. ~930+ tests across ~19 suites all pass. i18n backfilled + check clean, style 0 findings, migrations-runner 11/11.

Scratch jest config: C:/Users/Alian80/AppData/Local/Temp/claude/691715e82a87485e/3e484c46-979d-4b0c-ace6-e56835a45108/scratchpad/jest.worktree.js — `npx jest --config <that> tests/<file>`.

Remaining: docs (connect.md / mcp-server.md / admin security + `api:doc` for the new /oauth-grants/:id/scopes route). FE Agent-clients "read-only" item is now MOOT — the approval subsystem is kept (used when the setting is on), so its UI stays correct. Minor FE edge: Consent.vue's `external_clients_off` reason falls to the ask-admin branch (cosmetic).

## Blockers
None. Open question resolved: existing installs keep their current taint value (migration 088); approval subsystem kept-but-optional per owner.

## Log

### 2026-11-26
- Task created from a live session: claude.ai connector was read-only; stop-gap was DB scope edits + `AGENT_TAINT_ROUTING=off` in prod `.env`.
- Design decided with owner: (1) consent offers all enabled scopes as checkboxes, granting beyond what the client requested; (2) **no** admin approval ceiling — bounded only by the person's own role; (3) self-service later edits; (4) taint gate default off + editable in Settings.
- Security reduction noted and accepted as a deliberate product decision.
- Built backend chunk 1 (taint): `Modules/Agents/taint.js` default off; `Modules/Instance/settingsCatalog.js` field editable + default false + `taintDefaultOn` exported; `migrations/088-taint-routing-off-default-keep-existing.js`; `index.js` holdUntilApplied wired. Security toggle now renders editable from the catalog (no FE change).
- Built backend chunk 2/3 (consent + no admin gate): `Modules/OAuthServer/approvals.js` isClientApproved→true, approvedScopes→offeredScopes(); `Modules/OAuthServer/consentController.js` offers all enabled scopes as reads(base)+tickable(optional), grants beyond request, drops the approval/standing refusal. grants.ceilingOf and Mcp/oauthAuth inherit the new ceiling via approvals. All changed files pass `node --check`. Not executed; no tests run yet.
