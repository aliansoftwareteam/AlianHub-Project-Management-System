# Tasks

A task is a thing one person can pick up and do. Each task has a name and
a description. Both matter — the name is how the team scans the board, the
description is the contract between you and whoever does the work.

## Granularity — one deliverable per task

A task is **one shippable unit of work** that one person owns end-to-end.
Do not bundle multiple deliverables into a single task just because they
sound related. Split aggressively along these axes:

- **One task per screen / page / view — for every team.** This is the
  most important rule. Every distinct screen is its own task, regardless
  of which team is doing the work.

  - The UI/UX designer creates one Figma task per screen: "Design Signup
    screen", "Design Login screen", "Design Dashboard screen", "Design
    Save Plan form screen", "Design Confirmation screen", etc. A single
    "Design all wireframes" task is always wrong.
  - The frontend developer creates one build task **for every screen the
    UI/UX team designed**. If UI/UX produced 7 design tasks, there must
    be 7 matching frontend build tasks. Missing a build task for a
    designed screen is always wrong — design without implementation is
    unshippable. Example: if you have "Design Signup screen" and "Design
    Login screen", you MUST also have "Build Signup screen" and "Build
    Login screen".
  - A Shopify/WordPress build gets separate tasks for every page: Home,
    About Us, Services, Contact Us, FAQ, Terms & Conditions, Privacy
    Policy, Product, Collection, Cart, Checkout — each its own task.
  - A mobile app gets one task per screen for design AND one per screen
    for implementation.

- **Always include a project scaffolding task.** Every software project
  that involves a new codebase (extension, app, backend, frontend) needs
  an explicit setup task: "Scaffold Chrome extension project (Manifest V3,
  Vite, Vue)", "Set up Node.js + Express + MongoDB backend project",
  "Bootstrap React Native project", etc. Do not assume setup is implicit
  — it is a real task that takes real time.

- **One task per API endpoint AND per HTTP method.** A "user profile" API
  becomes four tasks: `Build GET /users/:id`, `Build POST /users`,
  `Build PUT /users/:id`, `Build DELETE /users/:id`. Same rule for every
  resource — list, detail, create, update, delete are all separate tasks.
  Authentication endpoints (login, signup, logout, refresh, forgot-
  password, reset-password) are likewise separate tasks per endpoint.
  Do not skip DELETE or PUT just because they feel minor — if the resource
  supports the operation, it gets its own task.

- **One task per component, integration, migration, or distinct
  deliverable.** A payment integration is at minimum: provider setup,
  checkout flow wiring, webhook handler, refund flow, failure handling —
  each its own task. A database migration is its own task. Each reusable
  UI component (Navbar, Footer, ProductCard, …) is its own task if it
  takes meaningful work.

- **One task per CRUD operation on the frontend too.** "Build product
  listing page", "Build product create form", "Build product edit form",
  "Build product delete flow" — separate tasks, not one "product CRUD UI".

If you find yourself writing "and" or a comma in a task name to join two
deliverables, split it. The only exception is when two pieces are
genuinely inseparable in the same edit (e.g. a form and its inline
validation that lives entirely inside the same component).

This means real projects routinely have 35–80+ tasks across their sprints.
That is expected and desirable — the team would rather have many small
clear tickets than a handful of vague ones.

## Team ownership — one team per task

Tasks will be picked up by people on specific teams. Every task belongs
to exactly one of these teams:

- **Marketing** — content, SEO, ads, social media, analytics, campaign
  planning, copy writing.
- **UI/UX** — Figma, Canva, wireframing, prototyping, design systems,
  brand guidelines, responsive design specs, accessibility review.
- **Shopify/WordPress** — Shopify Liquid, Shopify 2.0 themes, custom apps,
  Polaris, WordPress theme/plugin development, WooCommerce, ACF, PHP.
- **Mobile App** — Android (Kotlin/Java), iOS (Swift/SwiftUI), React
  Native, Flutter, native APIs, push notifications, app store publishing.
- **Frontend** — Vue, Nuxt, React, Next.js, TypeScript, HTML, CSS,
  Tailwind, PHP/Laravel Blade, REST/GraphQL consumption, accessibility.
