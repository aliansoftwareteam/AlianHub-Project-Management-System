# Chat, mentions and the Inbox

AlianHub has two places for talk and for "what needs me". **Chat** is where you write to people. The **Inbox** is where AlianHub tells you what needs you. This page goes deeper than [The Inbox](first-hour/06-inbox.md). It covers channels, direct messages, mentions, every Inbox tab, the "Needs your approval" tab, notification settings, what stays unread, and what none of it can do.

The two are not the same list. A plain chat message never lands in the Inbox. A mention does.

## Chat at a glance

Select **Chat** in the left bar. The list on the left has a search box, **Direct messages** and **Channels**. Pick one and it opens on the right.

| | Channel | Direct message |
|---|---|---|
| Who is in it | Everyone in the company (public), or the people you name (private) | You and one other person |
| Starts with | **New channel** | The plus button next to **Direct messages**, which is titled **New message** |
| Belongs to a project | No. Chat is company-wide | No |
| Shown in the list as | `#name`, with a lock if it is private | The person's name and a status dot |

Chat is part of your plan. If your plan lacks it, **Chat** shows an upgrade message instead.

Chat is not tied to a project. Channels belong to the whole company, not to one project, and you cannot link one to a project.

## Channels

### Who can make one

Anyone whose role allows **Chat Channel Create**. A new Member role has it on. An owner or admin can turn it off for a role. If you may not create channels, the **New channel** button is not shown.

Your plan also limits how many public and how many private channels the company can have. When one kind is used up, the form says so and only lets you make the other kind. When both are used up, it says "You reached the maximum public and private channel creation limit. To access this feature please upgrade your plan".

### Make a channel

1. In **Chat**, select **New channel**.
2. Type a **Channel Name**. It needs at least 3 characters.
3. Pick an icon under **Icons**, or upload an image with **Upload**.
4. Leave **Private Channel** off for a public channel, or turn it on for a private one.
5. Leave **Send Messages** on if members may write. Turn it off for a read-only channel.
6. For a private channel, choose people under **Only Share with**. You are on the list already.
7. Select **Create Channel**. The channel opens.

### Public and private

| | Public | Private |
|---|---|---|
| Who sees it in the list | Everyone in the company | The people on its list, and owners and admins |
| Who gets its unread counts | Everyone in the company | The people on its list |
| Who can be mentioned in it | Everyone in the company | The people on its list |
| Who can join | Nobody joins. Everyone is already in | Only someone you named when you made it |

Good to know:

- **Only Share with** offers teams as well as people. The Chat list checks whether your own name is on the channel. So name people one by one. A team member you did not name may not see the channel in the list.
- **Send Messages** off means "Sending is turned off for this channel. Only owners and admins can post." Everyone else sees that line where the box would be.
- If your company has channel categories, a new channel goes under the first category. The form has no category choice.
- The **Channel details** button at the top right of a channel shows its purpose, members, **Pinned** messages and **Files**. It is for reading. You cannot change anything there.

## Direct messages

Under **Direct messages**, select a person you have written to before. To start with someone new, select the plus button (**New message**) and pick a name. You can also type a name in **Search channels and people**. Nothing is sent until you write the first message.

- A green dot means the person is available. A red dot means **Do not disturb**.
- To start or read direct messages, you need the **One To One Chat** setting. With it set to read only, you see the conversations but not the box. You see "You have read-only access to direct messages."
- In a direct message, the header has **Start an audio call** and **Start a video call**. They work between two people, on a secure (https) connection, once the first message is sent. Channels have no calls.
- If your company has AI on, agents appear in the list with an **AGENT** tag. Writing to one is like writing to a person.

## Writing a message

The box at the bottom takes text. Press **Enter** to send and **Shift** with **Enter** for a new line. Your half-written text is kept per conversation if you move to another one.

| Button or key | What it does |
|---|---|
| **Attach** | Adds files. Up to 10 at a time |
| **Clip** | Records a short video clip |
| **Voice note** | Records up to 5 minutes. Stop, then **Send** |
| **Talk to text** and **Ask AI** | Only when AI is on |
| The arrow beside **Send** | **Send and make a task** sends the message and opens the new-task sheet |
| Type `/` | Shows **Commands**: make a task, summarize the thread, record a clip, record a voice note |

### Mention someone

Type `@` and pick a name from **People to mention**. The list holds the members of that channel, or the other person in a direct message. Agents are listed under **Agents**. Typing `@ai` or picking **Ask AI** asks the built-in AI, when it is on. There is no "mention everyone" in chat.

What a mention does:

- It adds a row to that person's Inbox, in **Primary**. It reads "{name} mentioned you in chat". It always appears there. Notification settings do not remove it.
- It adds to the person's unread count in Chat.
- It sends a push alert if their **Comments I'm @mentioned In** line under **Chat** has **Inbox** or **Push** ticked. It sends an email only if **Email** is ticked on that line. Email is off by default.
- It reaches only people who can open that conversation. A mention of someone who cannot see a private channel does nothing.

### What you can do with a message

Point at a message. Two things show: a face button for reactions, and a **More actions** (three dots) menu.

