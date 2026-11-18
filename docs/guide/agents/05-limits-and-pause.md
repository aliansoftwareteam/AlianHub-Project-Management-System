# Limits, and pausing agents

## In one project

Open the project, then its details. Three cards are about agents. They are not shown for a personal project. A person who may see the project's details sees them. Only an owner or admin can change them. Others read "An owner or admin changes these settings." or "Only an owner or an admin can change these."

### "Agents in this project"

- **Agents and Done**: "Never", "With approval" or "Yes, marked unchecked". See [What your AI can do](02-what-it-can-do.md).
- **Connected agents**: "Propose everything" or "Act on single tasks, propose anything wider".

A project can be stricter than the workspace, never looser.

If your workspace has "A person checks an agent's work before a task is closed" turned on (under AI, Accounts), a person closes every task, whatever the project chose.

### "Agents working at the same time"

- **Agents at work at once**: a number from 1 to 20. The default is 3. When this many are at work, the next agent waits and gets work when one finishes.
- **Tasks a connected agent changes on its own**: a number from 1 to 100. The default is 10. A connected agent changes up to this many different tasks in 10 minutes without asking. Its change to one more task waits for you. New tasks and docs count too.

Neither number changes what people can do.

### "Always do this"

This card lists the standing approvals in the project. See [Approve, decline or edit in the Inbox](03-approve-in-the-inbox.md).

## Pause all agents in one project

On the card "Agents working at the same time", choose **Pause all agents**.

- Agents stop taking work and changing things in that project right away. People carry on as usual.
- Work they were doing there is stopped.
- Reading is not stopped.
- A change that was already waiting still runs if you approve it. Your approval is your own decision.
- The card says "Agents are paused in this project. They take no work and change nothing here until someone resumes them."

Choose **Resume agents** to let them work again.

The pause covers your own AI app too. Its changes in that project are refused with the reason that agents are paused there.

## Pause all agents in the whole workspace

An owner or admin can choose **Pause all agents** at the bottom of the AI menu. It is turned off while no agents are running.

This pauses the agents that AlianHub runs for you. It stops their runs now.

It does not stop an AI app you connected yourself, such as Claude or ChatGPT. To stop those everywhere:

- Pause agents in each project, as above. Or
- Open Settings, then **Agent clients**, and choose **Revoke** next to the app. Everyone's connection to that app in this workspace ends now.
