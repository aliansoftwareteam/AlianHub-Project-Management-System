# 036 progress

- [x] 1 Command palette (feat/command-palette-parity)
- [ ] 3 Task detail navigation and quick actions
- [ ] 5 Self-hosted AI endpoints
- [x] 2 Inbox snooze and cleared (PR pending review)

## Log
- 2026-09-24: owner chose items 1, 3, 5 and 2 from the ClickUp comparison; four slices started in parallel.
- 2026-09-24: slice 2 built on `feat/inbox-snooze-cleared`. Snooze is stored on the notification (per reader on a mention) and returns as unread when due, checked on each Inbox read; "until it changes" returns on the next notice about the same task. Cleared rows are purged 30 days after clearing (TTL on `notifications.clearedAt`; a mention gets `purgeAt` once its last reader clears it). Other = updates stamped `reason: 'watching'` at send time: a task update where the reader is not the creator, an assignee or mentioned, or a project update where they are not a lead or mentioned; mentions, reminders, chat, agent notices and rows sent before this change stay in Primary. Browser-stored Later entries move to a server snooze until tomorrow 9:00 on first load.
- 2026-09-24: slice 1 built: Cmd+K on macOS and Ctrl+K elsewhere, no plan gate, type chips, location and age, row actions (open, new tab, copy link, Ask AI), recently opened tasks, dialog/listbox semantics and axe check; search rows unchanged in who sees them.
