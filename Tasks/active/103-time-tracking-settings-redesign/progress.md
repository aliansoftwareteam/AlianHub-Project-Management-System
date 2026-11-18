# Progress: Time tracking settings redesign

## Checklist

- [x] Rebuild `DesktopAppCard.vue` as three cards: download, connect, screenshots
- [x] `TimeTracking.vue` drops the banner and tile picker, maps the server's own builds to the feed shape
- [x] Delete `style.css`, its baseline entry, and the now-unused `Group_40061.png` and `download_green.svg`
- [x] New `TimeTracker` strings in `en.js`, backfilled; banner and old screenshot-line keys removed from every locale
- [x] Unit tests updated (13 pass); style, i18n and ESLint checks pass
- [x] Checked in light and dark themes, default and orange accent, and at 390 px
- [ ] Check on a running instance, signed in
- [x] PR into `staging`

## Last step

Merged into `staging` as #1785 on 2026-11-12 (build 14.43.0-beta.13); goes to `main` with the promotion #1790. Still to do: check it on a running, signed-in instance.

## Blockers

None.

## Log

### 2026-11-12
- Task created; owner approved the mockup and PRD.
- One download list serves both sources: the update feed's `{ os, kind, version, url }`, or the
  server's own builds mapped to `{ os, name, version, url, note }` (leading "v" stripped). Feed wins.
- A phone (Android, iOS) is not treated as the computer to download for: the first build leads and
  "For this computer" is not shown. Before, Android was detected as Linux.
- Download buttons take `min-height: var(--hit-min)` so they are 42 px on a phone.
- Storage of 1 TB or more reads in TB (1364.1 GB → 1.3 TB).
- Checked with a Vite page that mounts `DesktopAppCard` with the app's tokens and `en.js`
  (scenarios: server builds, feed, no builds, loading, plan without tracker). No console errors,
  no horizontal scroll at 390 px.

### 2026-11-13

- Merged into `staging` as #1785, build 14.43.0-beta.13. Beta log updated in the follow-up docs PR; promotion to `main` in #1790.
