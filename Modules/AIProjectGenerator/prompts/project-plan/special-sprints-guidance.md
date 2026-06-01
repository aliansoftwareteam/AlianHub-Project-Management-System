# Conditional sprint and task additions

Three additions conditionally extend every plan. Evaluate the project
description, additional requirements, and any uploaded brief together.
When a condition is ambiguous, default to including the addition rather
than skipping it. Never generate placeholder or empty sprints — if none
of the conditions are met for a given addition, omit it entirely.

---

## Addition 1 — GitHub & Version Control Setup sprint

**Include when:** the project involves source code, a repository, or more
than one developer contributing to the same codebase.

**Do NOT include when:** the project has no code at all — a pure content
series, a marketing campaign, a research study, a sales pipeline, or any
project where no code repository is needed.

**Position:** the very FIRST sprint in the plan — before all design,
feature, and module sprints. Developers must have version control before
they touch any code.

**Sprint name:** `"GitHub & Version Control Setup"`

**Generate one task per item below.** Each task must be step-by-step
enough that a developer who has never used GitHub can follow it
end-to-end without asking anyone:

1. **Create GitHub account and organization**

   Check whether a GitHub account already exists for the project owner; if not, create one at github.com using a professional username tied to the company or team. Once the account exists, navigate to the top-right avatar menu → "Your organizations" → "New organization" and choose the Free plan. Name the organization after the project or company (kebab-case). Add the team billing email. Invite known team members by GitHub username or email from the organization's "People" tab and assign roles: Owner for leads, Member for contributors.

   Acceptance: the organization is accessible at `github.com/<org-name>` and all founding members appear under the People tab.

2. **Create repository and configure access**

   Inside the organization, click "New repository". Set the repository name in kebab-case matching the project (e.g. `my-project-backend`, `my-project-frontend`). Choose visibility — Private for client or proprietary work, Public for open-source. Initialize with a README.md, a `.gitignore` matched to the project's primary language or framework, and an appropriate license (MIT for open-source; omit the license file for private work). Under repository Settings → Collaborators and teams, add each team member with the correct role: Admin for leads, Write for contributors, Read for stakeholders.

   Acceptance: every team member can clone the repository; the repository contains a README, a `.gitignore`, and the correct collaborator list.

3. **Set up SSH key or HTTPS authentication on local machine**

   Choose one authentication method for the whole team and document it in the README.

   SSH (recommended): run `ssh-keygen -t ed25519 -C "your@email.com"` in the terminal. Copy the contents of `~/.ssh/id_ed25519.pub`. Go to GitHub → Settings → SSH and GPG keys → New SSH key → paste the public key. Test the connection with `ssh -T git@github.com` — a successful response reads "Hi <username>! You've successfully authenticated." Clone the repository using the SSH URL: `git clone git@github.com:<org>/<repo>.git`.

   HTTPS alternative: install Git Credential Manager. Clone using the HTTPS URL; authenticate via the browser pop-up on the first push. The credential manager caches the token so subsequent operations do not prompt.

   Acceptance: `git pull` and `git push` succeed on the developer's machine without prompting for credentials.

4. **Define and document the branching strategy**

   Agree on the branching model before any code is committed. Use the following hierarchy:
   - `main` — always production-ready; no direct commits allowed.
   - `dev` (or `develop`) — integration branch; all feature branches merge here first.
   - `feature/<short-description>` — one branch per feature or task (e.g. `feature/user-auth`, `feature/payment-flow`).
   - `hotfix/<description>` — emergency fixes branched directly from `main` and merged back to both `main` and `dev`.

   Create the `main` and `dev` branches in the remote repository. Commit a `BRANCHING.md` file (or a "Branching strategy" section in README.md) describing the model, naming rules, and lifecycle of each branch type.

   Acceptance: `main` and `dev` exist in the remote; the branching document is merged to `dev`; every team member confirms they have read it.

5. **Write commit message conventions**

   Adopt the Conventional Commits format for all commits: `<type>(<scope>): <short summary>`.

   Types: `feat` (new feature), `fix` (bug fix), `docs` (documentation only), `chore` (tooling, dependencies, config), `refactor` (internal restructure with no behavior change), `test` (adding or updating tests), `style` (formatting, missing semicolons — no logic change).

   Rules: summary line must be 72 characters or fewer; use the imperative mood ("add", not "added" or "adds"); no period at the end of the summary line; add a body paragraph (separated by a blank line) when the change needs context.

   Example shape → `feat(auth): add JWT refresh token endpoint` (do not copy verbatim — shape only).

   Commit this convention as `COMMIT_CONVENTION.md` in the repository root or in a `docs/` folder.

   Acceptance: `COMMIT_CONVENTION.md` is merged to `dev`; at least one example commit in the repository follows the format.

