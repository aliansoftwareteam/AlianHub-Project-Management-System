# 047: the newcomer test (S-6)

Written 2026-10-02 against `beta` as of pull request #1412. Tracker: AP-441, sprint "047 wave".

This is the script only. No session has been run yet.

What it is for: finish lines nine and ten in `task.md`. A person who has never seen the product goes from sign-up to a running project, and nobody helps.

`task.md` names the result file `newcomer-tests.md`. This script is `newcomer-test.md`. Results can go at the end of this file, or in that one.

## Who takes part

- **The newcomer.** A person who has never used AlianHub. For the first run it may be a QA agent that plays one: it reads only what is on the screen, never opens a help page and never types an address by hand. Real people as testers are the owner's call.
- **The observer.** Says each goal, runs the clock and writes things down. The observer does not help.

## Before the session

The observer checks these and writes the answers at the top of the score sheet.

1. **The build.** Which build is running.
2. **A new account is possible.** The newcomer needs an account that has never been used. To check: whether the local build lets a person create an account and a workspace without an invitation, and whether sign-up needs an email that the build cannot send.
3. **Which path for the AI.** Choose one before the session and keep to it.
   - **Path A, connect.** The newcomer has Claude and connects it in task 2. This needs the flags of `ai-benchmark.md` to be on, and the address to be reachable by Claude. To check.
   - **Path B, skip.** The newcomer skips "Connect your AI" in task 2 and works by hand.
4. **How a project is described (task 3).** To check, per path:
   - Path A: the first sentence the product offers is "Set up my project". Today the connected AI cannot make the project itself. It asks the person to make it under Projects and then fills it with lists and tasks.
   - Path B: "Create project with AI" exists in the web app and needs a server key. Without a key the newcomer makes the project by hand with "New project".
5. **A proposal for task 8.** One agent proposal must be waiting for the newcomer when task 8 starts.
   - Path A: the observer's goal in task 8 makes one. Adding a field always waits for approval.
   - Path B: to check how to seed one for a brand-new account. Two candidates: the project's "Project manager" switch, or a proposal filed by the observer with a token.
6. **A second address for task 10.** A test address the observer owns. If the build has no mail server, the invitation cannot be delivered. To check what the screen says then.
7. **The tour.** A short first-visit tour may start by itself. Do not switch it off. Write down what the newcomer does with it.
8. **The menu.** A new account should start on "Simple", with five places on the menu. To check on the account used. Task 9 is written for that start.
9. **The screen.** A desktop window. A phone-width run is a separate session.

## Rules for the observer

- Say the goal, word for word, and nothing else. Never say where to click, and never name a screen, a menu or a button.
- If the newcomer asks a question, answer: "Do what you think is right." You may repeat the goal.
- Start the clock when you finish saying the goal. Stop it when the pass rule is true on the screen.
- Ask the newcomer to think aloud. Write down their words, not yours.
- **Stopped** means one of three things: no action for 60 seconds, the newcomer says they do not know what to do, or the time limit passes.
- When the newcomer is stopped: write down the screen and the words on it. Then give the smallest hint that gets them moving, and mark the task "helped". A helped task is not a pass.
- **Help** means any of these: a hint from the observer, a help page opened, or a task finished by following the tour.
- **A settings page** is any screen under Settings or My settings. Write down each one the newcomer opens, and in which task.
- Do not fix anything during the session. Every stop becomes a finding afterwards.

The story to tell the newcomer before task 1, once:

> "You lead a small team. Next month your team moves to a new office. You want one place to plan the move. I will give you ten goals, one at a time. Do each one the way you think is right. I cannot help you, and there are no wrong answers. Please say aloud what you are thinking."

## The ten tasks

For every task, write down the same three things:
- **First wrong click:** the first thing clicked that did not lead toward the goal, and what the newcomer expected it to do.
- **Words not understood:** any word on the screen the newcomer asks about, reads twice or says aloud with doubt.
- **Where they stopped:** the screen and the words on it, if they stopped.

### Task 1: sign up

- **The observer says:** "Create an account for yourself and get into the app."
- **Pass rule:** the newcomer is signed in and sees the first screen after sign-up, without help, in under 2 minutes.
- **Also write down:** how many fields the form asked for, and any field the newcomer did not know how to fill.

### Task 2: connect your AI, or skip it

- **The observer says, path A:** "You use Claude. Link it to this app so it can work for you."
- **The observer says, path B:** "You do not want to link anything right now. Move on."
- **Pass rule, path A:** the screen says the AI is connected, without help, in under 3 minutes.
- **Pass rule, path B:** the newcomer has moved past the offer and is inside the app, without help, in under 1 minute.
- **Also write down:** whether the newcomer understood what connecting gives them, in their own words. On path A, each place they had to leave AlianHub and come back.

### Task 3: make a project by describing it

- **The observer says:** "Get a project for the office move into the app. Describe it in your own words and let the app do the rest."
- **Pass rule:** a project for the office move exists and is open on the screen, without help, in under 3 minutes.
- **Also write down:** what the newcomer typed or said, where they typed it, and how much of the project was made for them and how much by hand.

