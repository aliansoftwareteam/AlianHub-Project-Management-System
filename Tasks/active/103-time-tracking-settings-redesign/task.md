---
id: 103
title: Time tracking settings redesign — a quiet settings page instead of a marketing banner
status: active
priority: medium
depends_on: []
created: 2026-11-12
---

# 103 — Time tracking settings redesign (PRD)

## Goal
Settings > Time tracking reads like the other settings pages (Plan & usage, SCIM): plain cards on
the design tokens, one clear download for this computer, and the facts an admin needs. Today it is
a landing-page banner ("Unlock the Universe…"), a hard-coded green button whose label is clipped
behind its icon, a background illustration that runs under the card, a black Apple logo that
disappears on the dark theme, and storage shown as "1364.1 GB".

## How it fits the code that exists
- `frontend/src/views/Settings/TimeTracking/TimeTracking.vue` fetches two sources: the update feed
  (`TRACKER_DESKTOP_APP`, `info.release.downloads` of `{ os, kind, version, url }`) and, as a
  fallback, the builds this server hosts (`settings/setTimeTrackerDownload`, items of
  `{ type: Windows|Mac|Linux, version, title, description, downloadUrl }`).
- `DesktopAppCard.vue` already detects the OS, picks the primary download, counts seats and
  formats screenshot storage. Its fallback is a slot that `TimeTracking.vue` fills with the old
  tile picker + green button styled by `style.css`.

## Scope
1. **Page** — drop the banner headline, subline and background illustration. The page is a column
   of `ah-card`s, max 720px, left-aligned like the sibling settings pages.
2. **Download card** — head: "Desktop time tracker" + seats chip. Body: one-line description; a
   highlighted row for this computer (OS glyph, name, version, primary "Download for <OS>"); then
   "Other platforms" rows, each with a secondary Download button.
3. **One download UI for both sources** — `TimeTracking.vue` maps the server's own builds to the
   feed's `{ os, kind, version, url, note }` shape and passes them as a prop, so the fallback
   renders the same rows. The slot and the tile picker go.
4. **Connect card** — three short steps (install, Open in tracker, start a timer) with the
   existing "Open in tracker" button and its not-opened hint.
5. **Screenshots card** — two stats, storage used and how long screenshots are kept, plus the
   storage note. Sizes of 1 TB or more show in TB.
6. **OS glyphs** drawn in `currentColor` (mask icons from the existing SVGs), so they read on
   light and dark themes.
7. **Tokens and i18n** — no hard-coded colours; `style.css` is deleted and its baseline entry
   removed. New strings go in `en.js` under `TimeTracker`, backfilled; the banner keys are removed.
8. **Unit tests** in `frontend/tests/unit/trackerDesktopAppCard.spec.js` updated to the new
   structure (other platforms as rows, fallback via prop, TB formatting).

## Out of scope
- The plan-without-tracker states (`tt-addon` in `TimeTracking.vue`, `desktop-app-off` in the
  card) keep their content; they only pick up the new spacing.
- Backend, the tracker app itself, the deep link, and how seats or storage are counted.
- The timesheet/screenshot views elsewhere in the app.

## Acceptance criteria
- [ ] No banner headline, background image or green button; the page is cards on tokens.
- [ ] The download for this computer is one primary button with its version; every other build
      is a row with its own Download button, for feed and server builds alike.
- [ ] OS glyphs, text and buttons are legible in the light and dark themes and with an orange or
      blue brand colour.
- [ ] Storage of 1 TB or more reads in TB (1364.1 GB → 1.3 TB).
- [ ] At 390px wide nothing overflows: rows stack and buttons stay at least 40px tall.
- [ ] `npm run style:check` and `npm run i18n:check` pass; `style.css` is gone from the baseline.
- [ ] The DesktopAppCard unit tests pass.

## Constraints & notes
- Working agreement: minimal comments, every string through i18n, every colour from a token.
- Mockup shown in chat on 2026-11-12 (download, connect and screenshots cards).
