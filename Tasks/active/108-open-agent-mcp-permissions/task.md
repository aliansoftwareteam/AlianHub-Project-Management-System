---
id: 108
title: Open agent permissions — self-service scope checkboxes, no admin gate, taint off by default
status: active
priority: high
depends_on: [100]
created: 2026-11-26
---

# Open agent permissions — self-service scope checkboxes, no admin gate, taint off by default

## Goal
Let any member connect any AI app (claude.ai connector, Claude Code, ChatGPT, etc.) and grant it the
permissions they want — read, write, manage tasks, write docs, read chat — straight from the authorization
screen, bounded only by their own role, with no owner/admin approval step. They can change those permissions
later from their own settings. Make the "hold risky AI writes for approval" gate (`AGENT_TAINT_ROUTING`) ship
**off** by default and be toggleable from Settings → Security instead of env-only.

Today the claude.ai connector requests read scopes only, write/manage need a separate admin approval, and the
taint gate defaults on and is env-locked — so the only way a person gets write today is a database edit. This
task removes that friction.

## Scope

**1. Consent screen offers every enabled scope as a checkbox (grant beyond what the app requested).**
- `frontend/src/views/OAuth/Consent.vue`: render all server-enabled scopes (`offeredScopes()`) as checkboxes,
  not just the ones the client requested. Reads pre-ticked, writes/manage unticked by default. Remove the
  "waiting for admin" / "ask admin" / "not approved for this workspace" states.
- `Modules/OAuthServer/consentController.js` (`details`, `answer`, `partsOf`, `grantedOf`, `standingIn`): offer
  and grant the ticked scopes up to the server-enabled set and the person's own role — **independent of what
  the client asked for in `opened.scopes`**. Validate ticked ⊆ enabled-scopes ∩ person-role.
- `Modules/OAuthServer/controller.js` / `config.js`: `mayAskFor` / `defaultScopes` no longer constrain the
  consent offer to the requested set.

**2. No admin approval ceiling.**
- Remove the admin-approval requirement from the grant path: `Modules/OAuthServer/approvals.js`,
  `grants.js` (`ceilingOf`, `exchangeCode`, `refresh`). The effective ceiling becomes the person's own role,
  enforced where it already is — every tool call runs through the web app's route handlers as the person, so a
  grant can never exceed the person's permissions regardless of scopes held.
- Keep **Agent clients** (Settings) as a **read-only list + Revoke** so admins can still see and cut off apps;
  it just no longer gates connection.

**3. Self-service later edits.**
- `AI → Accounts → Connected apps`: show each connection's current scopes as checkboxes with Save, so the
  person can add or remove permissions up to their own role without reconnecting. Backend endpoint to widen or
  narrow a grant's scopes (extend `Modules/OAuthServer/personalGrants.js` / routes), reusing the per-call role
  checks. Keep the existing Withdraw/Revoke.

**4. `AGENT_TAINT_ROUTING` default off + editable in Settings.**
- `Modules/Agents/taint.js` `enabled()`: default **off**; when the env var is unset, read the value from the
  instance setting (DB) instead of defaulting on. An explicit env value still wins.
- `Modules/Instance/settingsCatalog.js`: make the `AGENT_TAINT_ROUTING` field writable from Settings → Security
  (not env-locked) when the env var is unset; default off; persist to the instance settings store.
- Frontend Settings → Security: make the "Hold risky AI writes for approval" toggle editable (saves) when not
  env-overridden.
- Migration: new installs default off. Decide and record whether existing installs keep their current effective
  value or flip to off (see open question in notes).

## Out of scope
- Changing what a given role is allowed to do (the role model itself is unchanged — this only changes who/what
  can be *granted*, never raising anyone above their own role).
- Per-project standing auto-approvals ("Always do this") — unchanged.
- Delegated task sessions (`MCP_OAUTH` webhooks), connectors (Google/Slack/etc.) consent — unchanged.
- The `MCP_TOOLS_*` feature flags — unchanged (they still decide which tool categories exist server-wide).

## Acceptance criteria

- [ ] On the authorize screen, a person connecting the claude.ai connector can tick **Write tasks**, **Log
      time**, **Manage tasks**, **Write docs**, **Read chat** even though the client requested read only, and the
      issued token holds exactly what they ticked.
- [ ] No owner/admin approval is required at any point for a connection to be granted write/manage; a brand-new,
      never-approved app can be granted write by its connecting user.
- [ ] A granted scope never exceeds the connecting person's own role: a tool the person's role forbids is still
      refused at call time.
- [ ] From AI → Accounts → Connected apps, a person can add a permission they didn't grant initially, and remove
      one, and the change takes effect on the connection's next call — no reconnect needed.
- [ ] Settings → Agent clients still lists connected apps and can Revoke them, but no longer blocks connection.
- [ ] A fresh install has `AGENT_TAINT_ROUTING` **off**; Settings → Security shows the toggle and an owner can
      turn it on/off and it persists (when not overridden by the env var).
- [ ] With the gate off, an outside AI app's `task.create` runs immediately (no Inbox proposal), confirmed in the
      Audit log.
- [ ] i18n, style, and api-doc conventions pass (see constraints); tests cover grant-beyond-request, no-admin
      path, self-service scope edit, and taint default.

## Constraints & notes

- **Security posture — deliberate.** Together these changes mean any member can connect any AI app and grant it
  full write/manage up to their own role, running without approval or admin review. This is the owner's explicit
  product decision (2026-11-26). Bound is the per-call role enforcement, which must stay intact — a grant can
  carry scopes but can never let the app do what the person themselves cannot. Keep Agent clients + the audit log
  so there is still visibility and a kill switch.
- **Project rules:** Rule 1 (minimal comments); Rule 3 (every user-visible string via i18n → `en.js` +
  `npm run i18n:backfill`); Rule 4 (new routes → `npm run api:doc`, numbered build in the docs PR); Rule 5
  (colour tokens only, `npm run style:baseline` if styles change).
- **Key files:** `Modules/OAuthServer/{consentController,approvals,grants,config,controller,personalGrants}.js`,
  `Modules/Mcp/{scopes,server}.js` (the 401 challenge's `DISCOVERY_SCOPES` currently offers read only),
  `Modules/Agents/taint.js`, `Modules/Instance/settingsCatalog.js`, `frontend/src/views/OAuth/Consent.vue`,
  the Connected apps / Agent clients tabs, and the instance Security settings screen.
- **Open question (existing installs):** on upgrade, keep each install's current effective taint value, or flip
  all to off? Default assumption unless told otherwise: **existing installs keep their current value** (via a
  migration that records it), only the shipped default changes to off — so no running instance silently loses the
  gate on upgrade.
- **Prior context:** this grew out of a live session where the claude.ai connector was read-only; the stop-gap
  was editing `oauth_grants` / `oauth_tokens` scopes and setting `AGENT_TAINT_ROUTING=off` in `.env` on
  production. This task makes that a supported product feature. Related: task 100 (MCP sign-in).

## Resources
*None yet. Add consent-screen mockups or scope-matrix notes here if produced.*
