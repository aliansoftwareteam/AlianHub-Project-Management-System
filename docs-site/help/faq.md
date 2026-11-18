# Frequently asked questions

Short answers to the questions people ask most, with a link to the full page for each. Can't find yours? Try the search box, [Troubleshooting](./troubleshooting), or [Getting help](./support).

## About AlianHub

### What is AlianHub?

AlianHub is open-source project management software that you run on your own server. It brings tasks, sprints, boards, Gantt charts, docs, chat, automations, time tracking with weekly timesheets, and AI into one workspace. Teams use it instead of tools like Jira, ClickUp, Asana or Monday.com. See [What is AlianHub?](/getting-started/).

### What is it built with?

The app you use in the browser is built with Vue. The server runs on Node.js with Express, stores data in MongoDB, and uses Socket.io so changes appear for everyone at once. Files are kept on the server's disk or in S3-compatible storage. The desktop time tracker is built with Electron. Developers can read the [Architecture](/developer/architecture).

### Is it free? What is the licence?

Yes. AlianHub is free and open source under the GNU Affero General Public License v3 (AGPL-3.0). You can use it, change it and host it yourself, with no per-seat pricing. If you run a modified version as a public online service, you must publish your changes under the same licence. Running a changed copy privately inside your company does not require that.

Some hosted AlianHub services sell plans, and some features (such as the desktop tracker) can depend on the plan. For other licence terms, or paid help with hosting and support, email [support@aliansoftware.net](mailto:support@aliansoftware.net).

### Is there a demo?

