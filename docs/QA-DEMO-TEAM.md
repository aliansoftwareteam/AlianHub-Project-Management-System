# QA demo team

A local-only seed that gives QA a realistic team to test member-role behaviour against: eight people with different IT roles, a sandbox project with an active sprint and tasks, and four AI agents. It never runs against anything but a local database.

## What it creates

All of it goes through the app's own code paths, so login, the permission checks and member lists treat these users like invited teammates.

| Person | Title | Email | Role |
| --- | --- | --- | --- |
| Rahul Mehta | Engineering Manager | rahul.manager@demo.test | Admin (roleType 2) |
| Priya Shah | Frontend Developer | priya.frontend@demo.test | Member (3) |
| Arjun Rao | Backend Developer | arjun.backend@demo.test | Member (3) |
| Sara Khan | QA Engineer | sara.qa@demo.test | Member (3) |
| Neha Iyer | UI/UX Designer | neha.design@demo.test | Member (3) |
| Vikram Singh | DevOps Engineer | vikram.devops@demo.test | Member (3) |
| Anita Desai | Business Analyst | anita.analyst@demo.test | Member (3) |
| Kabir Joshi | Intern Developer | kabir.intern@demo.test | Guest (0), the most restricted non-owner role in the catalogue |

Role numbers are read from the company's role catalogue (Settings > Roles) by name, not hard-coded. When the catalogue has no Guest role, Kabir falls back to Member.

The user model has no free-text job title. The seed sets the membership `designation` to the closest entry in the company's designation catalogue and leaves it at 0 (what an invite stores) when there is none. Titles are also kept in the credentials file.

- **Users and memberships** — `addUserMongodbV2` (the invite sign-up path), then the membership row an accepted invite leaves behind (status 2), the notification counter and the default notification settings.
- **Project "QA Sandbox"** (key `QAS`) — built from the company's templates and saved through `createProject`, with all eight as members and Rahul as lead. That also creates the usual "List" sprint.
- **Sprint 1** — `addSprintFun`, then the Scrum handlers `setScrum` (14-day window and goal) and `startSprint`, so it is the project's one active sprint.
- **Twelve tasks** — created with `taskMongo.create`, the helper behind `POST /api/v2/tasks`, so task keys, the status index, sprint counts, history and notifications stay consistent. They cover a login bug, API rate limiting, a design review, a flaky CI pipeline and more, spread across statuses, priorities and people.
- **Four agents** — `createAgentRecord`, which also writes each agent's first live revision. All four are scoped to QA Sandbox only, at autonomy L1 ("Suggest"), with a $1 spend cap. Allowed actions are exactly what the skill can emit:

| Agent | Skill | Allowed actions |
| --- | --- | --- |
| Intake Bot | `brief.parse` | `subtask.create`, `task.comment` |
| QA Reviewer | `qa-review` | `subtask.create`, `task.comment` |
| Standup Reporter | `digest.ceo` | `task.comment` |
| PR Summarizer | `pr.summary` | `task.comment` |

## Commands

```bash
npm run demo:seed                          # the only company, or refuses when there are several
npm run demo:seed -- --company <companyId>
npm run -s demo:token -- --email priya.frontend@demo.test
npm run demo:unseed                        # everything the credentials file records
npm run demo:unseed -- --company <companyId>
```

Seeding is idempotent by email: a second run creates nothing new and keeps the existing passwords.

`demo:token` prints a one-hour session token for a demo user on stdout. It is minted by the same session and JWT helpers a password login uses, so it carries the same claims. Use it like this:

```bash
TOKEN=$(npm run -s demo:token -- --email priya.frontend@demo.test 2>/dev/null | tail -1)
curl -H "Authorization: Bearer $TOKEN" -H "companyid: <companyId>" http://localhost:4000/api/v2/agents
```

The running server caches the member list for a week. Restart it after seeding or unseeding so Settings > Members shows the change.

## Safety rules

- The scripts refuse to run unless `MONGODB_URL` points only at `localhost` or `127.0.0.1` and `NODE_ENV` is not `production`. There is no `--force`.
- Every user, membership, project, sprint, task and agent the seed creates carries `demo: true`. Everything else it creates is listed in the manifest in the credentials file: login record, notification settings and counter, history, notifications, agent revisions and sessions.
- `demo:unseed` deletes a row only when the manifest lists it and it is demo-flagged or hangs off a demo-flagged parent. Removal runs in dependency order: agents, notifications, history, tasks, sprints, the project, sessions, memberships, users. An edited manifest cannot reach real data.
- Anything people create inside QA Sandbox after seeding is not in the manifest and is left in place.
- An existing account that already uses a demo email is never modified. The seed stops before creating the project.
- Passwords are random (`crypto.randomBytes`) and are never printed.

## Credentials

Passwords, user ids and the manifest are written to `.demo-accounts.local.json` in the repository root with file mode 0600. The file is git-ignored. Demo users log in at the normal login screen with those passwords. Delete the file only after `demo:unseed`: without it the unseed script has nothing to go on.