6. **Write PR and code review conventions**

   Create a `PR_GUIDE.md` file and commit it to `dev`. The guide must cover:
   - PR title follows the Conventional Commits format (same as commit messages).
   - PR description must include: what changed and why, how to test the change, and any screenshots or API response samples when the change affects UI or API output.
   - Minimum one approval required before merge; the author may not approve their own PR.
   - Reviewers must respond within one business day.
   - The PR author resolves all review comments before requesting re-review.
   - Merge strategy: squash-merge feature branches into `dev`; merge-commit or rebase hotfixes into `main`.

   Acceptance: `PR_GUIDE.md` is accessible in the repository and every team member confirms they have read it.

7. **Configure branch protection rules and required reviewers**

   In GitHub, go to repository Settings → Branches → Add rule. Create a rule targeting the branch name `main` with the following options enabled:
   - Require a pull request before merging.
   - Require approvals — set to 1 (increase to 2 for teams of 5 or more).
   - Dismiss stale pull request approvals when new commits are pushed.
   - Require status checks to pass before merging (activate this once CI is configured).
   - Include administrators — enabled so leads cannot bypass the rules.

   Repeat the rule for `dev` with at least 1 required reviewer.

   Acceptance: attempting a direct push to `main` or `dev` is rejected by GitHub; opening a PR on either branch shows the required-reviewer badge.

8. **Version control per release: tagging, changelogs, and release branches**

   Adopt semantic versioning for all releases: `vMAJOR.MINOR.PATCH`.
   - MAJOR — a breaking change incompatible with the previous version.
   - MINOR — a new backward-compatible feature.
   - PATCH — a backward-compatible bug fix.

   Create a `CHANGELOG.md` in the repository root following the Keep a Changelog format. Start with an `## [Unreleased]` section. Before each release, move unreleased entries under a new version heading with the release date.

   Example shape → `## [1.0.0] - 2025-06-01` followed by `### Added`, `### Fixed`, `### Changed` subsections (do not copy verbatim — shape only).

   Release process: merge `dev` → `main`; create and push a Git tag (`git tag v1.0.0 && git push origin v1.0.0`); create a GitHub Release from the tag and paste the relevant CHANGELOG section as the release notes.

   Acceptance: `CHANGELOG.md` exists in `main`; at least one annotated tag (even `v0.1.0` for the initial project setup) is visible under repository Releases.

---

## Addition 2 — Environment & Tech-Stack Setup sprint

**Include when:** any item in the project's tech stack requires local or
server-side environment setup — databases, backend frameworks, cloud
services, container runtimes, cloud storage, ORMs with migrations,
message brokers, caching layers, or similar infrastructure.

**Do NOT include when:** the project has no tech items that require
installation or configuration — e.g. a pure branding / copywriting /
marketing deliverable with no code and no design tool. Skip individual
tasks for items that genuinely need no setup: plain HTML files, CSS
files, vanilla JavaScript snippets. Design platforms (Figma, Penpot,
Adobe XD, Framer, etc.) DO qualify — see the "Design platform setup"
sub-section below.

**Position:** a sprint titled `"Environment & Tech-Stack Setup"`, placed
AFTER the GitHub sprint (if present) and BEFORE all feature-development
sprints.

**One task per qualifying tech-stack item.** A "qualifying item" is any
technology a developer must install, configure, and verify before they
can build against it. For each qualifying item the task covers:

- Required tools and software to install (CLI, GUI client, SDK, runtime) — name every tool explicitly.
- Installation steps, with OS-specific notes when steps differ meaningfully between platforms.
- How to create the server, instance, project, database, bucket, or cluster for this project.
- Connection and verification steps: run a sample query, ping the endpoint, view the tables, call a test API, or read a test record — something that produces visible confirmation the setup succeeded.
- A brief note (one or two sentences) on how this technology fits into the overall project.

**Detail level:** a developer must be able to stand up the environment by
following the task alone, without consulting external documentation.

Example task shape for PostgreSQL (do not copy verbatim — shape only):

→ Install PostgreSQL server and the pgAdmin desktop client. Open pgAdmin, register a new Server connection (host: localhost, port: 5432, username: postgres). Create the project database by right-clicking Databases → Create. Open the Query Tool and run `SELECT 1;` to verify the connection returns a result. Create the initial schema tables and view them in the Object Explorer. PostgreSQL is the primary relational store for all user and business data in this project.

