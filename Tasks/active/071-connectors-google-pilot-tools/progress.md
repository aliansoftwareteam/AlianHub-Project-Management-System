# Progress: Connectors — Google pilot tools: Calendar, Meet and Drive (no Gmail)

## Checklist
- [x] Fake Google server (`tests/fixtures/fakeGoogleApi.js`; `fakeGoogle.js` stays the OAuth fake)
- [x] Calendar tools
- [x] Meet tools
- [x] Drive tools

## Last step
All nine tools in `providers/google/tools.js`, tested from an agent run and MCP against the fake server. Not yet run against a real Google account: that needs 065 and 066.

## Blockers
None for this task. A real Google call waits on track A's 066 (`resolveConnection` is still the stub), and picked Drive files on 076.

## Log

### 2026-10-31
- Built on the 070 branch, because the runner this task uses changes there.
- Decided: Drive is read only, because the task names no Drive write and `drive.file` reads are all the pilot needs.
- Decided: tool keys follow the contract's `google.calendar.events.list`. The 068 key check allowed only three parts, so it now also accepts a product part.
- Decided: a read now fails on a provider status outside 2xx, as a write already did, so the model never gets an error page as the person's data. The runner holds this, so 074 and 075 get it too.
- Decided: `notifyAttendees` defaults to no, and the card says whether Google emails the attendees.
- Decided: Meet has one read tool, `spaces.get`. Google has no call to list spaces, and meeting records are left out because 061 keeps the pilot to meeting spaces.
- Checked the requests against Google's official reference pages for Calendar events list, insert and patch, Meet spaces get and create, and Drive files list and export, and their scopes. They match. Not yet run against a real account. Two fixes came out of it: Meet access means joining without knocking, so the wording changed; and a Sheet exports its first tab only, so `files.read` says so.
- Known limits, to see on a real account: a Drive file over the runner's 512 KB response cap fails the read rather than being cut; a PATCH that turns a timed event into an all-day one may be refused by Google, since it would keep the old `dateTime`.
- Card wording goes through i18n: a card may hold `targetLabel` and `rows` of `{ label, value | valueLabel }`, with `Connectors.card.*` keys, and `text` holds only what the person's event says. 078 renders them with `$t`.
- Left for Hetvi: the Google definition asks for `calendar.app.created`, which no tool here uses. PRD section 10 asks for least scopes, and the definition is track A's file, so keeping or dropping it is track A's call.

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track B in the two-track split; depends only on its own track and the 063 contract.