| Action | Notes |
|---|---|
| **Reply** | Quotes the message in your next one |
| **Reply in thread** | Opens a **Thread** panel. Replies stay out of the main flow. The message shows "1 reply" or "{count} replies" |
| **Add reaction** | Eight emojis: thumbs up, heart, smile, party, surprised, sad, rocket, eyes |
| **Copy text** | Copies it |
| **Edit message** | Your own text messages only. Shows "(edited)" after |
| **Delete message** | Your own messages only. Asks "Delete this message?". It then reads "You deleted this message", and others see "This message was deleted" |
| **Pin message** and **Unpin message** | Keeps it in **Pinned messages** and in **Channel details**. Anyone in the conversation can pin |
| **Mark as unread** | Marks the conversation unread from that message |
| **Make a task** | Opens the new-task sheet with the message text |
| **Save for later** | See the warning below |

Warning: **Save for later** and **Pin message** do the same thing. Both pin the message for everyone in the conversation. **Save for later** is not a private bookmark.

At the top of a conversation, **Search in conversation** looks through that one conversation for message text and file names. With AI on you also see **Summarize thread**, and in a channel **Ask about this channel**.

## What is unread in Chat

Each channel and each direct message shows a number when you have unread messages, up to "99+". The count is for that one place. The left bar's **Chat** item shows no number. Only **Inbox** does.

- A new message from someone else adds to the count for everyone in the conversation. A reply inside a thread does not.
- Opening a conversation marks it read, but only while your browser window is in focus. A window in the background does not mark anything read.
- Inside the conversation, a line and the words "{count} unread messages" mark where the new ones start.
- **Mark as unread** on a message puts the count back from that message on.

## The Inbox

Select **Inbox** in the left bar. The number on it is your unread notifications and mentions together, up to "99+". A page opens with six tabs.

| Tab | What is in it |
|---|---|
| **Needs your approval** | Time-off requests, and changes an AI proposes. See below |
| **Primary** | Unread things for you: mentions, assigned comments, replies, reminders, and updates on things you are directly part of. It opens first |
| **Other** | Unread updates on things you only watch. A mention or an assignment never goes here |
| **Later** | Things you snoozed |
| **Done** | Things you have read. Mark done, open or reply to a row and it moves here |
| **Cleared** | Things you cleared in the last 30 days |

Most tabs show a number: **Needs your approval**, **Primary**, **Other** and **Later**. **Done** and **Cleared** show none, because they hold things you dealt with.

### Filter

On every tab except **Needs your approval**, the side panel has **Filter**:

| Choice | Shows |
|---|---|
| **Everything** | All rows on the tab |
| **Mentions** | Where someone mentioned you, in tasks and in chat |
| **Assigned comments** | Comments given to you |
| **Reminders** | Reminders that came due |
| **Updates** | All the rest, such as a status change on something you watch |

### What you can do with a row

| Button | What it does |
|---|---|
| **Open task** or **Open chat** | Goes to it. A task opens over the Inbox. This also marks the row read |
| **Open** | The same, for other rows |
| **Reply here** | Answers a task mention without leaving the Inbox. Not offered for a chat mention. Use **Open chat** |
| **Mark done** | Moves it to **Done** |
| **Mark as unread** | In **Done**, moves it back |
| **Snooze** | Sets it aside. See below |
| **Unsnooze** | In **Later**, brings it back now |
| **Clear** | Moves it to **Cleared** |
| **Restore** | In **Cleared**, puts it back in **Primary** |
| **Done** and **Open reminders** | On a reminder row |

After **Clear**, **Snooze**, **Mark all read** and **Clear all**, a bar at the bottom shows **Undo**. It stays about 6 seconds.

**Snooze** offers **Later today**, **Tomorrow**, **Next week**, **Until it changes** and **Pick a date and time**. "Until it changes" brings the row back on new activity. A snooze can last up to a year. You can snooze only from **Primary** and **Other**. A snoozed row counts as read while it waits. When its time comes, it returns to **Primary** as unread.

Keys, when you are in the list: **j** and **k** (or the arrow keys) move, **Enter** opens, **r** replies to a mention, **e** clears, **s** snoozes. If you switched single-key shortcuts off in your preferences, only the arrow keys and **Enter** work.

### What leaves unread, and how to clear

| You do this | The row |
|---|---|
| Open it, or choose **Mark done** | Becomes read and moves to **Done** |
| Reply to it with **Reply here** | Becomes read and moves to **Done** |
| **Snooze** it | Becomes read and moves to **Later** until its time |
| **Clear** it | Becomes read and moves to **Cleared** |
| **Mark all read** | Every unread row on **Primary** or **Other** becomes read. The button shows only on those two tabs |
| **Clear all** | Clears every row on the tab you are on, narrowed by the **Filter** you picked. It is on **Primary**, **Other**, **Later** and **Done** |

Cleared rows stay in **Cleared** for 30 days. Then they are deleted. The page says "Cleared items are deleted after 30 days." Until then **Restore** brings one back.

A page shows 10 rows. Select **Load more** for more. The newest come first. When a tab is empty it says "You're all caught up" (Primary) or its own line, with **Back to Primary**.

### Needs your approval