Example task shape for AWS S3 (do not copy verbatim — shape only):

→ Install the AWS CLI and run `aws configure` with the project IAM access key, secret, and region. In the AWS Console, navigate to S3 and create a new bucket named after the project. Set the region to match the application's hosting region. Enable "Block all public access" unless the bucket serves public assets. Upload a test file via the CLI (`aws s3 cp test.txt s3://<bucket-name>/`) and list the bucket to confirm the upload succeeded. S3 is used in this project for storing user-uploaded files and media assets.

### Design platform setup (one task, always include when the project has UI/UX work)

When the project involves screen design, wireframing, or prototyping,
generate exactly one task for the chosen design platform. Check the
clarifications for the user's answer to the design platform question;
if unanswered, default to Figma.

The task title follows the pattern: `"<Platform Name> Design Environment Setup"`.

**For Figma** (most common — apply these instructions when Figma is chosen or defaulted):

The task covers:
1. Create a Figma account at figma.com (or sign in with Google/SSO). Choose the free Starter plan for solo work; upgrade to Professional for teams needing shared libraries.
2. Create a new Figma Organization (for teams) or a personal workspace. Inside it, create a Team for this project and invite all design contributors.
3. Create the main design file for the project. Set up pages: one per major section (e.g. "Components", "Screens — Auth", "Screens — Dashboard", "Prototype flows"). Name frames after the screen they represent.
4. Install key community plugins relevant to the project type (e.g. Unsplash for stock photos, Iconify for icons, Figma Tokens for design tokens, Stark for accessibility checks). Access via Main Menu → Plugins → Browse plugins.
5. Set up the **Figma MCP server** to connect Figma to AI assistants (Claude, Cursor, Windsurf, etc.):
   - In Figma, go to Help & account → Account settings → Personal access tokens → Generate token (scope: File content — read).
   - Install the Figma MCP server: `npx figma-mcp-server` (requires Node.js 18+).
   - Add the server to your AI assistant's MCP config: `{ "figma": { "command": "npx", "args": ["figma-mcp-server"], "env": { "FIGMA_ACCESS_TOKEN": "<your-token>" } } }`.
   - Restart the AI assistant. The assistant can now read frame names, component properties, colors, and layout from any Figma file you share by URL.
   - **Benefits:** The developer can ask the AI assistant to inspect a Figma frame and generate matching component code. Designers can ask the AI to audit their file for accessibility issues or missing responsive variants. Speeds up design-to-code handoff significantly.
6. Share the design file with the development team in "View" mode so developers can inspect measurements, export assets, and copy CSS values directly from Figma's Inspect panel.

**For Penpot** (open-source):

The task covers: go to penpot.app and create a free account (or self-host following docs.penpot.app/technical-guide/); create a team project and invite collaborators; explain that Penpot uses SVG natively (assets export as clean SVG); note it has no MCP integration yet but the inspect panel exports CSS and SVG for handoff.

**For Adobe XD**:

The task covers: install Adobe XD from the Creative Cloud desktop app; create a new project from the XD home screen; share the prototype link with the team via Share → Invite to edit; highlight the Co-editing feature for simultaneous collaboration; note that XD Design Specs generate a shareable link developers can use to inspect measurements and export assets.

**For Framer**:

The task covers: create a Framer account at framer.com; create a new project (Framer projects are code-based React components under the hood); explain that Framer blurs the line between design and production — components built here can be exported as React code; set up a custom domain under Site settings if the project will publish directly from Framer.

**For Sketch** (macOS only):

The task covers: install Sketch from sketch.com (paid licence); create a new document and configure Artboards per screen; share via Sketch Cloud for team access and developer handoff via the Sketch Inspect panel.

**For Balsamiq**:

The task covers: create a Balsamiq Cloud account at balsamiq.cloud; create a project; explain that Balsamiq produces intentionally low-fidelity wireframes to focus feedback on layout and flow, not visual polish; note that Balsamiq is typically a first-pass tool before moving to Figma or Adobe XD for high-fidelity work.

**For Miro**:

The task covers: create a Miro account at miro.com; create a board for the project; use it for user-flow diagrams, information architecture mapping, and early brainstorming; note that Miro is a whiteboarding tool, not a production-design tool — the team should migrate final screens to Figma or another high-fidelity tool before development.

---

