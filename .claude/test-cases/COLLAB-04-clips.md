# Test Cases — COLLAB-04 Clips (global, multi-purpose screen/voice recording) (AHE-3755)

A **clip** is a first-class, reusable recording asset — recorded once by a **global**
app-shell recorder, **uploaded once** to storage, stored as a **clip record**, and usable
**anywhere** by **any user** (their personal "My Clips" library, and — when recorded from a
task — attached to that task). The recorder lives at the app shell, so an in-progress
recording **survives in-app navigation** (opening/closing a task, route changes). Built
**additively**: native `MediaRecorder` (no new dependency), a new `clips` collection +
`/api/v1/clips` API, and the existing storage-upload + task-attachment paths reused
unchanged.

## Architecture

### Backend (additive — mirrors the Notes/Reminders module pattern)
- **New `clips` collection** (company-scoped, user-owned): `{ _id, clipId, userId, companyId, title, url, mediaType('video'|'audio'), mimeType, size, durationSec, source('screen'|'voice'|'screenMic'), deletedStatusKey }`. Registered across `Config/schemaType.js`, `Config/collections.js`, `utils/mongo-handler/{schema,createSchema,mongoQueries}.js` (new entries only).
- **New `Modules/Clips/`**: `POST /api/v1/clips` (create record after upload), `GET /api/v1/clips` (caller's own, newest first), `PATCH /api/v1/clips/:id` (rename), `DELETE /api/v1/clips/:id` (soft delete). `userId`/`companyId` resolved server-side (same pattern as Notes); pure-rules unit test `tests/clips-rules.test.js`.
- **No storage-backend change**: the media file rides the **existing** `/api/v1/.../uploadFile` endpoint. Path `Clips/<companyId>/<userId>/<file>.webm` — the server path guard only blocks traversal/escape, so the prefix is accepted as-is.

### Frontend (additive — global recorder + library + reuse)
- **`composables/useClipRecorder.js`** — module-scoped `reactive` singleton (`state {open,target}`, `openRecorder(target,onSaved)`, `closeRecorder()`, `getOnSaved()`). One shared instance drives the single recorder from anywhere.
- **`molecules/ClipRecorder/ClipRecorder.vue`** — the recorder, now **global**: mounted **once** in `Header.vue` (a sibling of `<router-view>` in `App.vue`), shown via `state.open`. Modes Voice / Screen / Screen+mic; codec fallback; live timer; in-modal preview; **title input**; re-record; minimize→floating pill→maximize; guarded close (discard-confirm); `beforeunload` warn; full track/URL cleanup. On **Save**: upload blob once (reusing the exact attachment-upload helper) → `POST /clips` → invoke `onSaved(clipRecord)` → toast → teardown → close.
- **`molecules/Clips/ClipsPanel.vue`** — **"My Clips"** library (right drawer, mirrors NotepadPanel): list (video/audio badge, title, date), lazy **play** (resolves the stored url via the same `handleStorageImageRequest` the attachment previews use), **rename** (optimistic + rollback), **delete** (confirm), **copy link**, **"+ Record new clip"** → `openRecorder(null, refetch)`. Opened from a new **Clips icon in `Header.vue`** (same permission gate as Notepad).
- **`services/clips.js`** — `createClip / listClips / renameClip / deleteClip`.
- **Task record→attach (COLLAB-04 preserved)**: `Attachments.vue`'s "Record clip" button now emits `record-clip` (no local recorder). `TaskDetailTab.vue` handles it → `openRecorder({type:'task',taskId,projectId}, clip => attachClipToTask(clip))`. `attachClipToTask` builds the same attachment object as `newAttachments` and calls the **existing** `taskClass.updateAttachments({operation:'add'})` ($push + socket), **skipping upload** (the clip is already uploaded once). Playback reuses `ImagePreview.vue`'s `<video>/<audio controls>`.

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Global voice clip | Header → **Clips** icon → **Record new clip** → Voice → Start → speak → Stop → name → **Save** | clip uploads once, appears in **My Clips** (audio badge); plays via the audio player |
| M2 | Global screen clip | Record new clip → Screen → Start (pick window/tab) → Stop → Save | video clip in My Clips; plays in the video player |
| M3 | Screen + mic | Screen + mic → record → Save | one clip with screen video + mic audio |
| M4 | **Record from a task → attach** | open a task → Attachments → **Record clip** → record → Save | clip is in **My Clips** AND attached to **that task** (type video/audio); the task attachment plays in the existing viewer |
| M5 | **Survives navigation** ⭐ | start recording (from task or header) → **close the task / navigate to another route / open a different task** | recording + timer **keep running**; the recorder (or its minimized pill) stays; nothing is lost |
| M6 | Minimize → background | start recording → **Minimize** | collapses to a floating pill (red dot + timer + Stop); the whole app stays interactive; recording continues |
| M7 | Maximize / Stop from pill | maximize → full modal returns (still recording); Stop on pill → ends → preview | as described |
| M8 | **No silent discard** | during recording / unsaved preview, click outside the modal or ✕ | confirm ("Discard this clip?") — cancel keeps recording; only explicit Yes discards. (Idle → outside-click just closes.) |
| M9 | **Warn before leaving** | while recording / unsaved clip, refresh / close tab | native "Leave site?" prompt (beforeunload) |
| M10 | Library — rename | My Clips → ⋯ → Rename → type → Enter | title updates (optimistic; rolls back on failure) |
| M11 | Library — delete | ⋯ → Delete → confirm | clip removed from the list (soft delete server-side) |
| M12 | Library — copy link | ⋯ → Copy link | the clip url is copied (clipboard API, with execCommand fallback on http) |
| M13 | Per-user scoping | record as user A; sign in as user B → open My Clips | B sees only B's clips, not A's |
| M14 | HTTPS gate | open on plain http | Screen / Screen+mic disabled with an HTTPS hint; Voice still works |
| M15 | Permission denied | deny the capture prompt | friendly message, no crash; recorder stays usable |
| M16 | Native "stop sharing" | start a screen clip → hit the browser's stop-sharing | recording ends cleanly → preview |
| M17 | **Cleanup** | stop / cancel / discard / save | camera/mic/screen indicator turns OFF (all tracks stopped; object URLs revoked) |

## Guards / non-regression
- **Existing file-attachment upload + display unchanged** — `newAttachments`, the storage upload helper, the storage controller, the attachment write-path (`taskClass.updateAttachments`), and `ImagePreview` are reused, not modified. Recording from a task reuses only the **second half** of `newAttachments` (the `$push`), skipping upload.
- **Core touches are additive/minimal**: `Header.vue` (1 icon + 2 mounts + 1 ref + 2 imports), `Attachments.vue` (button emits `record-clip`; local recorder removed), `TaskDetailTab.vue` (`@record-clip` handler + `attachClipToTask`). No existing function altered.
- **Backend additive**: new collection + new module + one init line; `npm test` green (524 pass / 47 suites — +15 from the new clips-rules test).
- **No new npm dependency** — native browser capture APIs only.
- **Frontend build clean** (0 errors).
- ⚠️ Capture APIs are browser-gated: `getDisplayMedia` needs a secure context (localhost or https). Verify on a dev server with mic/screen permissions.
