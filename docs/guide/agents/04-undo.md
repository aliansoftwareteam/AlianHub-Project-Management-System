# Undo a change

Every change your AI makes is written in the [audit log](07-audit-log.md). Most can be undone.

## Right after you approve

In the AI Inbox, the top bar shows "Approved" with **Undo** right after you approve. It stays for 15 minutes.

Who may undo: the person who approved it, or an owner or admin.

## From the audit log

An owner or admin opens **AI**, then **Audit log**. A change that can still be undone has **Undo** and "Undo until (time)".

- The time is 24 hours after the change, unless your admin set another time.
- Choose the tab **Outside agents** to see only the changes made by connected apps.
- Choose **Undo**. It is "Reverted, and logged as you."
- You can undo a change only if you can open the project and the thing it touched. If not, you see "You cannot see the project this action touched." or "You cannot see what this action touched."
- A change that was already undone says "Already undone." After the time passes it says "The undo window has passed."

## Changes made by "Always do this"

They are listed in the Inbox under "Done without asking". Each has **Undo**. See [Approve, decline or edit in the Inbox](03-approve-in-the-inbox.md).

## What cannot be undone

- Moving a task to another list or project. A card for it shows "not reversible".
- A change after its undo time has passed.
- A change that failed. It changed nothing.

Nothing here is deleted for good by your AI. It has no way to delete.