## Addition 3 — Test Case Guidelines sprint

**Include when:** the project has module-wise development — two or more
distinct functional modules, screens, or features that each need
independent verification (authentication, dashboard, payments, admin
panel, notifications, API endpoints, etc.).

**Do NOT include when:** the project is trivial (fewer than ~10 tasks
total), purely operational or content-based (podcast episode tasks,
marketing post publishing), or has no discrete testable modules.

**Position:** AFTER any setup sprints (GitHub + Tech-Stack), BEFORE the
first feature-development sprint.

**Sprint name:** `"Test Case Guidelines"`

**Generate one task per item below.** Descriptions must be educational
but immediately actionable — a developer new to writing test cases should
be able to start writing them after reading the task:

1. **What test cases are and why they matter for this project**

   Explain in plain language: a test case is a documented check that verifies one specific behavior of the application works as expected. It is a written record — not a live script — of what a tester did, what they expected, and what actually happened.

   Explain three core benefits:
   - Regression prevention — if a future code change breaks a previously working feature, the failing test case surfaces the problem before it reaches users.
   - Communication of expected behavior — test cases tell new developers and QA testers what "correct" looks like for each feature, without needing to read source code.
   - QA progress tracking — a list of test cases with statuses shows exactly how much of the product has been verified at any moment.

   Tie it directly to this project: name 2–3 modules from the actual plan (use the sprint names), and describe concretely what could go wrong without test cases for those modules.

   Example shape → "Without test cases for the Payments module, a change to the checkout flow could silently break payment confirmation emails and no one would know until a customer reported it." (do not copy verbatim — shape only).

2. **How to write a test case**

   Define the required fields for every test case:
   - **ID** — a unique identifier using a module prefix and a sequential number (e.g. `AUTH-001`, `DASH-003`, `PAY-012`).
   - **Title** — one sentence describing what specific behavior is being tested (e.g. "Login with valid credentials returns a JWT token and redirects to the dashboard").
   - **Precondition** — what must be true before the test begins (e.g. "A user account exists with email test@example.com and password Test@123; the server is running on localhost:3000").
   - **Steps** — numbered actions the tester takes, one action per step, written precisely enough that two different testers would follow the same path.
   - **Expected Result** — what the system should do if it is working correctly; written before the test is run.
   - **Actual Result** — what the system actually did; filled in during testing; left blank until the test is executed.
   - **Status** — one of: `Pending` (not yet run), `Pass` (actual matched expected), `Fail` (actual did not match expected), `Blocked` (cannot be run due to an unresolved dependency or environment issue), `Flaky` (passes sometimes and fails other times; needs investigation).

   Walk through one complete example test case for a real feature in this specific project — use an actual module from the plan, not a generic placeholder. Show all seven fields filled in.

3. **Module-wise test case structure for this project**

   List every module in this plan, derived from the sprint names and feature areas. For each module, describe the categories of test cases it requires:
   - Happy path — the main flow works when all inputs are valid and the user follows the intended sequence.
   - Error cases — the system handles invalid inputs, unauthorized access attempts, missing required fields, and network failures gracefully.
   - Edge cases — boundary conditions such as empty states, maximum-length inputs, duplicate submissions, and concurrent actions by multiple users.

   Recommend a grouping structure: one markdown table or section per module, with columns for ID, Title, Precondition, Steps, Expected Result, Actual Result, and Status. Each module's section should be set up before that module enters development — not after — so QA can run cases as soon as the feature is built.

4. **How to use test cases to track feature and functionality flow**

   Explain the QA execution cycle:
   - When a tester runs a case, they fill in the Actual Result field with exactly what happened — include error messages, HTTP response codes, screenshots, or response payloads when relevant.
   - They then set Status to Pass, Fail, Blocked, or Flaky based on comparing Expected Result to Actual Result.
   - A test case Status must never remain Pending after it has been executed.

   Explain how failing test cases link to bug tasks:
   - Every test case with Status = Fail must have a corresponding bug task created in the project board.
   - Name the bug task to reference the test case ID (e.g. "Bug: AUTH-003 — Login with expired token returns 200 instead of 401").
   - The bug task stays open until the fix is deployed and the test case is re-run and set to Pass.

   Explain the definition of Done for a module:
   - A module is Done when every test case in its section has Status = Pass.
   - If any cases are Blocked, the blocking issue must be resolved and those cases re-run before Done is declared.
   - A module with Flaky test cases is not Done — flaky behavior indicates an intermittent defect that must be investigated and resolved.
