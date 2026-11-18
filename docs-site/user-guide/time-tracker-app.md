# Desktop time tracker

AlianHub Tracker is a small app for your computer. You pick a task and press start. While it runs, it records the time you work on that task and takes a screenshot of your screen now and then. When you stop, the time lands on your AlianHub timesheet, next to the time you log in the browser.

Use it when your team wants proof of work alongside the hours, for example for client billing. If you only need to log hours, the timer in the browser is enough. See [Time and timesheets](./time).

The tracker runs on Windows, macOS and Linux.

## Before you start

- **Your plan must include the tracker.** It is an add-on. If it is not in your plan, the tracker says "Time tracking isn't part of this workspace's plan." Ask an owner or admin.
- **You must be allowed to use it.** An owner or admin decides who may use the tracker. Plans can limit how many people use it. Without permission, the tracker says "You don't have permission to use tracker. Please contact your administrator."
- **Your server must offer a download.** Settings shows "No desktop tracker download is available on this server yet." when it does not. On a self-hosted server, the person who runs it builds or publishes the tracker. See the [Admin guide](/admin/).

## Install it

1. In AlianHub, open **Settings**, then **Time Tracking**.
2. Under **Desktop time tracker**, select **Download for** your system (Windows, macOS or Linux). The version number is shown beside it.
3. Run the installer.
4. Back in AlianHub, under **Installed it?**, select **Open in tracker**. The tracker opens and connects to your workspace.

If nothing happens, install the tracker first, then try again.

On macOS, the first start asks for screen recording permission. Allow it in System Settings, under Privacy & Security, Screen Recording. Without it, the tracker cannot take screenshots.

## Connect and sign in

If you opened the tracker yourself, it asks you to **Connect to your workspace**.

1. Type your **Workspace address**. On a hosted workspace, the short name is enough. "Self-hosted? Enter the full address." It must start with https://.
2. The tracker opens your browser on an **Authorize the desktop tracker** page. Select **Continue**.
3. The browser hands you back to the tracker, signed in.

You can connect more than one workspace. Use the workspace switcher to move between them. Switching workspace stops the running timer.

## Track time

1. In the tracker, pick a project, then a task. **Today's Tasks** lists what you can track.
2. Add a short comment about what you are doing.
3. Select **Start Tracker**.
4. Work as normal. The tracker shows the time running and the **Latest Screen Capture**.
5. When you are done, stop the tracker. The session is saved.

You can also start from AlianHub in the browser. Open a task and choose **Start Tracker** (or **Open in desktop tracker**). Answer "What are you working on?" and select **Start tracking**. The desktop tracker starts on that task.

The tracker also shows **Today's Total Logged hours** and **Today's Total Estimated hours**. To record time you did not track, use **Add Manual Time**.

### When a task has an estimate

Your workspace may limit the tracker to a task's estimated hours. This is the **Limit tracker to estimated hours** setting, and it is on unless an owner or admin turns it off. When it is on:

| The task | What happens |
|---|---|
| Has no estimate | The tracker will not start: "Add estimated hours to start the tracker" |
| Has time left on its estimate | The tracker starts, and stops by itself when the estimate is used up |
| Has used up its estimate | The tracker will not start |

## What it records

| What | How |
|---|---|
| Time | From start to stop, against the task you picked |
| Screenshots | One picture of your screen at a random moment every 5 to 9 minutes, only while the tracker is running. A small preview pops up each time so you know |
| Activity | For each second, whether you were using the mouse or the keyboard. It does not record which keys you press or what you type |
| Comment | The comment you typed when you started |

If there has been no mouse or keyboard input for 5 minutes, the tracker shows "No activity detected". It keeps running; stop it yourself if you stepped away.

If your internet drops, the tracker says "Internet connection lost but we are still tracking your data". It keeps recording and sends everything once you are back online.

## How entries reach your timesheet

- While the tracker runs, the task shows "Running in the desktop tracker".
- When you stop, the entry appears on your weekly timesheet and on the task, marked as "From the desktop tracker" with a monitor icon.
- It counts toward your week like any other time, and is submitted and approved with it. See [Approvals](./approvals).
- A tracker entry cannot be edited or deleted in the browser.
- The **Tracker** screen under **Time** shows the recordings, with their screenshots, for people allowed to see them.

## Privacy

- **Screenshots are taken only while the tracker is running.** Stop it, and nothing is captured.
- **Only your main screen is captured**, at a reduced size.
- **Keystrokes are not recorded.** The tracker only notes whether there was keyboard or mouse activity.
- **Who sees your screenshots** depends on roles. The **Tracker** screen can be set to "Own" (people see only their own recordings) or to everyone. Owners and admins can see all recordings.
- **How long screenshots are kept** is set by an owner or admin. With **Auto-delete old screenshots** on, screenshots older than the chosen number of months are deleted every night.
- **Screenshots are stored on your company's server**, or in the storage it uses, not by a third party you did not choose.

## Settings, updates and signing out

Open the tracker's settings to see your name, switch between companies in the workspace, and **Logout**. The version number is shown at the bottom.

The tracker updates itself. To check by hand, select **Check for updates** on the connect screen. If no update is found, download the latest tracker from **Settings**, **Time Tracking**.

The tracker also has an icon in your system tray. Its menu has **Show App** to bring the window back, and **Quit**.

## Troubleshooting

| Problem | What to do |
|---|---|
| "Time tracking isn't part of this workspace's plan." | Ask an owner or admin to add the tracker to the plan. |
| "You don't have permission to use tracker." | Ask an owner or admin to let you use the tracker. |
| "Use an address that starts with https://." | Type the full https address of your workspace. |
| **Open in tracker** does nothing | Install the tracker, or update it, then try again. |
| No screenshots on macOS | Allow screen recording for AlianHub Tracker in System Settings, then restart it. |
| "Add estimated hours to start the tracker" | Add an estimate on the task, or ask an admin about the estimate limit. |
| Time missing after being offline | Keep the tracker open and online until it has synced. |

## Related

- [Time and timesheets](./time)
- [Approvals](./approvals)
- [Reports and dashboards](./reports)
- [Admin guide](/admin/)
