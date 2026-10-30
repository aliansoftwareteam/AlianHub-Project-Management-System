# Progress: Connectors research — confirm Google and Dropbox before the build

## Checklist
- [x] Google Calendar, Meet, Drive
- [x] Dropbox
- [x] Self-hosted app review
- [x] Write the matrix rows and PRD contradictions
- [ ] Owner reviews the 5 contradictions in the matrix and decides

## Last step
Wrote `backlog/056-personal-app-connectors/resources/research-matrix.md`: Google and Dropbox rows, self-hosted review, 5 PRD contradictions with recommendations, sources dated 2026-10-28.

## Blockers
- The sensitivity tier of the three Calendar scopes is not in Google's docs; someone with Google Cloud Console access must read it from the Data Access page (contradiction 2).

## Log

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track A in the two-track split; depends only on its own track and the 063 contract.
- Moved to active. Every fact in the matrix cites its page, checked 2026-10-28; secondary sources are marked.
- Main findings for the owner: Meet scopes are sensitive and recordings need restricted scopes; the Dropbox picker today is the Chooser, with no token to revoke; the company app form needs the Picker's API key and project number.

### 2026-10-29
- Review re-checked every source. Corrected: sensitive-scope verification takes up to 10 days, not 3–5 (new source S22); recordings name only `drive.readonly`; the yearly assessment applies when restricted data is stored or sent server-side; Dropbox scopes and `include_granted_scopes=user` cite the official S17; Dropbox access types; Gmail password-change case and Calendar daily billing threshold added. Still unconfirmed: Dropbox's 4 h access-token life (secondary only).