### Task 4: add tasks

- **The observer says:** "Put three things that have to be done for the move into your project."
- **Pass rule:** the project shows three tasks with the names the newcomer chose, without help, in under 2 minutes.
- **Also write down:** how they added the second and third task. The same way as the first, or a faster way they found.

### Task 5: assign

- **The observer says:** "Make yourself the person responsible for one of them."
- **Pass rule:** one task shows the newcomer as its owner, without help, in under 1 minute.
- **Also write down:** the word they looked for. For example "owner", "assign" or "responsible".

### Task 6: set a date

- **The observer says:** "That one has to be finished by next Friday. Make the app know that."
- **Pass rule:** the same task shows next Friday as its date, without help, in under 1 minute.
- **Also write down:** whether the date picked was the right Friday, and whether a time was added that they did not ask for.

Stop the first clock here. Tasks 1 to 6 are the "running project" part.

### Task 7: find what to do next

- **The observer says:** "You have just sat down at your desk. Find out from the app what you should do first today."
- **Pass rule:** the newcomer points at the line or card that answers it and reads it aloud, without help, in under 1 minute. On Home this is the "What next" line.
- **Also write down:** where they looked first, and whether they could say why the app suggests it.

### Task 8: approve an agent's proposal

- **The observer says, path A, first:** "Ask your AI to add a place on your tasks to note the budget."
- **The observer says, both paths:** "Something in the app is waiting for your yes or no. Find it, read what it will change, and say yes."
- **Pass rule:** the proposal is approved and the change is visible, without help, in under 2 minutes. In the Inbox this is the "Needs your approval" tab.
- **Also write down:** whether the newcomer could say what would change before they approved, and who proposed it.

### Task 9: switch Simple mode off and on

- **The observer says:** "The menu shows only a few places. Make it show every place the app has. Then put it back the way it was."
- **Pass rule:** the menu showed every place, and then the short menu again, without help, in under 2 minutes. The two choices are named "Simple" and "Full".
- **Also write down:** where they looked for it first. This task needs My settings, so it is not counted against the "no settings page" rule.

### Task 10: invite a person

- **The observer says:** "A colleague will help with the move. Bring them into your workspace. Their address is (the test address)."
- **Pass rule:** the newcomer has entered the address and pressed the button that sends the invitation, without help, in under 2 minutes.
- **Also write down:** which role the form chose for the colleague, whether the newcomer noticed it, and what the screen said after sending.

## The score sheet

One page per session.

Date: ____  Build: ____  Observer: ____  Newcomer: person or QA agent ____  Path: A or B ____

Used a project tool before: yes or no ____  Tour: started by itself, yes or no ____  What the newcomer did with it: ____

| # | Task | Limit (min) | Time taken | Done without help | First wrong click | Words not understood | Where they stopped | Settings page opened |
|---|---|---|---|---|---|---|---|---|
| 1 | Sign up | 2 | | | | | | |
| 2 | Connect your AI, or skip | 3 (A), 1 (B) | | | | | | |
| 3 | Make a project by describing it | 3 | | | | | | |
| 4 | Add three tasks | 2 | | | | | | |
| 5 | Assign one | 1 | | | | | | |
| 6 | Set a date | 1 | | | | | | |
| | **Clock for tasks 1 to 6** | **under 10** | | | | | | |
| 7 | Find what to do next | 1 | | | | | | |
| 8 | Approve a proposal | 2 | | | | | | |
| 9 | Simple mode off and on | 2 | | | | | | |
| 10 | Invite a person | 2 | | | | | | |
| | **Clock for the whole session** | **under 60** | | | | | | |

Totals:
- Tasks done without help: ____ of 10
- Stops: ____
- Help pages opened: ____
- Tour followed to finish a task: yes or no ____
- Settings pages opened in tasks 1 to 6: ____

The two lines:
- Sign-up to a running project in under ten minutes, with no settings page: pass or fail ____
- The first hour without help or a tour: pass or fail ____

The three worst stops, each with the screen and the words on it:
1. ____
2. ____
3. ____

## The finish-line rules

**Finish line nine: sign-up to a running project in under ten minutes, with no settings page.**
- It passes when tasks 1 to 6 are all done without help, the clock from the start of task 1 to the end of task 6 is under ten minutes, and no settings page was opened in those six tasks.
- It is judged on the real clock, not on the task limits. A session can pass every task and still fail this line.
- "A running project" here means a project with three tasks, one of them with an owner and a date.
- To settle: `task.md` also asks for one view and one report in the running project. This script does not test those two.

**Finish line ten: the first hour passes without help or a tour.**
- It passes when all ten tasks are done without help, inside 60 minutes.
- A hint from the observer, a help page opened, or a task finished by following the tour each fail it.
- A tour that starts by itself and is closed or ignored does not fail it.

**For both lines**
- One session is one newcomer. A newcomer is never used twice.
- Every stop is filed as a finding with the screen and the words on it, whether the line passed or not.
- The first run spends no model budget on AlianHub's side. On path A the newcomer's own Claude plan is used.
- Run it once on the build as it is today, and again after "Describe your project" (S-2) is built.
