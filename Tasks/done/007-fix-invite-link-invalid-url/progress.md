# Progress: Fix "Invalid URL" on member invitation links

## Checklist
- [x] Fix link builders in sendInvitation.js
- [x] Add small regression check
- [x] Verify new-user path

## Last step
Done.

## Blockers
None.

## Log

### 2026-10-06
- Task created. Root cause identified: stray `)}` appended to link in 3 places.
- Completed. Replaced the 4 duplicated link builders with buildVerifyInvitationLink (no stray ")}"). Added tests/invitation-link.test.js (passes). Brand-new-user link (/invitation?companyId=...) is a different format and was never affected.
