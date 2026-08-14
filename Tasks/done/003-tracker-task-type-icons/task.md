---
id: 003
title: Show library task-type icons in the time tracker
status: done
priority: medium
depends_on: []
created: 2026-08-14
---

# Show library task-type icons in the time tracker

## Goal
The desktop time tracker (React/Next/Electron) renders task types as uploaded images only.
Make it render the new **library (Iconify) icons** (`iconType:'library'` + `iconValue` +
`iconColor`) as well, falling back to the uploaded image (`taskImage`) — mirroring the Vue
`TaskTypeIcon`.

## Scope
- **Deps:** add `@iconify/react` + `@iconify-json/mdi` to `time-tracker-app`. (User decision:
  offline, mdi-only — every migrated icon is `mdi:*`; a lucide/tabler pick falls back to the
  default mdi icon.)
- **Icon loader util** (`renderer/utils/iconLibrary.js`): lazy `addCollection(mdi)` on first
  library-icon render; expose DEFAULT_ICON, DEFAULT_ICON_COLOR, isLoaded, load, iconLoaded —
  mirrors the Vue offline loader, no CDN (only render loaded names, else DEFAULT_ICON).
- **`TaskTypeIcon` React component**: `iconType==='library'` → `<Icon icon color/>` (offline mdi,
  gated on ready, unknown→DEFAULT_ICON); else → existing `<WasabiImage url={taskImage}/>`.
- **Live-lookup sites:** change `getTaskTypeImage()` → return the full matched entry; render
  `<TaskTypeIcon taskType={entry}/>` in TrackerTask, home (list), logentry (list). Keep each
  site's match predicate (value vs key).
- **Running-tracker sites:** store the full descriptor (`taskTypeData`) alongside `taskTypeImage`
  at start (home, TrackerTask, useDeepLinkStart) → reducer/default/persistence → render
  `<TaskTypeIcon taskType={taskTypeData || {taskImage}}/>` in trackerRunning + Header.

## Out of scope
- lucide/tabler offline sets (mdi-only per decision).
- Backend/timelog schema changes (taskTypeImage/taskTypeData are UI-only Redux/context state).
- The task-type picker/editor in the tracker (view-only rendering here).

## Acceptance criteria
- [ ] A task type with `iconType:'library'` shows its mdi icon (with `iconColor`) in the task
      lists, the start modal, the running view, and the header — offline.
- [ ] A task type with an uploaded image still shows the image (WasabiImage) unchanged.
- [ ] Unknown/lucide/tabler icon values fall back to the default mdi icon (no CDN fetch).
- [ ] `npm install` in time-tracker-app + build; no console errors.

## Notes
- WasabiImage(url,isUser,className) resolves http + storage paths already.
- Render sites: TrackerTask.jsx:117, home.jsx:510, logentry.jsx:270 (lookup);
  trackerRunning.jsx:347, Header.jsx:231 (stored). Start: home.jsx:345/357,
  TrackerTask.jsx:55/65, useDeepLinkStart.js:62/88. Store: store/timelog.js:36; default _app.jsx:30.
- Can't build the Electron app here — verify by mirroring the (verified) Vue logic; user installs+builds.
