---
id: 059
title: Agent settings page — tabs, a searchable project picker and one sticky Save bar
status: active
priority: high
depends_on: []
created: 2026-10-27
---

# Agent settings page — tabs, a searchable project picker and one sticky Save bar

## Goal
The agent page (`/:cid/ai/agent/:id`, `views/Ai/AgentSettings.vue`) fits on a screen or two instead of many. A workspace with 100 projects and 13 skills scrolls for about twenty screens today: every project is a full-width row, every library skill is listed open, and Save sits halfway down between the runs and the revision history.

## Root cause
- Nine cards are stacked in one column: skills, projects, role, autonomy, limits, schedules, recent runs, revisions, delete.
- Projects are one full-width row each, with no search and no way to see only the chosen ones.
- Skills the agent does not use are listed as open as the ones it does.
- The four autonomy levels are stacked full-width.
- Save and Cancel sit after Recent runs, so they are off screen while you edit.

## Scope
- **Tabs** under the toolbar, in order: Skills (count on) · Projects (count chosen) · Autonomy · Limits & schedule · Recent runs · History · Delete. History and Delete show only to someone who can manage the agent, as today.
- The open tab is kept in `?tab=`, so a reload or Back returns to it. A link with `?rev=` (from a run's detail) opens History, as the `#revisions` anchor does today.
- **One Save bar**, sticky at the bottom of the four settings tabs (Skills, Projects, Autonomy, Limits & schedule), with "Unsaved changes" when the form differs from the saved agent. A tab with unsaved edits shows a dot.
- **Skills**: skills the agent uses come first as compact rows; skills it does not use fold under "More skills from the library (n)". "Never" stays at the bottom.
- **Projects**: role picker on top; a search box, "n of m chosen", a "Chosen only" filter, Choose shown / Clear; projects in a two- or three-column grid of compact checkboxes inside a box that scrolls on its own.
- **Autonomy**: the four levels in a 2×2 grid, the preview below.
- Content capped at a readable width; the tab bar scrolls sideways on a phone.
- i18n keys through `en.js` and the backfill; colours through tokens.

## Out of scope
- The inside of `AgentSchedules`, `AgentRevisionHistory` and `AgentRunDetail`.
- Server changes, the agents list (`AiHub`) and the agent wizard.
- What Cancel does (it still returns to the agents list).

## Acceptance criteria
- [ ] With 100 projects and 13 skills, no tab is taller than about two screens at 1080p; the project grid scrolls inside its own box
- [ ] Project search filters by name; "Chosen only" shows the chosen projects; the count is right
- [ ] Save is visible on every settings tab without scrolling; "Unsaved changes" and the tab dot follow the form, and clear after Save
- [ ] `?tab=` survives a reload; `?rev=N` opens History with revision N highlighted
- [ ] A member sees the settings tabs and Recent runs, every control disabled, and no Save, History or Delete
- [ ] Existing unit tests pass; new tests cover tab switching, the `?rev` jump, project search and the unsaved state; `i18n:check` and `style:check` pass

## Constraints & notes
- Panels use `v-show`, not `v-if`, so the form stays in one component and the existing tests that reach `#rate`, `#sk-triage` and `role-pick` still find them.
- Tabs use the shared `ah-tabs` / `ah-tab` with `role="tablist"`, as `AiHealth` does.
