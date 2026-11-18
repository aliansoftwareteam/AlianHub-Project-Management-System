# First run

The first time AlianHub starts on an empty database, it opens a setup page where you create the owner account and the first workspace. Nothing is created automatically and there is no default password.

## The setup page

With no users in the database, every address redirects to **`/#/setup`**, titled **Set up AlianHub**.

The page first checks the database. If MongoDB cannot be reached it shows **The database is not reachable**, the exact error, and three steps:

1. Set the database address (`MONGODB_URL`) in `.env` or the environment.
2. Restart the server.
3. Come back and press **Check again**.

If the server itself does not answer, the page says so and offers **Check again**.

## Fill in the form

| Field | What it is for |
|---|---|
| **First name**, **Last name**, **Email** | The owner account. You log in with this email. |
| **Password** | 8 to 256 characters, with an uppercase letter, a lowercase letter, a number and a symbol. The same rule applies to every password chosen later. |
| **Workspace name** | The first workspace (company). You can add more workspaces later. |
| **What does your team mainly do?** | Optional: Software, Marketing, Design / creative, Support, Hiring, Something else or Not sure yet. It picks the sample project and which templates come first, and can be changed later. |
| **Start with a sample project** | A small project that explains the product by being read. Remove it any time from Home. |

Press **Create workspace**. Under a minute later you are logged in as the owner.

## What setup does

Progress streams to the page, step by step:

1. **Seeding defaults**: file-type rules, custom-field types and product tours, shared by the whole instance.
2. **Creating the owner account**: marked as email-verified, because mail is rarely configured yet.
3. **Creating the workspace**.
4. **Applying workspace settings**: the workspace's default settings.
5. **Adding the sample project**, if you asked for one.

If a step fails, the page shows **Setup did not finish** with the step that failed. Nothing you typed is lost: fix the cause (the server log has the details, see [Logs and monitoring](./monitoring)) and try again.

## The instance owner

The account created here is the **instance owner** (stored as `users.isProductOwner`). It is the only account that sees **Settings › Instance**, where mail, storage, backups and upgrades are configured. It is also the owner of the first workspace.

Everyone else is invited from **Settings › Members** once [mail](./mail) works. Invitations need mail; until it is configured, the readiness card on **Settings › Instance › Health** reminds you.

## Setup runs once

Once any user exists, setup refuses to run again: `POST /api/v2/setup/complete` answers HTTP 409 ("This instance is already set up. Log in instead."). To start over on a test install, drop the databases (or, in Docker, remove the volumes) or restore an empty backup.

If the setup page appears on an instance that already has users, the app cannot see its database. Check `curl -s http://localhost:4000/health` and `MONGODB_URL`; see [Troubleshooting](./troubleshooting).

## Endpoints

| Method and path | Who | Purpose |
|---|---|---|
| `GET /api/v2/setup/status` | anyone | `{installed, dbOk, dbError, version}` |
| `POST /api/v2/setup/complete` | anyone, once | creates the owner and the workspace; 409 afterwards |

On an AlianHub Cloud instance the platform creates the workspace and emails the owner, so the setup page only says **Your workspace is being prepared**.

## Next steps

1. Put the instance behind HTTPS: [HTTPS and reverse proxy](./https).
2. Configure mail and press **Test**: [Mail](./mail).
3. Choose where files go: [File storage](./storage).
4. Take the first backup: [Backup and restore](./backups).
5. Invite your team from **Settings › Members**.

## Related

- [The Instance console](./instance-console)
- [Troubleshooting](./troubleshooting)
