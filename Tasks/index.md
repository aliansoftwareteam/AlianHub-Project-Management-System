# Task Index

Auto-maintained registry of all tasks. Reflects YAML frontmatter from each `task.md`.

| ID  | Title | Status | Priority | Depends on | Path |
|-----|-------|--------|----------|------------|------|
| 001 | Fix task-type settings UI (overlap, sticky add, sidebar audit) | done | medium | — | done/001-task-type-settings-ui |
| 002 | Make the task-type migration production-ready | done | high | — | done/002-task-type-migration-prod |
| 003 | Show library task-type icons in the time tracker | done | medium | — | done/003-tracker-task-type-icons |
| 004 | Reusable template-selection form component (task types + statuses) | done | medium | — | done/004-reusable-template-select-form |
| 005 | Automation engine foundation (phase 0) | done | high | — | done/005-automation-engine-foundation |
| 005 | First-run experience — close the 13 gaps | done | high | — | done/005-first-run-experience |
| 006 | AI agent engine foundation + QA agent | active | medium | 005 | active/006-agent-engine-foundation |
| 006 | AI-native Pages space and distinctive shell | done | high | — | done/006-ai-native-pages-shell |
| 007 | Automation sentence builder UI + v2 rule API | done | high | 005 | done/007-automation-builder-ui |
| 006 | Remove auto-assignee from task creation | done | medium | — | done/006-remove-task-auto-assignee |
| 007 | Fix "Invalid URL" on member invitation links | done | high | — | done/007-fix-invite-link-invalid-url |
| 008 | Redesign stage 1 — tokens, login/auth, global rail shell, Home, task detail panel | done | high | — | done/008-shell-redesign-stage1 |
| 009 | Redesign stages 2–3 — first run and daily work in the new shell | done | high | 008 | done/009-redesign-daily-work |
| 010 | Redesign stage 4 — auditable AI agent system | done | high | 009 | done/010-redesign-ai-system |
| 011 | Redesign stage 5 — money & scale | done | medium | 009 | done/011-redesign-money-scale |
| 012 | Run the rest of the redesign from inside AlianHub (dogfood) | done | high | 009 | done/012-dogfood-in-alianhub |
| 013 | Make AlianHub easy to maintain (admins, teams, developers) | active | high | — | active/013-maintainable-system |
| 014 | AI hub full test and fixes | done | high | 006, 010 | done/014-ai-hub-sweep |
| 015 | Guided project start — complete brief, agent/human split | active | high | 014 | active/015-guided-project-brief |
| 016 | Agent trust layer — risk-rated actions, policy L2, whole-run revert, budgets | done | high | 014 | done/016-agent-trust-layer |
| 017 | Agent memory the product owns | done | high | 015, 016 | done/017-agent-memory |
| 018 | Sprint 10 — external agents: OAuth, scopes, delegation | active | medium | 028, 031 | active/018-agent-interop |
| 019 | Sprint 9 — evals and routing measurement | backlog | medium | 026, 027, 030 | backlog/019-agent-evals-observability |
| 020 | Automation comments show as Ghost User | done | medium | — | done/020-automation-comment-author |
| 021 | Maintainability leftovers verified 2026-09-10 | done | medium | — | done/021-maintainability-leftovers |
| 022 | Pieces worth porting from the closed pre-redesign PRs | backlog | low | — | backlog/022-salvage-from-closed-prs |
| 023 | Sprint 0 — stop the bleeding: exploitable findings and cost correctness | done | high | — | done/023-sprint-0-stop-the-bleeding |
| 024 | Sprint 1 — shared AI core and run correctness | done | high | 023 | done/024-sprint-1-shared-core-run-correctness |
| 025 | Sprint 2 — agent revisions and the skill record | done | high | 024 | done/025-sprint-2-revisions-and-skill-record |
| 026 | Sprint 3 — observability foundation | done | high | 024 | done/026-sprint-3-observability-foundation |
| 027 | Sprint 4 — the model router | done | high | 024, 026 | done/027-sprint-4-model-router |
| 028 | Sprint 5 — the workflow engine | done | high | 024, 027 | done/028-sprint-5-workflow-engine |
| 029 | Sprint 6 — skill authoring and migration | done | medium | 025, 028 | done/029-sprint-6-skill-authoring-migration |
| 030 | Sprint 7 — knowledge and retrieval | active | medium | 024 | active/030-sprint-7-knowledge-and-retrieval |
| 031 | Sprint 8 — security hardening | active | high | 024 | active/031-sprint-8-security-hardening |
| 032 | Sprint 11 — data skills reach outside (ADR 003 phase 4) | active | medium | 029, 031 | active/032-sprint-11-data-skills-reach |
| 033 | Beta build version and log — every merge is a numbered build | active | high | — | active/033-beta-build-version-and-log |
| 034 | End-to-end QA programme — sweep every function, keep it covered in CI | active | high | — | active/034-end-to-end-qa-programme |
| 035 | QA follow-ups — fix what the QA fix PRs left out | done | high | 034 | done/035-qa-followups |
| 036 | ClickUp parity: command palette, task navigation, self-hosted AI, inbox snooze | done | — | — | done/036-clickup-parity |
| 037 | UX flow fixes from the ClickUp flow comparison | done | — | — | done/037-ux-flow-fixes |
| 038 | Edit tasks from List rows | done | — | — | done/038-list-inline-edit |
| 039 | Make the shared DropDown keyboard and screen-reader accessible | active | medium | — | active/039-accessible-dropdown |
| 040 | Store each reference id in one form, with a migration | active | medium | — | active/040-one-stored-form-per-id |
| 041 | AI UX fixes from the ClickUp AI comparison | active | high | 034 | active/041-ai-ux-fixes |
| 042 | Non-AI UX fixes from the ClickUp comparison | active | high | 034 | active/042-non-ai-ux-fixes |
| 043 | Advanced AI from a hands-on look at ClickUp Brain² | active | high | 041 | active/043-advanced-ai |
| 044 | Quick gaps from the ClickUp re-check | active | high | — | active/044-clickup-quick-gaps |
| 045 | Medium gaps from the ClickUp re-check | active | high | 044 | active/045-clickup-medium-gaps |
| 046 | The plan to be great next to ClickUp | active | high | 045 | active/046-better-than-clickup |
| 047 | AI-run — a teammate that already knows the software | active | high | 046 | active/047-ai-run |
| 048 | Team agent packs — role agents per team, workflows, a dispatcher and company blueprints | active | medium | 047 | active/048-team-agent-packs |
| 051 | Demo login — fill in the demo account and add a one-click "Try the demo" button | done | medium | — | done/051-demo-login-prefill |
| 052 | Industry demo experience — one demo company per industry, built from shared scenario data | done | high | — | done/052-industry-demo-experience |
| 053 | Industry demos — the dispatcher, the Company view and workflow runs | done | high | 052 | done/053-industry-demo-agentic-layers |
| 054 | Industry demos for every blueprint, named by industry | done | high | 053 | done/054-industry-demos-every-blueprint |
| 055 | Create Project modal — Member, Skills, Source and Due date pickers open above the modal | active | high | — | active/055-create-project-field-popovers |
| 056 | Personal app connectors for AI and agents — one reusable module, then connectors one by one | backlog | high | 061–079 | backlog/056-personal-app-connectors |
| 057 | Projects settings — Open, Archived and Closed tabs; every undo returns the exact previous state | active | high | — | active/057-project-lifecycle-tabs |
| 058 | Tracker timesheet — every screenshot card shows its image box and a loading state from the first paint | active | medium | — | active/058-tracker-screenshot-loading-placeholder |
| 059 | Agent settings page — tabs, a searchable project picker and one sticky Save bar | active | high | — | active/059-agent-settings-tabs |
| 060 | AI access by role — per-role AI rights in Security & Permissions, owner/admin approval for agents and skills | active | high | — | active/060-ai-access-by-role |
| 061 | Connectors research — confirm Google and Dropbox before the build | active | high | — | active/061-connectors-research-pilot-providers |
| 062 | Connectors research — matrix and ranking for the new connectors and Gmail | active | medium | — | active/062-connectors-research-new-providers |
| 063 | Connectors — the two-track contract, provider definition format, registry and the Google provider file | active | high | — | active/063-connectors-provider-definition |
| 064 | Connectors — data model: evolve connector_connections, add connector_apps and connector_usage | active | high | 063 | active/064-connectors-data-model |
| 065 | Connectors — OAuth app lookup (instance default, company override) and the secrets-store guard | backlog | high | 063, 064 | backlog/065-connectors-oauth-apps-secrets-guard |
| 066 | Connectors — generic connect, products, reconnect and disconnect handlers | backlog | high | 065 | backlog/066-connectors-connect-lifecycle |
| 067 | Connectors — end a member's connections on removal, deactivation or SCIM, plus a daily sweep | backlog | high | 066 | backlog/067-connectors-member-removal-sweep |
| 068 | Connectors — tool framework: one definition registered for agents and MCP | active | high | 063 | active/068-connectors-tool-framework |
| 069 | Connectors — every outside write is a proposal only the connection owner approves | active | high | 068 | active/069-connectors-write-approvals |
| 070 | Connectors — audit, health, usage counts, quotas and provider backoff | active | high | 063, 068 | active/070-connectors-tracking-quotas |
| 071 | Connectors — Google pilot tools: Calendar, Meet and Drive (no Gmail) | backlog | high | 068, 069 | backlog/071-connectors-google-pilot-tools |
| 072 | Connectors — My connections, admin overview and company apps screens | backlog | high | 066 | backlog/072-connectors-connection-screens |
| 073 | Connectors — migrate Google Calendar connections onto the Google provider | backlog | medium | 064, 066 | backlog/073-connectors-migrate-google-calendar |
| 074 | Connectors — Slack as a personal OAuth provider; retire the workspace bot | backlog | medium | 069, 070, 078 | backlog/074-connectors-slack-personal |
| 075 | Connectors — GitHub as a personal, on-demand provider; retire the task 049 sync | backlog | medium | 069, 070, 078 | backlog/075-connectors-github-personal |
| 076 | Connectors — Drive/Dropbox attachment picker on the module | backlog | medium | 066, 072 | backlog/076-connectors-attachment-picker |
| 077 | Connectors — remove the old Google Calendar and CloudStorage paths; Google and Dropbox setup pages | backlog | medium | 073, 076 | backlog/077-connectors-remove-calendar-picker-paths |
| 078 | Connectors — Inbox approval cards and quota settings screens | backlog | high | 069, 070 | backlog/078-connectors-approval-quota-screens |
| 079 | Connectors — remove the old Slack bot and GitHub sync paths | backlog | medium | 074, 075 | backlog/079-connectors-remove-slack-github-paths |
