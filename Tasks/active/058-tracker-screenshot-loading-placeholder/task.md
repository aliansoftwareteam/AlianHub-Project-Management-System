---
id: 058
title: Tracker timesheet — every screenshot card shows its image box and a loading state from the first paint
status: active
priority: medium
depends_on: []
created: 2026-10-27
---

# Tracker timesheet — every screenshot card shows its image box and a loading state from the first paint

## Goal
On Timesheet › Tracker (`/#/<companyId>/timesheet/tracker`), an hour's screenshot cards show the image box with a loading animation as soon as they appear, and the screenshot fills that same box when it arrives. Today the card first shows only its bottom line (time, activity bar, avatar), and the image box appears a few seconds later, so nothing tells the user a screenshot is coming.

## Root cause
- A card's image is a `WasabiImage`. While it asks the server for the screenshot's signed URL, it renders a `Skelaton` `<div>` carrying the card's image class.
- `ScreenShotDisplayComponent.css` sizes that class only on an `<img>` (`img.screenShotDisplay__innerImageTimelog`), so the skeleton `<div>` has no height and the card collapses to its bottom line.
- When the URL arrives, `ImageIcon` renders the `<img>`, which now gets the 78px box and pulses until the file has downloaded. That is the "box appears after a few seconds" step.
- The legacy path for a screenshot stored as a full `http` URL renders a bare `<img>` with no loading state at all.

## Scope
- `ScreenShotDisplayComponent.css`: size the image class on any element, as a block, so the skeleton, the loading image and the loaded image share one 78px box.
- `ScreenShotDisplayComponent.vue`: render the `http` screenshot through `ImageIcon`, so it pulses until loaded like the stored ones, with a translated `alt`.

## Out of scope
- Making the signed-URL requests faster or batching them (one request per screenshot, from the shared `WasabiImage`).
- A screenshot whose signed-URL request fails: the shared `WasabiImage` keeps its skeleton. Changing that touches every image in the app.
- The hover preview (`ScreenShotViewHover`) and the full-size preview (`PreviewTimelogScreenShot`).
- The hour-row skeletons shown while the day itself loads (already present).

## Acceptance criteria
- [ ] When an hour opens, each screenshot card shows a 78px image box with a moving skeleton before its screenshot URL is known.
- [ ] Once the URL is known, the box keeps its size and pulses until the image has loaded, then shows the screenshot; the card does not change height at any step.
- [ ] A screenshot stored as an `http` URL also shows the pulsing box until it loads.
- [ ] A deleted screenshot still shows the deleted placeholder in the same box.
- [ ] Clicking a card still opens the screenshot preview; hovering still opens the hover detail.
- [ ] `npm run style:check` and `npm run i18n:check` pass; no hard-coded colours.

## Constraints & notes
- Colours come from tokens only (Rule 5); every visible string through `$t` (Rule 3).
- `WasabiImage` and `ImageIcon` are shared across the app and are not changed.

## Resources
- The user's screenshot of the page with the 12:52 AM card showing only its bottom line (in the conversation, not stored).
