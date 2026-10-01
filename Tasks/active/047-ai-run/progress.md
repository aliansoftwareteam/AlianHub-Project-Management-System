# Progress: 047 — AI-run

How to read a line: `[x]` is merged into `beta`, with its PR and build number. "In review (#n)" has an open PR. "Running" has an agent at work and no PR yet. "Needs the owner" waits for a step only the owner can take.

## Checklist

**Step 0 — writing only**
- [ ] S-6 Newcomer tests written, and a first run on the local build as it is
- [ ] AI-1 The benchmark sheet written (`ai-benchmark.md`)
- [ ] S-3 The plain-words test and its baseline
- [ ] The owner's answers to the 16 open decisions recorded here

**Step 1 — the road in**
- [ ] AI-4a A real Claude connected over OAuth with the manage grant (needs the owner)
- [ ] AI-4b The agent's name in task history ("Claude, for Priya"), and the loop guard on the newer path
- [ ] AI-4d Token default, expiry notice and renew

**Step 2 — the agent knows the product**
- [ ] T-3 MCP instructions, the five ready-made prompts and the "show me" link
- [ ] AI-4c The project's policy: Done, and how far a connected agent may go
- [ ] AI-2 Over MCP: where the person is, message to task, and the preview card in the web app
- [ ] AI-3 Fields over MCP
- [ ] AI-3 Views over MCP
- [ ] AI-3 Automations over MCP

**Step 3 — measure**
- [ ] AI-1 First measured run over MCP (needs the owner: flags on locally, a connection with the manage grant)
- [ ] AI-4e The dogfood list repeated on the local build (needs the owner)

**Step 4 — the front door and the simple outside**
- [ ] T-1 Sign-up ends in "Connect your AI"; no AI surface looks broken without a server key
- [ ] S-1 Simple mode
- [ ] S-5 No dead ends
- [ ] AI-2 In the web app with no model: quick create, message to task and the palette start where the person is

**Step 5 — the system looks for you**
- [ ] AI-5 The "Needs your approval" tab and row in the Inbox
- [ ] AI-6 Findings from rules, and the daily look
- [ ] AI-6 The work queue for the connected agent
- [ ] AI-6 Triage of new tasks and estimates
- [ ] AI-5 "Always do this", and typed rejections kept as notes

**Step 6 — the teammate**
- [ ] S-2 Describe your project: one plan, one preview
- [ ] T-2 The connected AI as a named member
- [ ] T-4 Agent work visible in List, Table and Board
- [ ] T-5 Several agents at once
- [ ] S-4 Home as "what next"
- [ ] AI-1b The replay test in CI

**Step 7 — prove it (needs the owner)**
- [ ] AI-1 measured again: 15 delegations and 3 reserves, three runs each
- [ ] The one-week trial on one project
- [ ] The newcomer tests run again, on the "connect, then say it" path
- [ ] The scorecard's AI row and newcomer row filled

**Throughout**
- [ ] S-3 Plain-words batches (one line per batch, with the baseline before and after)

**Later, optional (with a server key)**
- [ ] The Ask box that plans with a model (AI-2, AI-3, T-3)
- [ ] The in-product manager on a schedule (AI-6)
- [ ] The generator's wider plan (S-2); the built-in workspace agent (T-2)

## Last step

The plan (`task.md`) was written. Nothing is built.

## Blockers

- **Open, the owner's:** whether `MCP_TOOLS_DATA`, `MCP_TOOLS_MANAGE` and `MCP_TOOLS_WORK` are on by default. It changes a security default and needs an access review first. Not planned as done.
- AI-1, AI-4a, AI-4e and the one-week trial need the owner: the flags on in the local build, and the owner's Claude connected with the manage grant.
- The wave starts after batches 3 and 4 of task 046 are merged, built and looked at.

## Log

### 2026-10-01
- Task created from the advisor review of task 046 (three notes), the coordinator's reply and the owner's decision that the agent is the person's own Claude or ChatGPT over MCP. The code was surveyed on `origin/beta` before writing; the findings are in `task.md` under "What already exists".
- Recorded in task 046 as decisions 27 (the eighth finish line, "AI-run"), 28 (the ninth, "anyone can use it"), 29 (the tenth, "no manual") and 30 (the agent comes over MCP). The owner may overrule any of them.
- Found while surveying: the manage grant over OAuth (#1307), any status including Done, complete creates and the batch call (#1270) are already on `beta`, behind flags that are off by default. The notes listed them as work to do. AI-4 was narrowed to what is really missing.
- #1344, #1348, #1354 and #1355 merged into `beta` the same evening (batch 3), so no slice waits on an open pull request. None of them is in the local build yet.
- Found while surveying: when an AI app connects, the server tells it three sentences written for a coding agent, and offers no ready-made prompts. That is the gap T-3 fills.
