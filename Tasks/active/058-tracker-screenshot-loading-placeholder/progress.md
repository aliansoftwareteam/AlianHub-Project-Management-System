# Progress: Tracker timesheet — every screenshot card shows its image box and a loading state from the first paint

## Checklist

- [x] Find why the card renders only its bottom line first
- [x] Size the image class on any element, as a block
- [x] Render `http` screenshots through `ImageIcon`
- [x] Verify the three states (skeleton, pulse, image) and the deleted placeholder in the browser
- [x] `npm run style:check`, `npm run i18n:check`
- [ ] Check on the live Tracker timesheet once deployed to staging

## Last step

Merged into `staging` as build 9 (`14.41.0-beta.9`, #1716). Still open: watch an hour of the Tracker timesheet load on staging.

## Blockers

None.

## Log

### 2026-10-27
- Task created from the user's report and screenshot.
- Root cause: `img.screenShotDisplay__innerImageTimelog` sizes only an `<img>`, so `WasabiImage`'s skeleton `<div>` collapses to 0px while the signed URL loads.
- `ScreenShotDisplayComponent.css`: the rule now targets the class on any element, as `display: block`, so skeleton, loading image and image share one 78px box. Dropping the inline `<img>` gap makes the card 4px shorter (125px → 121px) and keeps it the same height in every state.
- `ScreenShotDisplayComponent.vue`: an `http` screenshot renders through `ImageIcon`, which pulses until the file loads; its `alt` is `TimeTracker.screenshot_preview` instead of the bare `timelogImage`.
- `frontend/tests/unit/trackerScreenshotLoading.spec.js` (4 tests) mounts the real card, `WasabiImage`, `Skelaton` and `ImageIcon`, and checks the CSS rule that sets the 78px height applies to the element in each state. On the original files 2 of the 4 fail: the skeleton is not sized, and the `http` card has no loading state.
- Browser check in a throwaway Vite preview of the real `ScreenshotTime` panel with mocked storage calls, in dark and light themes. With the fix, every state has a 78px box in a 121px card. On the original files, a card still waiting for its URL is 38px tall (only its bottom line), which matches the report.
- `style:check`, `i18n:check`, ESLint on the changed files, and `trackerDayOneCall.spec.js` all pass.
- Not covered: a screenshot whose signed-URL request fails keeps the skeleton, because the shared `WasabiImage` renders it whenever it has no URL. Before this fix that card collapsed to its line. Left out of scope (see task.md).
- #1716 merged into `staging` as build 9 (`14.41.0-beta.9`) after all 14 CI checks passed (backend, frontend, e2e and integration shards included). The live-page check is still open, so the task stays active.
