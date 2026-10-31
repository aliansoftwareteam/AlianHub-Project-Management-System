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
| 056 | Personal app connectors for AI and agents — one reusable module, then connectors one by one | backlog | high | — | backlog/056-personal-app-connectors |
| 057 | Projects settings — Open, Archived and Closed tabs; every undo returns the exact previous state | active | high | — | active/057-project-lifecycle-tabs |
| 058 | Tracker timesheet — every screenshot card shows its image box and a loading state from the first paint | active | medium | — | active/058-tracker-screenshot-loading-placeholder |
| 059 | Agent settings page — tabs, a searchable project picker and one sticky Save bar | active | high | — | active/059-agent-settings-tabs |
| 060 | AlianHub Cloud — sell and run hosted AlianHub instances (programme) | active | high | — | active/060-alianhub-cloud-programme |
| 061 | Managed mode — platform-owned settings and a customer-safe Instance console | active | high | 060 | active/061-managed-mode-settings |
| 062 | Platform API — headless provisioning, config push, entitlements, usage and lifecycle | active | high | 060, 061 | active/062-platform-api |
| 063 | Shared S3 storage — one driver for Spaces/Wasabi/S3, a prefix per instance, hot key reload, usage counter | active | high | 060, 061 | active/063-s3-prefix-storage |
| 064 | Plan entitlements — limits enforced on the server, read-only and suspended states, Plan & usage page | active | high | 060, 061, 062, 063 | active/064-plan-entitlements |
| 065 | Hosting-ready image and compose template — many customers per server, one command up | active | high | 060, 061, 062 | active/065-managed-docker-stack |
| 066 | Time tracker add-on — one signed build that connects to any workspace | active | medium | 060, 064 | active/066-tracker-any-workspace |
| 067 | Cloud portal — sign-up, plans, subdomain, checkout and the customer dashboard | active | high | 060, 062, 064, 068, 069 | active/067-cloud-portal |
| 068 | Cloud billing — subscriptions, add-ons, dunning, tax and the revenue ledger | backlog | high | 060 | backlog/068-cloud-billing |
| 069 | Provisioning orchestrator and host agent — paid to live in three minutes, and every change after | active | high | 060, 062, 065, 070 | active/069-provisioning-orchestrator |
| 070 | Hosting infrastructure on DigitalOcean — account, hosts, network, edge, TLS, registry, storage, mail | active | high | 060, 065 | active/070-hosting-infrastructure |
| 071 | Fleet operations — staged upgrades, nightly backups, restore, monitoring and on-call | active | high | 060, 065, 069, 070 | active/071-fleet-operations |
| 072 | Cloud back office — the staff console at ops.alianhub.com | active | high | 060, 067, 068, 069 | active/072-cloud-back-office |
| 073 | Cloud launch readiness — legal, emails, support, security review, beta and go/no-go | backlog | high | 060, 067, 068, 069, 070, 071, 072 | backlog/073-cloud-launch-readiness |
| 074 | Local Docker host — real AlianHub Cloud instances on a developer PC | active | high | 062, 063, 064, 065, 067, 072 | active/074-local-docker-host |
| 075 | Instance settings an owner can fill in — no env names, grouped, with setup steps | active | high | 067 | active/075-instance-settings-for-owners |
| 080 | AlianHub Cloud back office — simpler Catalog editor with a customer-view preview | done | high | — | done/080-cloud-catalog-editor-preview |
| 081 | Cloud plans choose their server — shared or dedicated, units and droplet size | active | high | 069, 070, 072 | active/081-cloud-plan-server-type |
| 082 | Cloud orchestrator hardening — no droplet left billing, safer deletes and hosts, approvals that stay visible | backlog | high | 069, 070, 072 | backlog/082-cloud-orchestrator-hardening |
