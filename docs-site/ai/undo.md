# Undo a change

Every change your AI makes is written in the [audit log](./audit-log). Most can be undone, either right after you approve it or later from the audit log.

## Right after you approve

In the AI Inbox, the top bar shows "Approved" with **Undo** right after you approve. It stays for 15 minutes.

Who may undo: the person who approved it, or an owner or admin.

## From the audit log

An owner or admin opens **AI**, then **Audit log**. A change that can still be undone has **Undo** and "Undo until (time)".

1. Choose the tab **Outside agents** to see only the changes made by connected apps.
2. Find the change.
3. Choose **Undo**. It is "Reverted, and logged as you."

- The time is 24 hours after the change, unless your admin set another time.
- You can undo a change only if you can open the project and the thing it touched. If not, you see "You cannot see the project this action touched." or "You cannot see what this action touched."
- A change that was already undone says "Already undone." After the time passes it says "The undo window has passed."

## Changes made by "Always do this"

They are listed in the Inbox under "Done without asking". Each has **Undo**. See [Approve, decline or edit in the Inbox](./approve-in-the-inbox).

## What cannot be undone

- Moving a task to another list or project. A card for it shows "not reversible".
- A change after its undo time has passed.
- A change that failed. It changed nothing.

## Good to know

- Nothing here is deleted for good by your AI. It has no way to delete.
- A project the AI made moves to the Trash when you undo it, unless it already holds a task or a doc.

## Related

- [The audit log](./audit-log)
- [Approve, decline or edit in the Inbox](./approve-in-the-inbox)
