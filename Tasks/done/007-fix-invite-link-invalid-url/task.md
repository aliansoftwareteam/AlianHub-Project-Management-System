---
id: 007
title: Fix "Invalid URL" on member invitation links
status: done
priority: high
depends_on: []
created: 2026-10-06
---

# Fix "Invalid URL" on member invitation links

## Goal
Invitation emails open a working accept-invite page for a re-invited (removed) user and for a user who is new to the company but already has an account.

## Scope
- `Modules/Auth/controller/sendInvitation.js` — link construction for the `/verify-invitation?id=<base64>` flow.
- Confirm the brand-new-user flow (`/invitation?companyId=...`) is unaffected.

## Out of scope
- Invitation expiry window, token format, frontend invitation pages.

## Acceptance criteria
- [x] Re-invite of a removed user produces a link whose `id` is clean base64 that `parseInviteBlob` accepts.
- [x] Single invite of an existing-account user (new to the company) produces a clean link.
- [x] Bulk import path unchanged and still correct.
- [x] Brand-new (no account) user link verified unaffected.
- [x] A regression check fails if a link carries stray characters.

## Constraints & notes
- Root cause: three of four link builders append a stray `)}` after the base64 string (lines 265, 438, 480); `parseInviteBlob`'s strict BASE64_RE rejects it, so checkPermission returns "Invalid URL.".