- **Backend** — Node.js, Express, NestJS, REST/GraphQL API design,
  PostgreSQL, MongoDB, Firebase, JWT/OAuth, Redis, Docker, CI/CD, cloud.

If a feature spans teams, **split it into separate tasks per team** rather
than writing one cross-team task. A "User Profile" feature becomes:
- UI/UX: "Design User Profile screen"
- Frontend: "Build User Profile screen"
- Backend: "Build GET /users/:id endpoint"
- Backend: "Build PUT /users/:id endpoint"

## Task name

A short action-oriented phrase. "Build POST /auth/login endpoint", not
"Authentication". 4-200 characters. Use the imperative voice — start with
a verb.

## Task description — the contract

A teammate who didn't sit in on the planning should be able to open a task
and start work **without asking a single clarifying question**. That is
the bar. If a mid-level engineer or designer could read the description
and still be unsure what the screen should contain, what the endpoint
should return, what "done" looks like, or which tool to use — the
description has failed.

Every description has four parts, in this order:

1. **Context** — one or two sentences explaining why this task exists and
   what it contributes to the sprint's goal. Don't restate the title.

2. **What to do** — concrete, ordered steps. Name files, components,
   APIs, libraries, tables, endpoints, payloads, request/response shapes,
   design references, screen sections, breakpoints, validation rules, and
   any other detail a teammate would otherwise have to ask about.

   - Weak: "Implement user authentication"
   - Strong: "Add POST /auth/login. bcrypt-compare the submitted password
     against `users.passwordHash`. On match, sign a 24h JWT with
     `JWT_SECRET` and return `{ token, user }`. On mismatch, return 401.
     Rate-limit to 5 attempts/IP/min with express-rate-limit."

   - Weak: "Design dashboard screen"
   - Strong: "Design the Bliss Balance dashboard screen at 360×600 (Chrome
     extension popup). Sections from top: app header with logo + settings
     icon; large 'Bliss Balance' amount with masked account label; active
     purchase card showing product image, name, target date, countdown
     chip, and 'View' button; empty state when no active purchase."

3. **Acceptance criteria** — observable outcomes that let someone verify
   the task is done. Cover the happy path, main error paths, and any
   non-functional requirements (responsive, accessible, performant).

4. **Depends on** — only if this task can't start until another task
   finishes. Reference the other task by name. Omit entirely when there
   is no dependency.

**Self-check before emitting the task:** could a brand-new team member,
with no other context than this description, sit down and finish the
work? If the answer is "they'd need to ask about X" — put X in the
description.

## Bundling anti-patterns — exactly what NOT to do

**Design screen bundling** (most common UI/UX mistake):
- ❌ "Design extension user flows and wireframes" (all screens in one)
  ✅ "Design Signup screen"
  ✅ "Design Login screen"
  ✅ "Design Dashboard screen"
  ✅ "Design Save Plan form screen"
  ✅ "Design Confirmation screen"
  ✅ … one task per screen
- ❌ "Design save plan form and confirmation screens"
  ✅ Task 1: "Design Save Plan form screen"
  ✅ Task 2: "Design Confirmation screen"

**API bundling:**
- ❌ "Implement POST /api/signup and POST /api/login (JWT)"
  ✅ Task 1: "Build POST /auth/signup endpoint"
  ✅ Task 2: "Build POST /auth/login endpoint"
- ❌ "Implement backend Plaid link token and exchange endpoints"
  ✅ Task 1: "Build POST /plaid/link-token endpoint"
  ✅ Task 2: "Build POST /plaid/exchange-token endpoint"

**Frontend screen bundling:**
- ❌ "Build Saved Plans list UI with countdown and Complete Purchase button"
  ✅ Task 1: "Build Saved Purchase detail screen with countdown"
  ✅ Task 2: "Build Complete Purchase redirect handler"

**Redundant planning / documentation tasks:**
- ❌ "Define backend API endpoints and data models" — this is a
  documentation task that lists what the individual endpoint tasks already
  cover. Do not add a planning layer on top of the real tasks. The
  individual "Build GET /…" and "Build POST /…" tasks ARE the plan.
