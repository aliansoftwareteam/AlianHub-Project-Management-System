# Progress: Connectors research — matrix and ranking for the new connectors and Gmail

## Checklist
- [x] Matrix rows per connector
- [x] Wispr Flow verdict
- [x] Gmail verification and CASA quotes
- [x] Ranking
- [ ] Owner review

## Last step
Matrix, ranking and Gmail section written to `056-personal-app-connectors/resources/research-matrix.md`; waiting for the owner to accept it.

## Blockers
Owner acceptance of the matrix and the order, to be recorded in 056 progress.

## Log

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track B in the two-track split; depends only on its own track and the 063 contract.
- Researched all ten connectors from provider docs and wrote the matrix.
- Ranking: ClickUp, Outlook, Notion, Figma, Supabase, Canva, HubSpot, Upwork, Shopify. Wispr Flow dropped: no API for user data.
- CASA Tier 2 published prices from TAC Security ($540–$3,600) and Leviathan Security ($3,000–$6,000), read 2026-10-28; no lab contacted yet.
- Open questions for the owner: self-hosted callback approach (own app per provider or a relay on the hosted instance), whether to ask Upwork about multi-tenant SaaS use, and whether to request written CASA quotes.

### 2026-10-29
- Moved to active. The matrix is now sections 5–8 of the shared file after task 061's sections, so the two PRs no longer write the same file twice.
- Review re-checked the sources and made these corrections:
  - Leviathan's prices are AL1; AL2 is quote-only. Tier 2 has been replaced by AL1/AL2.
  - Lab list updated from the current ADA page.
  - Figma: limits made precise; no official review timeline.
  - Notion: review gate confirmed.
  - Supabase: per-endpoint limits made precise.
  - Shopify: non-expiring-token deadline added.
  - Unconfirmed figures marked `*`: Canva token life, export limits and redirect rule; HubSpot refresh token life; Upwork daily cap.
- Acceptance criterion 3 stays open: these are published prices, not quotes, and no AL2 price is published.
