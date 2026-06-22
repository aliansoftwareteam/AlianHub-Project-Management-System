# Test Cases — COLLAB-04 Clips (screen/voice recording) (AHE-3755)

Record a screen and/or voice clip in-browser and attach it to a task. Built **additively** —
a single new `ClipRecorder` modal that records via native `MediaRecorder`, produces a
`File`, and hands it to the **existing** task-attachment upload flow; playback reuses the
existing attachment viewer. No new dependency, no backend change.

## Architecture
- **New:** `frontend/src/components/molecules/ClipRecorder/ClipRecorder.vue` — modal recorder. Modes: Voice (`getUserMedia` audio → `audio/webm`), Screen (`getDisplayMedia` video → `video/webm`), Screen + mic (merged stream). `MediaRecorder` with `isTypeSupported` codec fallback; live timer; in-modal preview; re-record; attach.
- **Reuse (unchanged):** on Attach it builds `new File([blob], 'clip-<ts>.webm', {type})` and `Attachments.vue` emits `update:add` with it — the exact path the file input uses → `TaskDetailTab.newAttachments` uploads via `storageQueryBuilder('upload')` → `taskClass.updateAttachments` ($push to `task.attachments` + socket). Playback reuses `ImagePreview.vue`'s `<video>`/`<audio controls>` (type `video`/`audio`).
- **Additive hooks:** a permission-gated "Record clip" button in `Attachments.vue`; a `webm`/`audio` icon case in `ImageIcon.vue`; i18n keys.

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Voice clip | task → attachments → Record clip → Voice → Start → speak → Stop → Attach | clip uploads as an attachment (type `audio`); plays back via the audio player |
| M2 | Screen clip | Record clip → Screen → Start (pick a window/tab) → Stop → Attach | video/webm attachment; plays back in the video player |
| M3 | Screen + mic | Screen + mic → record → Attach | one clip with screen video + mic audio |
| M4 | Preview / re-record | after Stop | preview plays in the modal; Re-record returns to idle |
| M5 | HTTPS gate | open on plain http | Screen / Screen+mic disabled with an HTTPS hint; Voice still works (getUserMedia needs only localhost/https) |
| M6 | Permission denied | deny the capture prompt | friendly message, no crash; modal stays usable |
| M7 | Native "stop sharing" | start a screen clip, hit the browser's stop-sharing | recording ends cleanly → preview |
| M8 | **Cleanup** | stop / cancel / close / navigate away mid-record | camera/mic/screen indicator turns OFF (all tracks stopped; object URLs revoked) |
| M9 | Plays back later | reopen the task | the clip attachment opens + plays in the existing viewer |

## Guards / non-regression
- One new isolated component + additive hooks; `uploadFiles`/`newAttachments`/storage controller/attachment write-path/`ImagePreview` all **unchanged**. Existing file-attachment upload + display behave exactly as before.
- No npm dependency — native browser APIs only.
- Frontend build clean (0 errors); backend unaffected (frontend-only).
- ⚠️ Capture APIs are browser-gated: `getDisplayMedia` needs a secure context (localhost or https). Verify on a dev server with mic/screen permissions.
