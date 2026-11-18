# The audit log

The audit log is the record of what your AI did. Use it to see who changed what, to find something an agent tried and was refused, and to undo a change.

## Who can open it

An owner or admin. Open **AI** in the left menu, then **Audit log**.

## What it shows

- Every change an agent made. A change made through a connected app shows as "{client} (outside agent) for {person}": the app's name, and yours.
- What each agent tried that was not allowed. These rows say "blocked by policy" or "attempt logged · nothing ran".
- When a person approved something with "Always do this", and when it ended.
- When an owner or admin changed a project's rule for agents, its limits, or its pause.
- Each undo, logged as the person who made it.

A task's own activity also names the agent and the person it acted for, for example "Claude, for Priya Shah has changed Status as Done".

## Find a change

Use the tabs:

- All
- Agents only
- **Outside agents**: only connected apps such as Claude and ChatGPT
- Gated actions
- Undone
- Refusals

Or type in "Search actor, action or reason". You can also filter by date and choose **Export CSV**.

## Undo from here

A change that can still be undone has **Undo** and "Undo until (time)". See [Undo a change](./undo).

## Related

- [Undo a change](./undo)
- [Limits, and pausing agents](./limits-and-pause)