This tab holds two kinds of card.

**Time-off requests.** Only an owner or admin sees these. You never see your own request. Each row reads "{name} requested {dates} off · needs your approval". It shows the type of leave and, in quotes, the reason. The list shows the 20 newest waiting requests.

- **Approve** accepts it. **Decline** turns it down. The person is told which.
- The bar at the bottom then shows "Approved {name}'s time off." or "Declined {name}'s time off." with **Undo**. **Undo** sets the request back to waiting. It lasts about 6 seconds.
- An approved request shows on the Calendar as **PTO**. See [Views, filters and saved views](views.md).

**Changes proposed by an AI.** These cards come from your connected AI app or an agent. They show who asks, why, and "What changes". You can **Approve**, **Edit** (on agent cards that allow it) or **Decline**. You can tick several and use **Approve selected**. A card says "Needs an owner or admin" or "Needs someone who may make this change" when you may not decide it. The number on the tab counts only cards you may decide. All the steps, **Always do this** and undo are in [Approve, decline or edit in the Inbox](agents/03-approve-in-the-inbox.md).

On this tab there is no **Filter**, no **Mark all read** and no **Clear all**. A card leaves when someone decides it. You cannot clear it or snooze it.

## Notification settings

Open **Settings**, then **Notifications**. The page says "Defaults for everything you're watching. Any single task can override these."

It is a grid. Each line is one kind of event. Each column is a way to be told. Tick a box to turn it on. It saves at once.

| Column | Means | Default |
|---|---|---|
| **Inbox** | A row in your Inbox. Also used to send a browser or phone alert | On |
| **Email** | An email | Off |
| **Push** | A push alert to your phone or browser | On |
| **Chat** | See below | Off |

The groups are **Tasks**, **Project**, **Docs**, **Goals**, **Before** and **Chat**.

- **Tasks** has **Notify for**. Choose **All** or **Assigned to me**. It starts on **Assigned to me**.
- **Before** has **Notify when** on each line, from 10 minutes up to 3 days before.
- **Chat** has two lines. **Message Create** is about new messages. **Comments I'm @mentioned In** is about mentions.
- Replies to your comments, and comments given to you, are under **Tasks**, as **Replies to my comments** and **Comments assigned to me**. Replies in a chat thread use the same line.

Three things to know about the grid:

- **Inbox** and **Push** are not separate. A row reaches your Inbox when either one is ticked. To stop rows, untick both. Mentions in the Inbox are the exception: they always show.
- **Message Create** never sends email, even with **Email** ticked. It only sends the push alert, to people in the conversation. It never makes an Inbox row.
- The **Chat** column has no effect today. Nothing reads it.

Below the grid:

| Setting | What it says | Default |
|---|---|---|
| **Browser notifications** | "Get an alert on this device when something needs you, even with AlianHub in the background." Select **Turn on** and allow it in the browser. If it says "Blocked in this browser", change the site setting and reload | Off until you allow it |
| **Quiet hours** | "No push between" two times, with a box "Also respect my time off and Do not disturb". "Urgent @mentions still come through" | Off |
| **Agent activity** | "Approvals agents need from you and actions they took on their own. One switch for all agent noise." | On |
| **Daily digest instead** | "One email at 08:00 with everything non-urgent from the last day." | Off |

Owners and admins also see an AI alerts section here, when AI alerts are on for them.

The server saves **Quiet hours** and **Daily digest instead**, but nothing applies them yet. Turning them on does not stop an alert and does not send a digest.

## What it cannot do

- **Link a channel to a project.** Chat is company-wide. A channel is not a project's channel.
- **Change a channel after you make it.** There is no way to rename it, change its icon, add or remove members, switch public or private, archive or delete it.
- **Pick a channel's category** when you make it, or make a category in Chat.
- **Join or leave a channel.** A public channel is everyone's. A private one is the people you named.
- **Mute a channel or a conversation.** The one switch is the **Message Create** line, which covers all chat.
- **Mention everyone.** There is no `@all` or `@here` in chat.
- **Search all of Chat at once.** **Search in conversation** reaches one conversation. **Search channels and people** in the list matches names only.
- **Edit or delete someone else's message.** Only your own.
- **Make a private bookmark.** **Save for later** pins for everyone.
- **Call a group.** Calls are one to one.
- **Stop a read-only channel on the server.** **Send Messages** off is enforced by the Chat screen, not by AlianHub's server.
- **Search the Inbox.** There is a **Filter** and tabs, no search box. Rows come newest first, with no other order.
- **Show chat in the Inbox.** A plain chat message adds only an unread count in Chat, and a push alert if you allow it. Only mentions and thread replies reach the Inbox.
- **Clear or snooze a card in Needs your approval.**
- **Reply to a chat mention from the Inbox.** Use **Open chat**.
- **Show the Chat unread count in the left bar.** Only **Inbox** has a number.
- **Quiet hours** and **Daily digest instead** do nothing yet.

Next: [Views, filters and saved views](views.md). Back to [The Inbox](first-hour/06-inbox.md). For AI changes, see [Approve, decline or edit in the Inbox](agents/03-approve-in-the-inbox.md).
