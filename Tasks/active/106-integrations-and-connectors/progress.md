# Progress: Integrations and Connectors — two places, each saying what it holds

## Checklist
- [x] App connections content as a section of the Integrations page
- [x] Left-bar entry removed; `/app-connections` and the GitHub sign-in return lead to that section
- [x] Project GitHub card's "Set up" link updated
- [x] Pointer line on each page
- [x] Card copy for GitHub, Slack and Google on both pages
- [x] i18n, style and specs
- [ ] Browser check of both pages on a running instance

## Last step
Built and committed on feat/connectors-mcp-transport; the browser check on a running instance is still to do.

## Blockers
None.

## Log

### 2026-11-13
- Task created from PRD v2.1 of 056 (decisions 30–32), after the owner reviewed the two pages together: keep the GitHub sync as an integration, and keep two places, Integrations and Connectors.

### 2026-11-13 — built
- The GitHub sync is a **GitHub** section of the Integrations page (`IntegrationsHub.vue`), showing `AppConnections.vue` with a new `only` prop limited to GitHub: one-click sign-in or the setup steps, repositories per project, pause, disconnect, last sync and errors, the egress notice. GitHub is left out of the Marketplace, so it is connected in one place.
- The rest of the old page was already on the Integrations page: the Marketplace lists the same catalogue (GitLab, Teams, Zapier and the others) with connect and disconnect, and Slack, the calendar feed and app panels have their own sections. Only GitHub moved.
- The section opens from `?section=github` and from a GitHub sign-in coming back (`?github=…`). `/:cid/app-connections` redirects there with its query kept (101's redirect to Connectors removed), and the server now sends a sign-in without a project back to `/:cid/integrations?section=github`.
- The left-bar entry is gone, from Full and from Simple (Simple now shows five places). The project GitHub card's "Set up" opens the section.
- Pointer lines: Integrations says it runs on its own and brings work in, and points to Connectors while the server has connectors; Connectors points to Integrations for workspace-wide apps. GitHub, Slack and Google catalog lines on Connectors now start "Your own …, for AI"; the Integrations GitHub section says it is for the whole workspace and points to the personal connector.
- Strings: `AppConnections.nav`, `title` and `lead` removed; `AppConnections.off` and `ProjectGithub.set_up` reworded; `IntegrationsHub.lead`, `lead_connectors`, `github*` and `Connectors.screen.integrations_*` added. `APP_CONNECTIONS` and `GITHUB_CONNECT_CLIENT_ID` descriptions and the MCP guide name the Integrations page.
- Tests: new `integrationsHubGithub.spec.js` (5); `appConnectionsPage.spec.js` (the `only` prop instead of the route title), `customizePage.spec.js` (the redirect and the sign-in return), `simpleModeRail.spec.js` (no App connections place), `connectorsScreen.spec.js` (the pointer), and the two backend GitHub return tests. 11 frontend spec files and the 3 GitHub sync suites pass; conventions pass apart from the known CRLF check; i18n and style checks pass.
- Also committed here, from the review on 2026-11-12: the Customize tab bar no longer shrinks to 4 px (`flex: none`), and Outlook has its catalog line and the Communication category.
