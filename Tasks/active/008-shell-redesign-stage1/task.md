---
id: 008
title: Redesign stage 1 — tokens, login/auth, global rail shell, Home, task detail panel
status: active
priority: high
depends_on: []
created: 2026-09-03
---

# Redesign stage 1 — tokens, login/auth, global rail shell, Home, task detail panel

## Goal
Rebuild the AlianHub shell to the design handoff in `Alianhub UI mockups and redesign.zip` (canvas `AlianHub Login Review.dc.html`, 30 turns / 129 options). Stage 1 of the handoff's own build order (turn 23): the seven screens everything else sits inside. Every later screen (projects, reports, settings, AI system, billing, CLI agents) is a follow-up task that reuses these tokens and this shell.

## Scope
1. **Design tokens** (`12f`) — replace `frontend/src/assets/css/tokens.css` with the handoff tokens: `--brand #2F3990`, warm-grey canvas `#f7f6f3`, dark rail `#1a1a1a`, ink/hairline/border, ok/warn/danger tint chips, Inter Tight + JetBrains Mono, spacing/radius/shadow/focus scale, dark theme variants. Fonts loaded in `public/index.html`; Roboto/Figtree/Fraunces removed.
2. **Login** (`5a`) — 46/54 split; four labelled full-width provider buttons (Google, Microsoft, GitHub, GitLab — hidden when disabled), "Continue with SSO", email + password, inline field error with remaining attempts (never a toast), "Email me a login link" secondary, keep-signed-in, footer links. Right panel: product proof card, not a decorative image.
3. **Auth states** (`5b`) — 2FA code, verify email / resend, magic link sent, workspace switcher, all on one card system. Restyle forgot/reset/verify-email/invitation views with the same tokens.
4. **Global nav rail** (`5c`) — 60px fixed dark rail replacing the 58px top header: Home, Planner, Chat, AI, Docs, Dash, Time, More, avatar with status dot. Existing header actions (search, timer, company switch, notifications, profile menu) relocate into rail + toolbar. Bottom 5-tab bar under 768px.
5. **Home / Today & Overdue** (`5c`) — context sidebar (236px: Inbox, Replies, Chat activity, My Tasks: Assigned / Today & Overdue / Personal List, Favorites, Projects) + toolbar + My Work card (Today / Overdue / Next / Unscheduled with To Do / Done / Delegated tabs) + Agenda + Planner panel + live timer chip. Wired to the existing task, timesheet and calendar APIs.
6. **Home, first run** (`5d`) — same shell; owner checklist, empty My Work pointing at the sample project, Personal List hint, calendar connect. Dark theme proof.
7. **Task detail panel** (`12a`) — 760px right overlay over any view (not a route change); Esc closes, Expand → full page, Minimize to tray. Header, AI summary block, Description / Subtasks / Files / Relations tabs, activity + comment box, properties column, live timer, relations. Wraps existing `TaskDetailBody` / `TaskDetailRightSide` logic.
8. **Personal List** (`12b`) — private list with its own views, reachable from the Home sidebar.

## Out of scope (follow-up tasks, same tokens)
- Stage 2+: projects list/board/list/calendar/gantt/workload/forms (turn 10, 14), settings (15, 18), reports (16), chat/calls (21), custom fields/import (22).
- AI agent system: Hub, Inbox, agent settings, skill library, agent wizard (9, 11, 13), Provenance of Done model (29), agent action registry, MCP server for CLI agents (26–28), agent picker (30).
- Milestone billing (19), dashboard card catalogue (20), mobile-only screens (24), docs/wiki/people directory (25).
- Backend changes. Stage 1 is frontend-only against existing endpoints. The one exception is a `nav` preference (rail pins, theme, sidebar collapse) stored on the existing user-settings endpoint.
- The kiln direction from task 006 (paper/pine/copper, Fraunces, top bar) is retired; its Pages work (editor, compose rail, workspace route) is kept and restyled to the new tokens.

## Acceptance criteria
- [ ] `tokens.css` is the single source of the handoff tokens; no new literal brand colours in stage-1 components.
- [ ] Login renders the `5a` layout; wrong password shows an inline error under the field with remaining attempts; provider buttons are labelled; disabled providers are hidden; Enter submits; focus ring is the 3px brand ring.
- [ ] 2FA, verify-email, magic-link-sent and workspace-switcher states share one card system (`5b`).
- [ ] Authenticated routes render inside the 60px dark rail; Home is a rail item; every destination reachable from the old header (Projects, Chat, Timesheet, Reports, Settings, Inbox, Pages, Automations, Integrations, Portfolio) is reachable from rail or More.
- [ ] Home opens on Today & Overdue with real tasks grouped Today / Overdue / Next / Unscheduled; first-run state shows the checklist and sample-project pointer.
- [ ] Task detail opens as an overlay over List/Board without a route change; Esc closes; Expand goes full-page; existing detail features (comments, subtasks, files, time log, relations) still work.
- [ ] Personal List route exists and lists the user's private tasks.
- [ ] Rail collapses to a bottom tab bar under 768px; sidebar and right panel collapse under 1280px.
- [ ] Labels ≥ 4.5:1 on white; status chips are tint + dark same-hue text.
- [ ] `cd frontend && npm run build` passes; existing page helper tests pass.

## Constraints & notes
- Vue 3 SFCs, Vuex 4 (not Pinia — the handoff assumes Pinia; map its `auth`/`nav`/`tasks`/`timer` stores onto the existing Vuex modules), per-component `style.css`, vue-i18n keys in `locales/en.js`.
- Design source: `/Users/mevil/Downloads/Alianhub UI mockups and redesign.zip` → `AlianHub Login Review.dc.html` (+ `support.js`). Option ids (`5a`, `12a`…) are the cross-reference key.
- Icons: use the existing icon set at 16px (rail) / 18–22px inline; provider marks must be the official ones.
- Motion: 120–180ms ease-out for state, 240ms for panels. No entrance animation on data.
- Timer: one per person globally; elapsed persisted to localStorage and reconciled on reconnect.

## Resources
- Handoff README: `design_handoff_alianhub_redesign/README.md` (tokens, geometry, interactions, build order).
- Prior shell work to supersede: task 006 `006-ai-native-pages-shell` (kiln tokens, header restyle, NavLinks).
