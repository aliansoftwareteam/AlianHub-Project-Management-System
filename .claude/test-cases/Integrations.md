# Integrations (Slack & Discord) — Test Cases

**Location:** Settings → Integrations → Add a webhook · **Last updated:** 2026-06-18

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Setup & Connection — Slack

| ID       | Title                                      | Precondition                          | Steps                                                                                                                                                                                 | Expected Result                                                                 | Actual Result | Status |
|----------|--------------------------------------------|---------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|---------------|--------|
| INTG_001 | Create a Slack incoming webhook (3rd-party) | A Slack workspace you can administer  | 1. Go to api.slack.com/apps → Create New App → From scratch → pick workspace  2. Features → Incoming Webhooks → toggle On  3. Add New Webhook to Workspace → choose channel → Allow  4. Copy the URL (`https://hooks.slack.com/services/…`) | A valid Slack incoming-webhook URL is obtained                                  |               | ⏳     |
| INTG_002 | Connect Slack in AlianHub                  | INTG_001 done                         | 1. Settings → Integrations → Add a webhook  2. Select the **Slack** tab  3. Enter a name, paste the webhook URL, tick events (e.g. Task created, Task updated)  4. Save               | Webhook saved + listed; a one-time signing secret is shown (only once)          |               | ⏳     |
| INTG_003 | Slack message on task creation             | Slack webhook configured (INTG_002)   | 1. Create a task in any project                                                                                                                                                       | Slack channel shows "Task created": `TaskKey — TaskName` with assignees/priority/due, within ~2 s |               | ⏳     |
| INTG_004 | Slack message on status change             | INTG_002 done                         | 1. Change a task's status                                                                                                                                                             | Slack shows "Status changed" with `old → new`                                   |               | ⏳     |

---

## Setup & Connection — Discord

| ID       | Title                                       | Precondition                             | Steps                                                                                                                            | Expected Result                                                              | Actual Result | Status |
|----------|---------------------------------------------|------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------|---------------|--------|
| INTG_005 | Create a Discord channel webhook (3rd-party) | A Discord server/channel you can manage  | 1. Discord: Server → target Channel → Edit Channel (gear) → Integrations → Webhooks → New Webhook  2. Name it, pick channel  3. Copy Webhook URL (`https://discord.com/api/webhooks/…`) | A valid Discord webhook URL is obtained                                      |               | ⏳     |
| INTG_006 | Connect Discord in AlianHub                 | INTG_005 done                            | 1. Settings → Integrations → Add a webhook  2. Select the **Discord** tab  3. Name + paste URL + select events  4. Save          | Webhook saved + listed                                                       |               | ⏳     |
| INTG_007 | Discord embed on task event                 | INTG_006 done                            | 1. Create or update a task                                                                                                       | Discord channel receives an embed (title `TaskKey — TaskName`, headline, status/priority fields) |               | ⏳     |

---

## Events, Filtering & Delivery

| ID       | Title                          | Precondition                               | Steps                                                                  | Expected Result                                                  | Actual Result | Status |
|----------|--------------------------------|--------------------------------------------|------------------------------------------------------------------------|------------------------------------------------------------------|---------------|--------|
| INTG_008 | Event filtering                | A webhook subscribed only to "Task created" | 1. Update an existing task  2. Create a new task                       | Update → no message; create → message                            |               | ⏳     |
| INTG_009 | Pause / disable a webhook      | An active webhook                          | 1. Toggle the webhook Off  2. Create a task  3. Toggle On  4. Create a task | Off → no message; On → messages resume                       |               | ⏳     |
| INTG_010 | Delivery logs                  | A webhook that has fired                   | 1. Open the webhook's delivery logs                                    | Each delivery shows status code, duration, attempt count          |               | ⏳     |
| INTG_011 | Payload is HMAC-signed         | A configured webhook + a request inspector | 1. Inspect a delivered request                                         | Request carries an `X-AlianHub-Signature` (HMAC-SHA256) header    |               | ⏳     |
| INTG_012 | Invalid URL / no events rejected | Add-webhook form open                    | 1. Try a non-HTTPS / malformed URL  2. Try saving with zero events     | Save rejected with a readable validation message                  |               | ⏳     |

---

**Total:** 12 test cases · **All status:** ⏳ Pending
