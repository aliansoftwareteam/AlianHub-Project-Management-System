# Progress: Chat message alerts and unread badge

## Checklist

- [x] Server: chat notice to each recipient's personal room, from the unread-count recipients
- [x] Background tab: keep the socket on personal rooms only while hidden
- [x] Client: listen for the notice; in-app pop-up unless the conversation is open
- [x] Client: browser notification when hidden (permission, setting, DND, Firebase de-dup, tag)
- [x] Red unread badge on the Chat rail tile and mobile tab bar
- [x] i18n keys + backfill; style check
- [x] Unit tests
- [x] Two-user check in the browser

## Last step

Merged into `staging` as #1787 on 2026-11-13 (build 14.43.0-beta.16); goes to `main` with the promotion #1790.

## Blockers

None.

## Log

### 2026-11-12
- Task created from a bug report: chat messages give the other person no notification and no red count.
- Root causes found: a plain chat message writes no notice; the only alert is a sender-triggered Firebase
  push, which Docker / Cloud images cannot send (no Firebase keys); hidden tabs disconnect their socket; the
  Inbox is the only rail tile with a badge, though per-conversation unread counts already exist.
- The question dialog was cut off, so the recommended choices were taken: pop-up + browser notification,
  background tab stays connected to personal rooms, badge counts all unread chat messages.
- Owner confirmed the spec ("Yes, build it").
- Server: `bumpUnreadCounts` now resolves with the people it reached; `Comments/helpers/chatNotices.js` sends
  them a `chatNotice` (sender, preview, conversation, browser on/off from their "Message Create" setting),
  relayed by `socket/controller/userNotificationCount.js` to each person's own room in that company only.
  Only conversations in a chat space (direct-message space or a channel space) are announced.
- Server: `goIdle` socket event (`socket/helper.js#keepPersonalRoomsOnly`) leaves every room but the person's
  counter room. `App.vue` sends it when the tab is hidden instead of disconnecting, and closes the idle
  socket once the fresh one connects when the tab is shown again (the resync runs as before).
- Server: `GET /api/v1/main-chats/unread-keys` lists the counter keys of the conversations the Chat page
  lists for the caller (live DMs with active people or agents, channels they can see), so the badge never
  sums a count left by a deleted or closed conversation. Agents are refused, as for direct messages.
  `docs/API.md` and `docs/api/openapi.json` are left for the follow-up docs PR (Rule 4).
- Client: `Shell/ChatAlerts.vue` (mounted in `App.vue`) shows up to three pop-ups (6 s, held on hover or
  focus), and an OS notification when the tab is hidden or unfocused, tagged `chat-<commentId>` so several
  tabs show one. Skipped for the open conversation, in DND, for one's own message, without the chat
  permission, and in a browser already registered for Firebase push.
- Client: `Shell/chatUnread.js` + `navUnread.js` put the count on the Chat tile of the rail and the phone
  tab bar, on the More button and menu row when Chat is tucked away, with "Chat, {n} unread" labels.
- Not covered: AI and agent replies saved directly by `AI/aiMention.js` and `Agents/chatAgents.js` raise no
  unread count today, so they send no notice either.
- Tests: `chat-message-notices`, `chat-unread-keys`, `comment-unread-bumps` (audience), four socket
  integration cases in `socket-room-membership` (hidden tab, notice per person and company), frontend
  `chatAlerts.spec.js` and a Chat badge case in `phoneTabBar.spec.js`. `shortcutSheet.spec.js` and
  `darkModeBatchThree.spec.js` fixtures updated for the new shell parts.
- Failures seen that also fail on a clean checkout on this Windows machine: backend conventions
  ai-core-boundary, ci-e2e-shards, plain-words, retired-flags, role-playbooks, style-check baseline format;
  frontend chatTokens "floor is 40px", firstPaintSet (two), darkModeBatchThree table (path separators).
- Two-user check on a private local stack (this worktree's server on :4150, a fresh MongoDB on :27031, demo
  team seeded, both removed afterwards). A script connected Priya's socket and had Arjun post through
  `POST /api/v1/comments`: a DM and a #general post each reached her as a count update plus a notice
  (sender, preview, channel name, `&amp;` shown as `&`); after `goIdle` only her `userIdNotification` room
  was left and the next DM still arrived. `unread-keys` listed the DM and the channel for Priya and not the
  DM for Sara. In the browser as Priya: the rail showed "Chat, 3 unread"; a DM sent while she was on Home
  popped up ("Arjun Rao" / message) and the badge went to 4; a channel post popped up as "Arjun Rao in
  #general" and clicking it opened the channel at its unread line; reading it took the badge from 5 to 3
  live; a post in the channel she was reading raised no pop-up. Browser notifications are denied in the
  app's browser pane, so that path rests on the unit tests and the socket check.
- Seen while testing, unchanged here: a conversation counts as read only once the reader clicks or types in
  it (MainChatPanel `engaged`), not on opening; a hidden tab also leaves its `call_` room, as it did when it
  disconnected, so an incoming call still rings only in a visible tab.

### 2026-11-13

- Merged into `staging` as #1787, build 14.43.0-beta.16. Beta log and API docs (new `GET /api/v1/main-chats/unread-keys`) updated in the follow-up docs PR; promotion to `main` in #1790.
