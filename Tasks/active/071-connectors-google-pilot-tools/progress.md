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
- Noted for 078: card text ("Starts", "Attendees") is English from the server; only the tool label goes through `$t`.

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track B in the two-track split; depends only on its own track and the 063 contract.
