# Idle-Time Detection — Test Cases

**Feature:** TIME-05 — desktop tracker auto-pauses after a configurable idle threshold
**Location:** `time-tracker-app/main/background.js` (Electron main process)
**How:** AV-safe — uses `powerMonitor.getSystemIdleTime()` + cursor sampling (no global input hook). On idle ≥ threshold while tracking → sends `idle:detected` and reuses the existing `stop-tracker` pathway to pause; shows a system notification. Threshold persisted in `idle-config.json`.
**Note:** Electron desktop behavior — verified manually on a built tracker, not in the Node test suite. Ships when the installers are rebuilt.
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| ID-01 | Configure threshold | Tracker running | `window.ipc.send('idle:set-threshold', 1)` (1 min) | Threshold saved; `idle:threshold` echoed; `idle-config.json` updated | | ⬜ |
| ID-02 | Auto-pause on idle | Tracking active, threshold 1 min | Leave the machine idle > 1 min (no kbd/mouse) | Tracker pauses (same as suspend/lock); a "Tracking paused — no activity" notification appears | | ⬜ |
| ID-03 | No pause when active | Tracking active, threshold 5 min | Keep using mouse/keyboard | Never auto-pauses; `idleHandled` stays reset | | ⬜ |
| ID-04 | Disable with 0 | — | Set threshold to 0 | Auto-pause never triggers regardless of idle | | ⬜ |
| ID-05 | Resume after pause | Auto-paused (ID-02) | Restart tracking | Works normally; `idleHandled` reset on start so idle can trigger again | | ⬜ |
| ID-06 | Threshold persists | Threshold set to 3 min | Quit + relaunch the tracker | Threshold is still 3 min (loaded from `idle-config.json`) | | ⬜ |
| ID-07 | AV-safe | — | Inspect implementation | No global key/mouse hook; only `powerMonitor` + cursor position (no AV quarantine) | | ⬜ |
| ID-08 | Fires once per idle spell | Tracking, threshold 1 min | Stay idle for several minutes | `idle:detected`/pause fires once (not every second) until activity resumes | | ⬜ |

**Total:** 8 manual cases (desktop tracker).