- ❌ "Create API contract document" as a task — the endpoint tasks
  themselves contain the contract in their descriptions.

**QA bundling:**
- ❌ "Conduct end-to-end QA on extension and backend"
  ✅ Task 1: "QA Chrome extension — full user flow" (Frontend team)
  ✅ Task 2: "QA backend API endpoints" (Backend team)
  ✅ Task 3: "End-to-end smoke test against demo scenario" (cross-team)

**The trigger words.** If a task name contains any of these, it is almost
certainly bundled — split it before emitting:
`and`, `&`, `with` (joining two UI features), `+`, `also`, `,` (comma
separating two deliverables).

The only exception: a single endpoint path naturally contains `/` (e.g.
`POST /auth/signup`) — that is fine.

## Task count floor

Before emitting, count your tasks. If the count is below the floor for
the project type, you are bundling — go back and split.

| Project type | Expected task count |
|---|---|
| Small internal tool, script, or widget | 10 – 20 tasks |
| MVP (Chrome extension, mobile app, SaaS) | 35 – 55 tasks |
| Full product with multiple user roles and integrations | 55 – 80 tasks |

A project with onboarding screens + an external integration (Plaid,
Stripe, Firebase) + multiple extension/app screens + a REST API should
produce **at least 40 tasks**.

**Before emitting, run this checklist:**
1. Count design tasks — does every screen in the product have its own
   design task? (If UI/UX has fewer tasks than the number of screens,
   you are bundling.)
2. Count build tasks — does every designed screen have a matching
   frontend build task? (A designed screen with no build task is an
   automatic error.)
3. Count API tasks — does every HTTP method on every resource have its
   own task? (Missing PUT or DELETE on a resource is a common skip.)
4. Is there a scaffolding task for every new codebase? (Extension setup,
   backend setup, etc.)
5. Are QA tasks split by team (frontend QA separate from backend QA)?

If any answer is "no", fix it before emitting. Do not emit until the
count is right and the checklist passes.

## Calibrate detail to task complexity

Match description length to what the task actually needs.

- **Simple tasks** ("Submit show to Apple Podcasts", "Add favicon"):
  context paragraph + 2-3 steps + 2-3 acceptance criteria is plenty.
- **Normal tasks** (most tasks in a real project): 3-5 steps + 3-4 criteria.
- **Complex tasks** (architecture, multi-system features): 5-7 steps + 4-5
  criteria. Past 7 steps, split the task instead.

## The Editor.js block format

The description goes in `descriptionBlocks` as Editor.js blocks. Use these
block types exactly — do not invent new ones:

- `{ "type": "paragraph", "data": { "text": "<text>" } }`
- `{ "type": "header", "data": { "text": "<text>", "level": 4 } }` (use level 4 only)
- `{ "type": "list", "data": { "style": "ordered", "items": ["<item>", "<item>"] } }`
- `{ "type": "list", "data": { "style": "unordered", "items": ["<item>", "<item>"] } }`

The skeleton for every task description, in this order:

1. One `paragraph` block — the context.
2. One `header` block with text `"What to do"`.
3. One `list` block (`ordered`) — the steps.
4. One `header` block with text `"Acceptance criteria"`.
5. One `list` block (`unordered`) — the criteria.
6. Optionally one more `paragraph` block starting with `"Depends on: "` — only if there's a real dependency.

You may include more paragraphs inside the "What to do" section if the
steps need extra explanation, but do not skip any of the five required
blocks or change their order.

## Priority

Each task has a `priority` of `Low`, `Medium`, `High`, or `Urgent`.
Choose deliberately — don't default everything to `Medium`.

- **Urgent** — blockers, security/critical bugs, things that must happen first
- **High** — work that's on the critical path for the sprint's goal
- **Medium** — normal work
- **Low** — polish, optional extras, nice-to-haves

In a typical project, most tasks are Medium, with a handful of High and
Low. Urgent is rare. If everything is Urgent, nothing is.
