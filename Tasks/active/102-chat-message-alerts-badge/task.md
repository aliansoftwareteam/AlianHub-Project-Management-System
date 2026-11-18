---
id: 102
title: Chat message alerts and unread badge — the other person hears about a message, and the Chat icon shows a red count
status: active
priority: high
depends_on: []
created: 2026-11-12
---

# Chat message alerts and unread badge

## Goal

When someone sends a direct message or posts in a channel, the people it is for find out at once: a pop-up
in the app, a browser notification when the tab is in the background, and a red count on the Chat icon
until they read it. Today a plain message (no @mention) reaches nobody outside the open conversation, so
messages sit unseen.

## What is wrong today

- **No notification.** A chat message writes a notice only when it @mentions someone. The one other alert
  is a Firebase web push the sender's browser asks for (`useMainChatConversation.js` → `/api/v1/send-fcm`).
  That needs Firebase keys built into the frontend, and the Docker / Cloud image has none, so on those
  installs nothing is sent. Even with Firebase, a recipient whose AlianHub tab is open sees nothing: data
  pushes to an open page are not shown, and there is no in-app pop-up.
- **Background tabs are deaf.** `App.vue` disconnects the live socket whenever the tab is hidden, so a
  background tab hears nothing until it is looked at again.
- **No highlight outside the Chat page.** The server already raises a per-conversation unread count for
  every recipient (`Modules/Comments/helpers/unreadBumps.js`), and the Chat page's own sidebar shows it per
  row. The left rail and the mobile tab bar show a red badge for Inbox only; `useChatDirectory`'s
  `totalUnread` is computed and never used.

## Scope

1. **Server: tell each recipient a message arrived.** When a top-level chat message (direct message or
   channel) is saved, send each recipient a small live notice on their personal socket room: conversation
   (space, list, thread), sender, a short plain-text preview, and the comment id. Recipients are exactly the
   people whose unread count is raised for it (same rule as `bumpUnreadCounts`: a DM's two people, a
   private channel's members, a public channel's active members, minus the author and anyone who set the
   project to Ignore). Applies to messages written through the app, the API, MCP and agents alike.
2. **In-app pop-up.** On any page, a new message shows a toast with the sender's name and the first line,
   unless the person is already looking at that conversation. Clicking it opens the conversation.
3. **Browser notification.** When the tab is hidden and the person has allowed notifications, show an OS
   notification (sender, preview, click opens the conversation). Tagged by message, so several open tabs
   show one notification. Skipped in a browser that already receives Firebase pushes, so nobody gets two.
   Follows the person's "Chat → Message Create → Browser" notification setting.
4. **Background tab stays reachable.** When the tab is hidden, keep the socket connected to the person's
   own rooms only (counts and chat notices) and leave every data room, so a hidden tab costs little. When
   the tab is shown again, the existing resync runs as today.
5. **Red badge on the Chat icon.** The Chat tile on the left rail and on the mobile tab bar shows a red
   count of all unread chat messages (direct messages and channels the person can see), with the same look,
   99+ cap and screen-reader label as the Inbox badge. It updates live and drops as conversations are read.
6. **Do Not Disturb.** A person in Do Not Disturb gets no pop-up and no browser notification; the badge
   still counts.
7. i18n keys for every new string (Rule 3) and tokens only for colours (Rule 5).

## Out of scope

- Inbox entries for every chat message (an @mention already makes one).
- Sound on a new message.
- Standard Web Push (VAPID) so a closed browser is reached without Firebase. A separate task if wanted.
- Moving the existing Firebase push from the sender's browser to the server.
- Thread replies: they already send a reply notice; no pop-up or badge change for them here.
- An unread count in the browser tab title or favicon.
- The desktop (Electron) and time-tracker apps.

## Acceptance criteria

- [ ] User A sends user B a direct message while B is on another page (Projects, Home…): B sees a pop-up
      naming A with the message's first line within a couple of seconds; clicking it opens the conversation.
- [ ] Same with B's AlianHub tab in the background and notifications allowed: B gets one OS notification,
      even with two AlianHub tabs open. Works on an install without Firebase keys.
- [ ] B already looking at that conversation gets no pop-up and no notification.
- [ ] A post in a public channel alerts every active member except the author; a private channel alerts
      its members only; nobody outside a DM or private channel receives its preview.
- [ ] B in Do Not Disturb, or with "Message Create → Browser" turned off, gets no OS notification; DND also
      silences the pop-up.
- [ ] The Chat icon on the left rail and the mobile tab bar shows a red count of B's unread chat messages,
      updates without a reload when a message arrives, and clears as B reads the conversations.
- [ ] A message sent through the API or by an agent alerts recipients the same way.
- [ ] Hiding and showing the tab still resyncs tasks and chats as before (no stale lists).
- [ ] New server logic has unit tests; `npm run i18n:check`, `npm run style:check` and the related existing
      tests pass.

## Constraints & notes

- Personal room: `userIdNotification_<uid>` (`socket/controller/userNotificationCount.js`), already
  company-scoped through `toSeated`. The new notice rides the same room.
- Recipients come from the same function that raises unread counts, so a notice and a count never disagree.
- Unread keys are `task_<spaceId>_<listId>_<threadId>_comments` in the per-user counts document
  (`users/myCounts`). The badge must count only conversations the person can still open, so a deleted
  conversation cannot leave a count stuck on the icon.
- Existing toast plugin: `vue-toast-notification` (`frontend/src/main.js`).

## Resources

None yet.
