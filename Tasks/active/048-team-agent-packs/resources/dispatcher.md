# The dispatcher: one central gate that decides which agent takes which task

Every task that could go to a role agent passes one place: the dispatcher. It decides which role (Content Writer, Bug Triager, Design Lead …) should take it, checks that the role may and can, puts it in that role's queue with the reason, or stops and asks a person when it is not sure. One place, one log, one set of rules, so the company can see and steer how work is handed to agents.

## What exists to build on (read from the code on 2026-10-08)

- **Assignment rules** (`Modules/AssignmentRules/`): per project, up to 50 sentences "when …, give it to <person>", matched by a model on the task's title, type, tags and description; suggest or apply mode; accept, dismiss and undo; a decision log (`ASSIGNMENT_DECISIONS`). Today a rule can only name a person, never an agent.
- **The agent work queue** (`Modules/Agents/manager/workQueue.js`, `places.js`): items an agent claims one at a time (30-minute claim), places per project (3 by default), pauses per project and for the workspace.
- **The workflow engine** (`Modules/Workflows/`) for handoffs and approval gates, and **Routing policy** (Settings), which picks the AI model for each kind of AI call (it does not route tasks).

## What the dispatcher does, in order

1. **Hears the work.** A task is created or changed (type, tags, list, a field such as Stage, status), a workflow step hands work on, a person writes "@Content Writer" in a comment, or a task is handed to "an agent" without naming one.
2. **Finds the role.**
   - **Rules first, no model needed.** The team lead writes routing rules as plain conditions: "Type is Blog post → Content Writer", "Tag bug, in a Support project → Bug Triager", "Stage is Design and status is Ready → Design Lead". Fields, tags, task type, list, project, status and priority can all be used. The first matching rule wins; the rules are shown in order.
   - **A model second, only with a server key and only if the lead switches it on.** It reads the task and the role descriptions and proposes a role with a confidence. Below the confidence the lead sets (for example 80%), it does not route: it asks.
   - **Otherwise it asks.** The task goes to the "Needs routing" list of the team lead, who picks the role in one click; the dispatcher offers to turn that choice into a rule ("Always send Type = Blog post to Content Writer?").
3. **Checks the role may and can.** The role is on for this project (its pack is on); the role's tools can do this kind of work; the project is not paused for agents; the role and the project have a free place (limits per role and per project); a cross-team hand-off goes only where the other team's role is on and the rights allow it; anything on the never-list is never routed.
4. **Picks who works it.** When several people's connected AIs (or several in-product agents) can play the same role, it gives the task to the least loaded one, or to the one the project names as owner of that role.
5. **Hands it over, visibly.** The task goes into the role's queue, and the task shows one line: "Routed to Content Writer by the dispatcher: rule 'Type is Blog post'". Nothing about the task's assignee changes unless the rule says so.
6. **Learns from people, openly.** When a person moves a task to another role, the dispatcher logs it as an override and, after the same override happens three times, offers a new rule to the lead. It never changes a rule by itself.

## Modes

- **Suggest** (default): each routing waits for the lead's one-click yes in the Inbox; good for the first weeks.
- **Apply**: matching rules route at once; model guesses below the confidence still ask.
- **Off** per team or per project.

## What people see

- **Dispatcher page (AI > Dispatcher):** the rules per team in order, the confidence setting, the mode, and a live log: task, the role it went to, why (rule or model with its confidence), who overrode it.
- **Needs routing:** tasks the dispatcher would not decide alone, with its best guesses.
- **On the company view (org chart and flow board):** each role's queue length, what waits at a gate, what is stuck, and how often the dispatcher was overridden per role (a sign a rule is wrong).

## Rules it keeps

- It decides only where work goes; the role then works under today's agent rules (rights, project policy, pauses, limits, approvals, the never-list).
- Every routing is logged and can be undone; a person's choice always beats the dispatcher.
- The model, when used, sees only the task's title, type, tags, description and the role descriptions, never other tasks or people's data, and uses the AI model chosen in Routing policy for classification.
- Without a server key everything above works with rules and the lead's choices; only the model guess is missing.

## How it is built

Extend the assignment rules engine so a rule may name a **role** as well as a person, add rule conditions on fields, status, list, priority and project (today only a sentence read by a model), add the checks of step 3 from the existing queue and project limits, and write each routing into the role's queue (the existing work queue, with a role on each item). One new page (Dispatcher) and one list (Needs routing) in the web app. Tests: each rule kind, the checks of step 3 one by one, suggest and apply modes, overrides and the rule offer, and that a role never receives work its tools cannot do.
