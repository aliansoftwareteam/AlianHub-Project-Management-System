# First-run test — clone to dashboard

Tests the 13 first-run changes on branch `feat/first-run-experience`.

**Important:** the installer deletes the `installation/` folder when it finishes, so a second test
run needs a fresh clone (or `git checkout installation/`). Use a **new empty folder**, not your
working copy.

---

## Before you start

- Node 20 or newer — `node -v`
- A MongoDB connection string you can point at a **fresh, empty** database host
- Port 4000 free
- Nothing else needed. No storage account, no Firebase, no AI key, no mail server — that is part of
  what is being tested.

---

## 1. Clone and set up

```bash
git clone -b feat/first-run-experience <repo-url> alianhub-firstrun-test
```

```bash
cd alianhub-firstrun-test && npm run setup
```

This checks Node, installs the backend, frontend and installer, builds the wizard, writes `.env`
with generated secrets and `STORAGE_TYPE="server"`, starts the server on port 4000 and opens a
browser.

**Check:** the browser lands on the installation wizard, not an error page.

---

## 2. Wizard steps 1 to 3

| Step | What to do |
|---|---|
| 1 Domain | nothing to enter |
| 2 MongoDB | paste your connection string |
| 3 Storage | leave it as it is |

**Check — step 3:** the local-disk option is already selected. You should not have to enter any
Wasabi keys to continue. *(gap 2)*

---

## 3. Wizard steps 4, 5, 6 — the skip buttons

This is the main thing being tested in the wizard.

**Check — step 4 (Firebase):** there is a **"Skip for now"** link under Submit, with a line above it
saying push notifications stay off. Click it. *(gap 2)*

**Check — step 5 (AI):** same, saying AI features stay off. Click it. *(gap 2)*

**Check — step 6 (mail):** same, and its note should say invitations and password resets cannot be
sent without mail. Click it. *(gap 2)*

You should reach step 7 (database initialisation) without having entered anything for those three.

> If a skip link does nothing, note which step. It should advance immediately with no network call.

---

## 4. Wizard step 8 — create your company

Fill in your name, email, password, company name, phone and country.

**Check:** below the address fields there is a question — **"What does your team mainly do?"** — with
six options and a note that it is optional. *(gap 6)*

**Pick "Building software"** for this run. That choice should change the sample content you get later.

Submit. Step 9 rebuilds the frontend, then **the server stops on purpose**.

---

## 5. Restart and sign in

```bash
npm start
```

Open `http://localhost:4000` and sign in with the email and password from step 8.

**Check:** you can sign in. Mail was skipped, so no verification email is involved — the first user
is created already verified.

---

## 6. The dashboard — what should be there

This is the heart of it. Before these changes the screen was blank.

**Check — a demo project exists** *(gap 3)*
- The project list shows **"Welcome to AlianHub"**
- Open it. It should hold **11 tasks**, not an empty board
- Because you chose "Building software", the first three are the product basics ("Start here…",
  "Open a task to see what it holds", "Give a task an owner") followed by eight sprint-shaped ones
  starting with "Write down everything the team might work on" *(gap 6 — this is the proof the
  answer changed something)*
- Open any task: it should have a **description** you can read, and the description should render as
  text in the editor, not as raw JSON *(gap 4)*

**Check — the getting-started checklist** *(gap 7)*
- Bottom right: a small card titled **"Getting started"** showing progress out of 5
- "Create your first project" and "Add a task to it" should already be ticked — the demo project did
  both
- The × dismisses it and it stays dismissed after a reload

**Check — the welcome tour** *(gap 8)*
- A tour should start on the projects screen. Step through it to the end
- The **last step should point at the "?" icon** in the header and talk about guides and help
- The "?" icon itself should open `help.alianhub.com` in a new tab *(gap 13)*

---

## 7. Empty screens

**Check** *(gaps 5 and 13)* — delete the demo project, or make a second empty project, then:

| Where | Should say |
|---|---|
| Project list with no projects | "No projects yet", an explanation, a **Create project** button, and a **Learn more** link |
| A new project's List view | "This project has no tasks yet" + an explanation, not "No Data Found" |
| Board view | same |
| Table view | same |

None of these five screens should say **"No Data Found"** any more.

> The Calendar and the sprint list were checked and needed no change — a calendar still draws the
> month, and a sprint always renders as a row with its own add-task line.

---

## 8. Tick the last two checklist items

**Check** *(gap 7)*
- Open **Board view** on any project → go back → the checklist's "See your tasks on the board"
  should now be ticked **without a reload**
- Open **Settings → Notifications** → go back → "Choose what you get told about" ticks too
- With all five done the card should disappear by itself

---

## 9. Settings — roles and permissions

**Check — role descriptions** *(gap 11)*
- Settings → Members → open the role dropdown in the invite bar
- Each of Guest, Owner, Admin and Member should show a grey one-line description underneath

**Check — the permission screen** *(gap 10)*
- Settings → Security & Permissions
- It should open on a **short list, not 99 rows**, with a line above the table and a link to show
  everything
- Every row should have a **plain-language sentence** under its name
- Click the link — the full list appears. Type in the search box — it should search the **full** set
  even while the short list is showing

**Check — Member has usable permissions out of the box** *(gap 1)*
- On the same screen, look down the **Member** column
- Tasks should be open (create, edit, status, assignee, comment). Settings should be off
- Before this change every one of these was blank

---

## 10. Invite someone (optional, needs mail)

Mail was skipped, so invitations cannot be sent in this run. If you want to test gap 1 properly,
re-run the install and enter real SMTP details at step 6, then invite a second person and confirm
they can create and edit tasks **without you touching the permission screen first**.

---

## 11. Gap 12 — existing companies

This one cannot be tested by a fresh install, because a fresh company already has everything.

Test it on **staging** instead, against a company that already exists:

1. Deploy the branch to staging
2. Open **Settings → Security & Permissions** for an existing company
3. Watch the server log for `reconcileCompanyRules`

**Expected:** one line saying the company is missing `task_total_estimate` and is being repaired,
then a line confirming the repair and the rule count. On a second visit, nothing — it runs once per
company per process.

**Then check nothing was lost:** a permission that company had deliberately turned **off** for a role
must still be off. That is the whole risk of this change.

---

## What to send back if something is wrong

- Which step number
- What you saw versus what this page says
- Anything in the terminal — the sample project and the reconcile both log rather than throw, so
  the server output is where a silent skip shows up

## Known and expected

- Skipping Firebase means `frontend/public/firebase-messaging-sw.js` is generated with `undefined`
  values. Harmless, and web push is off anyway — but do not be alarmed by it.
- The server stopping after step 9 is deliberate, not a crash.