Yes, at [demo.alianhub.com](https://demo.alianhub.com). The log-in page has a **Try the demo** button. The demo holds made-up companies for several industries, and its data can be reset at any time, so do not keep real work there.

### Can I host it myself?

Yes. That is what AlianHub is for. The simplest way is Docker. You need a server, a MongoDB database, and somewhere to keep files. See [Requirements](/admin/requirements) and [Install with Docker](/admin/install-docker).

### Where is my company's data stored?

On the server where your AlianHub runs, not with us. Tasks, comments and settings go in its MongoDB database. Files go on the server's disk or in the S3-compatible storage your admin chose. Every record belongs to one company, so companies on the same server cannot see each other's data. See [File storage](/admin/storage) and [Backup and restore](/admin/backups).

### Is there a mobile app or a desktop app?

AlianHub runs in any modern browser, and its screens adapt to a phone. There is no separate phone app. For computers, there is the [desktop time tracker](/user-guide/time-tracker-app) for Windows, macOS and Linux, which records time and screenshots.

### Which languages does it speak?

Fourteen: English, Arabic, Chinese, French, German, Greek, Gujarati, Hindi, Italian, Japanese, Korean, Portuguese (Brazil), Russian and Spanish. Each person picks their own in **My settings**. An admin sets the workspace default in **Language & Region**.

### What does the AI see, and where does my data go?

Ask AlianHub and agents see only what the person using them can open. To answer, AlianHub sends the question and the relevant text to the AI model your server is set up with. If that model runs on your own server, nothing leaves it. If it is a hosted AI service, that service receives the text. AI can be switched off for the whole server or for one workspace, and then nothing is sent. See [Ask AlianHub](/user-guide/ai-ask#privacy-and-permissions) and [What it sees](/ai/what-it-sees).

### Can I bring my own AI app, like Claude or ChatGPT?

Yes. Connect it once and it can find, add and update work for you, with your permissions. Changes a project wants checked wait for your approval. See [Connect your AI app](/ai/connect).

### How do email notifications work?

Each person chooses which events email them in **Settings**, **Notifications**. Email is off by default; tick the **Email** column for the events you want. Your server must have outgoing mail set up. See [Notifications](/user-guide/notifications).

## Account and people

### How do I add a new company?

Each company is a separate workspace. To start one, choose **Create a new workspace** on the log-in page. You can belong to several and switch between them from the workspace menu at the top of the left bar, or in **Settings**, **Company**.

### How do I add staff?

Owners and admins open **Settings**, then **Members**, and invite people by email with a role. You can also share an invite link: anyone with it joins with the role on the invite. See [People and roles](/user-guide/people-and-roles).

### How do I remove a member?

In **Settings**, **Members**, find the person and choose **Remove**. Removed people are listed on the **Removed** tab. See [People and roles](/user-guide/people-and-roles).

### How do I change a member's role?

In **Settings**, **Members**, choose **Change role** on the person and pick the new role. The four built-in roles are Owner, Admin, Member and Guest. See [People and roles](/user-guide/people-and-roles).

### How do I edit my personal details?

Open **Settings**, then **My settings**. Change your photo, name, language, time zone and working hours, then select **Save changes**. Your job title is set by an admin. See [Your settings](/user-guide/settings).

### How do I change or reset my password?

To change it, open **Settings**, **Sign-in & security**, and change your password there. If you forgot it, select **Forgot password?** on the log-in page and follow the emailed link. You can also turn on two-factor authentication on the same settings page.

### How do I upgrade my plan?

On a server that sells plans, the workspace owner opens **Settings**, then **Billing** (or **Plan & usage** on a hosted service). On your own server, there is no plan to buy; the person who runs it decides what is switched on.

## Projects

### How do I create a project?

Open **Projects** in the left bar and select **New project** (on **Home**, **Create a project** does the same). Give it a name and a key, choose who can see it and the apps it needs, and create it. See [Projects](/user-guide/projects).

### How do I edit a project's name?

Open the project, select the three dots beside its name, and choose **Rename**. You need permission to edit the project's details. See [Projects](/user-guide/projects).

### Can I change a project's key?

No. You choose the key when you create the project, and every task key is built from it (such as `WEB-42`), so it cannot be changed afterwards. It must be unique in the workspace.

### How do I close or reopen a project?

Open the project's menu (the three dots) and choose **Close project**, then type **close** to confirm. The project moves to the **Closed** tab of the projects list and its open tasks are closed. To bring it back, choose **Reopen Project** on it in the **Closed** tab: the project and the tasks the close moved go back to how they were. An owner or admin can also have inactive projects closed automatically. See [Projects](/user-guide/projects#close-reopen-archive-restore-and-delete).

### How do I make a project private?

When you create the project, set **Visibility** to **Only people I add**. To change it later, use **Share With** in **Settings**, then **Projects**. A private project is visible only to the people and teams added to it, and to roles allowed to see private projects. See [Projects](/user-guide/projects#private-projects).

### How do I set what members can do in a project?

Roles set what each person can do across the workspace, in **Settings**, **Security & permissions**. On plans that include it, a project can also have its own permissions. See [People and roles](/user-guide/people-and-roles).

### How do I remove a view from a project?

Open the menu on the view's tab and choose **Delete View**, then select **Delete**. This removes the view, not the tasks in it. A shared view is deleted for everyone, and a project's last view cannot be deleted. See [Views, filters and saved views](/user-guide/views/).

### How do I create a sprint?

Any list can run as a sprint. Open the list's menu, choose **Make it a sprint**, and give it a start date, an end date and a goal. Then use **Start sprint** when the work begins. See [Folders, lists and sprints](/user-guide/lists-and-sprints).

### Where do I find files shared in a project?

Open the project's **Files & Links** panel. It gathers the files and links attached across the project. Audio recordings have their own panel. Files shared in chat are under **Files** in the channel's **Channel details**.

## Views

### What is List view?

List view shows tasks as rows grouped by status, list or another field, with columns you choose. It is the quickest view for scanning and editing many tasks. See [List](/user-guide/views/list).

### What is Calendar view?

Calendar view shows a month with each task on its dates. A task with a start and a due date is a bar across those days. Approved time off also shows there. See [Calendar](/user-guide/views/calendar).

### What is an embed view?

An embed view shows another website, such as a design file or a spreadsheet, as a tab inside your project. See [Embed and other views](/user-guide/views/embed).

## Tasks and time

### How do I create a task?

Select the create button at the top of the left bar, or add a row in any view, type a name and press Enter. You can also make a task from a chat message, an email (Email to Task) or an Ask AlianHub answer. See [Tasks](/user-guide/tasks).

### How do I add a checklist?

Open the task and select **Checklist** in its quick actions. Add the steps, and tick them off as you go. **Suggest Checklists** asks AI to propose items. See [Tasks](/user-guide/tasks#checklists).

### What are estimated hours?

The time you expect a task to take. Set it in the task's **Estimated** field. AlianHub compares it with the time logged: on the task (such as "3h of 5h"), in the **Variance Report**, and on dashboards. The desktop tracker can be limited to it. See [Tasks](/user-guide/tasks#dates-and-estimates).

### How do I record hours on a task?

Open the task, find **Time**, and either select **Start timer** or **Add time** to enter hours by hand. You can also use **Log time** on your timesheet. Then submit your week for approval. See [Time and timesheets](/user-guide/time).

### Where can I see someone's workload?

Use the **Workload** view in a project, or the workload screen under **Time** if your role has it. Both show each person's assigned work against their capacity. See [Workload](/user-guide/views/workload).

### What is the workload report?

The workload screen under **Time** shows how busy each person is across projects, after time off. **Capacity Planning** (under **More**, **Reports**) looks further ahead. See [Reports and dashboards](/user-guide/reports#timesheet-reports).

### What is the milestone report?

**Milestone Report** (under **More**, **Reports**) lists milestones across projects, with their dates and whether they are on time, slipped or signed off. See [Reports and dashboards](/user-guide/reports#milestone-report).

## Chat

### Can I send audio messages in chat?

Yes. In the message box, choose **Voice note** and record up to 5 minutes, then stop and select **Send**. You can also record a short video with **Clip**. In a direct message you can start an audio or video call. See [Chat and the Inbox](/user-guide/chat-and-inbox).

## Related

- [Troubleshooting](./troubleshooting)
- [Getting help](./support)
- [Quick tour](/getting-started/quick-tour)
