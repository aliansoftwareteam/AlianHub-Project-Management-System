# Few-shot examples

These examples show the correct *shape*, *voice*, and *depth* of a good
clarify response. They are not templates — the questions you ask for a new
brief will be specific to that brief. What transfers across all examples:

- **All 8 mandatory categories are covered**: `platform`, `features`,
  `tech_stack`, `integrations`, `audience`, `timeline`, `budget`,
  `compliance`. Every single example below touches all 8.
- **Consultative `hint` on every question** — one sentence of earned
  expertise: trade-off, common pick, or a risk flag.
- **Friendly question text, even when options are technical.**
- **Named products in options** when the project domain has obvious
  choices (Stripe, Razorpay, Veo 3, Next.js, Supabase, etc.).
- **"Confirm and refine"** when the brief already specifies an answer —
  the stated answer becomes `recommended`, the user accepts in one click.

---

## Example 1 — Non-technical client, vague brief

**Brief:** "I want an app for my restaurant where customers can order food
and pay."

**Literacy signal:** Non-technical. Frame everything in business language;
push the technical content into `hint`.

```json
{
  "understanding": "A customer-facing ordering app for a single restaurant with built-in payment. Sounds like a takeaway/delivery flow rather than table-side.",
  "questions": [
    {
      "id": "platform-surface",
      "category": "platform",
      "question": "Where will customers actually place orders?",
      "rationale": "Drives whether we build a mobile-friendly website, a mobile app, or both.",
      "required": true,
      "type": "segmented",
      "options": [
        { "value": "web",    "label": "Mobile-friendly website" },
        { "value": "mobile", "label": "Mobile app (iOS + Android)" },
        { "value": "both",   "label": "Both" }
      ],
      "recommended": "web",
      "hint": "Most small restaurants start with a mobile-friendly website — faster to launch, no app-store approval, and the link works in any text or email."
    },
    {
      "id": "order-type",
      "category": "features",
      "question": "Which kinds of orders should the app support?",
      "rationale": "Pickup, delivery, and dine-in each need different flows and ship as separate features.",
      "required": true,
      "type": "toggle_chips",
      "options": [
        { "value": "pickup",   "label": "Pickup" },
        { "value": "delivery", "label": "Delivery" },
        { "value": "dinein",   "label": "Dine-in / table-side" }
      ],
      "recommended": ["pickup"],
      "hint": "Starting with pickup only is the fastest path to live — delivery adds drivers, zones, and tipping flows you can layer in later."
    },
    {
      "id": "stack-preference",
      "category": "tech_stack",
      "question": "Do you have a preference for what we build it with?",
      "rationale": "If you have an existing team or vendor, we should match their stack so handoff is easy.",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "decide-for-me", "label": "No preference — pick what's best",     "description": "We'll choose modern, well-supported tools that are easy to hire for." },
        { "value": "wordpress",     "label": "WordPress / WooCommerce",               "description": "Good if you already run a WordPress site you want to extend." },
        { "value": "shopify",       "label": "Shopify with a food add-on",            "description": "Fast to launch, but limited customization." },
        { "value": "custom",        "label": "Custom-built (Next.js + Supabase)",     "description": "Most flexibility, owns the code, easiest to grow." }
      ],
      "recommended": "decide-for-me",
      "hint": "Most restaurants don't need to make this decision — we'll pick a custom build on Next.js + Supabase, which is fast to launch and easy to grow."
    },
    {
      "id": "payment-provider",
      "category": "integrations",
      "question": "Which payment provider would you like to use?",
      "rationale": "Provider choice shapes the checkout build, onboarding requirements, and per-order fees.",
      "required": true,
      "type": "select_card",
      "options": [
        { "value": "stripe",   "label": "Stripe",        "description": "Most popular globally; supports Apple Pay and Google Pay out of the box." },
        { "value": "square",   "label": "Square",        "description": "Best if you already use Square for in-store payments." },
        { "value": "razorpay", "label": "Razorpay",      "description": "Best for India — supports UPI, cards, and net banking." },
        { "value": "later",    "label": "Decide later",  "description": "We'll pick one during the build." }
      ],
      "recommended": "stripe",
      "hint": "If you don't already have a payment provider, Stripe is the safest default — it works in most countries and integrates with everything."
    },
    {
      "id": "audience-scale",
      "category": "audience",
      "question": "Roughly how many customers do you expect in the first 6 months?",
      "rationale": "Scale assumptions drive hosting tier, image/menu CDN setup, and whether we plan for high-traffic surges (e.g. lunch rush).",
      "required": false,
      "type": "preset_chips",
      "options": [
        { "value": "small",  "label": "Up to 100 customers/week" },
        { "value": "medium", "label": "100–1,000 customers/week" },
        { "value": "large",  "label": "1,000+ customers/week" },
        { "value": "custom", "label": "Custom" }
      ],
      "recommended": "small",
      "hint": "Most single-location restaurants start in the small range. Even small-tier hosting handles 1,000 orders/week with room to spare."
    },
    {
      "id": "launch-target",
      "category": "timeline",
      "question": "When would you like to go live?",
      "rationale": "Tight timelines force scope cuts; more time lets us add polish like loyalty programs and analytics.",
      "required": false,
      "type": "preset_chips",
      "options": [
        { "value": "2w",     "label": "2 weeks" },
        { "value": "1m",     "label": "1 month" },
        { "value": "2m",     "label": "2 months" },
        { "value": "3m",     "label": "3 months or more" },
        { "value": "custom", "label": "Custom" }
      ],
      "recommended": "1m",
      "hint": "1 month is realistic for a pickup-only website with Stripe; add roughly a month per additional order type."
    },
    {
      "id": "budget-tier",
      "category": "budget",
      "question": "What's your rough monthly budget for hosting and payment fees?",
      "rationale": "Budget tier picks the hosting plan, the payment-fee structure, and whether premium features (SMS notifications, branded emails) are in or out.",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "lean",     "label": "Lean (≤ $50/month)",        "description": "Hobby-tier hosting, Stripe pay-as-you-go fees only. No SMS, no premium add-ons." },
        { "value": "standard", "label": "Standard ($50–200/month)",  "description": "Production hosting, transactional email, SMS for order confirmations." },
        { "value": "growth",   "label": "Growth ($200–500/month)",    "description": "Dedicated hosting tier, full transactional + marketing email, branded SMS, analytics tooling." }
      ],
      "recommended": "standard",
      "hint": "Standard is the typical tier for a single restaurant — covers hosting, transactional SMS, and a basic email tool with room to grow."
    },
    {
      "id": "compliance-region",
      "category": "compliance",
      "question": "Which country (or countries) will customers be ordering from?",
      "rationale": "Region drives PCI rules (handled by the payment provider), data-residency requirements, and consumer-protection disclosures.",
      "required": true,
      "type": "select_card",
      "options": [
        { "value": "us",     "label": "United States",                "description": "PCI via Stripe; minimal extra compliance work." },
        { "value": "eu-uk",  "label": "EU / UK",                       "description": "Adds GDPR (cookie banner, data-deletion flow) and clear refund policy." },
        { "value": "india",  "label": "India",                         "description": "Razorpay handles PCI; add GST-compliant invoicing." },
        { "value": "multi",  "label": "Multiple regions",              "description": "We'll plan for the strictest applicable rules (usually GDPR)." }
      ],
      "recommended": "us",
      "hint": "Most non-technical clients don't realize EU/UK customers trigger GDPR — that's a separate sprint (cookie banner, data-deletion request flow, privacy policy)."
    }
  ]
}
```

---

## Example 2 — Technical client, specific brief

**Brief:** "Build a B2B SaaS for invoice management. Multi-tenant, role-based
access, Stripe Connect for marketplace splits, audit log, SOC 2 ready.
Node/Mongo backend, React frontend. 3-person team, 12-week target."

**Literacy signal:** Highly technical. Many fields are already pinned —
frame those as "confirm and refine" with the stated answer as `recommended`.

```json
{
  "understanding": "A multi-tenant B2B invoicing SaaS with Stripe Connect marketplace splits, RBAC, SOC 2 audit-logging, Node/Mongo backend, React frontend. Stack and team are decided; 12-week target.",
  "questions": [
    {
      "id": "platform-surface",
      "category": "platform",
      "question": "Which surfaces should customers access — web only, or also mobile?",
      "rationale": "B2B invoicing is mostly desktop work; mobile is rare in v1 but sometimes asked for approvals on the go.",
      "required": false,
      "type": "segmented",
      "options": [
        { "value": "web",         "label": "Web only" },
        { "value": "web-mobile",  "label": "Web + mobile companion" }
      ],
      "recommended": "web",
      "hint": "B2B invoicing is desktop-first 99% of the time; a mobile companion for approvals can land in v2."
    },
    {
      "id": "v1-feature-set",
      "category": "features",
      "question": "Which feature areas are in v1, and which are explicitly v2?",
      "rationale": "Locking the v1 boundary up front prevents week-8 scope creep on a 12-week budget.",
      "required": true,
      "type": "toggle_chips",
      "options": [
        { "value": "invoice-crud",   "label": "Invoice create / send / pay" },
        { "value": "stripe-splits",  "label": "Stripe Connect splits" },
        { "value": "audit-log",      "label": "Audit log (SOC 2)" },
        { "value": "rbac",           "label": "Role-based access (RBAC)" },
        { "value": "reporting",      "label": "Reports / BI dashboards" },
        { "value": "integrations",   "label": "3rd-party integrations (QuickBooks, Xero)" },
        { "value": "i18n",           "label": "Multi-language / currency" }
      ],
      "recommended": ["invoice-crud", "stripe-splits", "audit-log", "rbac"],
      "hint": "The brief mentions the first 4 as core. Reporting, accounting-tool integrations, and i18n are typical v2 candidates for a 12-week MVP."
    },
    {
      "id": "tenant-isolation",
      "category": "tech_stack",
      "question": "How tightly do tenants need to be isolated at the data layer?",
      "rationale": "Schema-per-tenant changes the data model, migration strategy, and backup story significantly.",
      "required": true,
      "type": "select_card",
      "options": [
        { "value": "row",    "label": "Row-level (tenantId on every doc)",       "description": "Single Mongo DB with tenantId fields. Simplest; SOC 2-friendly with audit log." },
        { "value": "db",     "label": "Database-per-tenant",                     "description": "Stronger isolation; harder migrations. Justified at enterprise scale." },
        { "value": "hybrid", "label": "Hybrid (shared default, dedicated for big tenants)", "description": "Row-level by default; promote enterprise customers to dedicated DBs later." }
      ],
      "recommended": "row",
      "hint": "Row-level with strict access checks ships inside 12 weeks and satisfies SOC 2. Go hybrid only if you already have enterprise leads."
    },
    {
      "id": "stripe-connect-flow",
      "category": "integrations",
      "question": "Which Stripe Connect account type matches your payout flow?",
      "rationale": "Standard, Express, and Custom each change onboarding UX and the work needed for KYC handoff.",
      "required": true,
      "type": "select_card",
      "options": [
        { "value": "standard", "label": "Standard",  "description": "User onboards directly with Stripe via redirect. Fastest to ship." },
        { "value": "express",  "label": "Express",   "description": "Stripe-hosted onboarding inside your branding. Middle ground." },
        { "value": "custom",   "label": "Custom",    "description": "You own the full onboarding UX and KYC handoff. Most engineering work." }
      ],
      "recommended": "express",
      "hint": "Express is the typical B2B SaaS choice — branded onboarding without owning KYC compliance, which matters for a 12-week window."
    },
    {
      "id": "auth-provider",
      "category": "integrations",
      "question": "How should users sign in?",
      "rationale": "SSO requirements for B2B customers (Okta, Azure AD) add a sprint; password-only is fastest.",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "password",   "label": "Email + password",                    "description": "Simplest. Adequate for early customers." },
        { "value": "social",     "label": "+ Google / Microsoft social sign-in",  "description": "Faster onboarding; users prefer this." },
        { "value": "sso",        "label": "+ Enterprise SSO (Okta, Azure AD)",    "description": "Required for most >100-seat B2B sales. Adds 1–2 sprints." },
        { "value": "magic-link", "label": "Magic-link email only",                "description": "No passwords at all. Easy for users; not great for SSO requirements." }
      ],
      "recommended": "social",
      "hint": "Start with email + Google sign-in; add Okta / Azure SSO when you land your first enterprise prospect."
    },
    {
      "id": "scale-tenants",
      "category": "audience",
      "question": "Roughly how many tenants do you expect in the first 12 months?",
      "rationale": "Scale tier picks Mongo cluster size, audit-log storage strategy, and whether sharding is in v1.",
      "required": false,
      "type": "preset_chips",
      "options": [
        { "value": "few",     "label": "10–50 tenants" },
        { "value": "some",    "label": "50–500 tenants" },
        { "value": "many",    "label": "500+ tenants" },
        { "value": "custom",  "label": "Custom" }
      ],
      "recommended": "some",
      "hint": "50–500 tenants is the typical seed/Series-A B2B SaaS range — row-level isolation on a single sharded Mongo cluster handles this comfortably."
    },
    {
      "id": "timeline-target",
      "category": "timeline",
      "question": "Is the 12-week target a hard deadline, or a planning estimate?",
      "rationale": "Hard deadlines pin the v1 scope; soft targets give us room to add a couple of v1.5 wins.",
      "required": false,
      "type": "segmented",
      "options": [
        { "value": "hard",   "label": "Hard deadline" },
        { "value": "target", "label": "Soft target" }
      ],
      "recommended": "target",
      "hint": "Most '12-week' B2B SaaS targets are soft — pinning it as hard means dropping reporting and i18n from v1, which the brief already does."
    },
    {
      "id": "budget-tier",
      "category": "budget",
      "question": "What's the rough monthly spend tier for infra + managed services?",
      "rationale": "Tier picks Mongo plan (Atlas tier), audit-log retention store (hot vs. archival), and whether to use managed SOC 2 tooling (Drata, Vanta).",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "lean",    "label": "Lean ($500–2k/mo)",         "description": "Atlas M10, S3 for audit-log archives, manual SOC 2 prep." },
        { "value": "seed",    "label": "Seed-stage ($2k–10k/mo)",   "description": "Atlas M30, Drata/Vanta for SOC 2 automation, dedicated staging." },
        { "value": "funded",  "label": "Funded / Series A ($10k+/mo)", "description": "Atlas M40+, multi-region failover, full Drata + Auditboard suite." }
      ],
      "recommended": "seed",
      "hint": "For a 12-week SOC 2-ready B2B SaaS with 3 engineers, seed-tier is the typical spend — Drata or Vanta saves you weeks of audit prep."
    },
    {
      "id": "compliance-extras",
      "category": "compliance",
      "question": "Beyond SOC 2, are there other compliance requirements?",
      "rationale": "GDPR / CCPA / HIPAA each add specific sprint work (data-deletion flows, BAAs, PHI encryption).",
      "required": false,
      "type": "toggle_chips",
      "options": [
        { "value": "gdpr",  "label": "GDPR (EU customers)" },
        { "value": "ccpa",  "label": "CCPA (California customers)" },
        { "value": "hipaa", "label": "HIPAA (healthcare data)" },
        { "value": "pci-l1","label": "PCI Level 1 (full card storage)" },
        { "value": "none",  "label": "SOC 2 only" }
      ],
      "recommended": ["gdpr", "ccpa"],
      "hint": "Most US-based B2B SaaS land on SOC 2 + GDPR + CCPA. PCI L1 only applies if you're storing raw cards instead of using Stripe."
    }
  ]
}
```

---

## Example 3 — AI-heavy domain, names actual models + full stack breakdown

**Brief:** "Create a project for the video generation and editing with an AI."

The case where the consultative voice matters most. A generic "what tech
stack?" question is useless — a CTO who has shipped AI video tools breaks
the stack apart layer by layer and names actual products. All 8 mandatory
categories are covered, and `tech_stack` fans out into per-layer questions.

```json
{
  "understanding": "An AI-powered video generation + editing tool. The brief is open-ended — we need the model choice, the editing-capability scope, the full web stack (frontend/backend/db/storage/deploy), and the launch envelope before we can plan sprints.",
  "questions": [
    {
      "id": "platform-surface",
      "category": "platform",
      "question": "Where do users access the tool?",
      "rationale": "Web ships faster and avoids app-store moderation on AI content; mobile means React Native or native + app-store cycles.",
      "required": true,
      "type": "segmented",
      "options": [
        { "value": "web",    "label": "Web app" },
        { "value": "mobile", "label": "Mobile app" },
        { "value": "both",   "label": "Web + mobile" }
      ],
      "recommended": "web",
      "hint": "Web-first is standard for AI video — huge model payloads, easier billing, and no app-store moderation on AI-generated content."
    },
    {
      "id": "video-generation-model",
      "category": "features",
      "question": "Which AI video-generation model should the tool be built on?",
      "rationale": "Drives the integration sprint, output-quality expectations, and managed-API costs.",
      "required": true,
      "type": "select_card",
      "options": [
        { "value": "veo3",    "label": "Google Veo 3",        "description": "Highest visual fidelity in 2025; strong for cinematic shots. Vertex AI billing." },
        { "value": "sora",    "label": "OpenAI Sora",         "description": "Best prompt adherence and physical realism; OpenAI API." },
        { "value": "kling",   "label": "Kling AI",            "description": "Strong stylized output and lip-sync; Kuaishou. Popular for short-form content." },
        { "value": "runway",  "label": "Runway Gen-3 Alpha",  "description": "Tight editing toolchain (in/outpainting, motion brush). Pay-per-second." },
        { "value": "pika",    "label": "Pika 1.5",            "description": "Cheap and fast; lower fidelity. Good for prototyping or budget tiers." },
        { "value": "multi",   "label": "Multi-model (route per task)", "description": "Route between models per task. Best UX, more engineering." }
      ],
      "recommended": "veo3",
      "hint": "Most teams launching a consumer AI video product in 2025 start on Veo 3 or Sora for quality, then add Kling or Runway later for specific use cases."
    },
    {
      "id": "editing-capabilities",
      "category": "features",
      "question": "Which editing capabilities are in scope for v1?",
      "rationale": "Each capability is its own sprint — picking up-front prevents week-8 scope creep.",
      "required": true,
      "type": "toggle_chips",
      "options": [
        { "value": "trim",         "label": "Trim / cut / merge clips" },
        { "value": "transitions",  "label": "Transitions between clips" },
        { "value": "captions",     "label": "Auto-captions (Whisper / Deepgram)" },
        { "value": "voiceover",    "label": "AI voiceover (ElevenLabs / Suno)" },
        { "value": "inpaint",      "label": "Object removal / inpainting (Runway)" },
        { "value": "music",        "label": "AI background music (Suno / Udio)" },
        { "value": "upscale",      "label": "Upscaling (Topaz Video AI)" }
      ],
      "recommended": ["trim", "transitions", "captions"],
      "hint": "Most v1 video tools ship trim + transitions + captions — the minimum users expect. Voiceover, inpainting, and music are great fast-follows."
    },
    {
      "id": "frontend-framework",
      "category": "tech_stack",
      "question": "Which frontend framework should we build with?",
      "rationale": "Drives the entire UI sprint, hosting choice, and SSR strategy.",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "nextjs",    "label": "Next.js 14 (App Router)", "description": "React + SSR + edge-ready. Default for consumer SaaS." },
        { "value": "react-spa", "label": "React (Vite SPA)",        "description": "Pure client-side. Simpler when SEO doesn't matter." },
        { "value": "nuxt",      "label": "Nuxt 3",                   "description": "Vue's Next-equivalent. Pick if your team is Vue-fluent." },
        { "value": "sveltekit", "label": "SvelteKit",                "description": "Lean and fast. Great DX, smaller ecosystem." }
      ],
      "recommended": "nextjs",
      "hint": "Next.js is the default for AI products — Vercel hosting, edge functions for AI proxying, mature React ecosystem."
    },
    {
      "id": "backend-platform",
      "category": "tech_stack",
      "question": "Which backend platform / language?",
      "rationale": "AI video tools have heavy server work (queueing, signed-URL minting, billing webhooks) — language picks affect every sprint.",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "node-fastify",   "label": "Node.js (Fastify)",       "description": "Fast, modern, TypeScript-first. Pairs naturally with Next.js." },
        { "value": "python-fastapi", "label": "Python (FastAPI)",         "description": "Best when AI/ML logic is server-side beyond just calling APIs." },
        { "value": "go",             "label": "Go",                       "description": "Best raw throughput for video pipelines and signed-URL flows." },
        { "value": "next-api",       "label": "Next.js API routes only",  "description": "Simplest. Fine until you outgrow serverless limits." }
      ],
      "recommended": "node-fastify",
      "hint": "Node + Fastify is the sweet spot for a Next.js frontend — same language, easy monorepo, plenty of AI SDKs."
    },
    {
      "id": "database",
      "category": "tech_stack",
      "question": "Which database for user data, projects, and job metadata?",
      "rationale": "Drives the schema sprint, hosting choice, and migrations strategy.",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "postgres-supabase", "label": "Postgres on Supabase",  "description": "Postgres + auth + storage + realtime out of the box. Best default for early-stage." },
        { "value": "postgres-neon",     "label": "Postgres on Neon",       "description": "Serverless Postgres with branching. Pairs well with Vercel." },
        { "value": "mongodb-atlas",     "label": "MongoDB Atlas",          "description": "Document model. Only if data is genuinely schemaless." }
      ],
      "recommended": "postgres-supabase",
      "hint": "Postgres on Supabase is the 2025 default for AI/SaaS — auth, RLS, and storage in one place; can scale out later."
    },
    {
      "id": "file-storage",
      "category": "tech_stack",
      "question": "Where will generated videos and source assets be stored?",
      "rationale": "Video files are large; egress fees and storage pricing materially affect unit economics.",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "r2",          "label": "Cloudflare R2",        "description": "S3-compatible, zero egress fees. Best cost for video-heavy workloads." },
        { "value": "wasabi",      "label": "Wasabi",                "description": "Cheap S3-compatible storage, flat pricing. Great for archival." },
        { "value": "s3",          "label": "AWS S3",                "description": "Industry standard. Pick if you're already AWS-native." },
        { "value": "gcs",         "label": "Google Cloud Storage",  "description": "Pairs naturally with Veo 3 (Vertex AI). Avoids cross-cloud egress." }
      ],
      "recommended": "r2",
      "hint": "For AI video, R2 or Wasabi save real money — videos are large and egress fees dominate the bill on S3/GCS at scale. Pick GCS only if you're on Veo (same-cloud)."
    },
    {
      "id": "deployment",
      "category": "tech_stack",
      "question": "Where will you deploy the app?",
      "rationale": "Hosting choice constrains the backend, affects cold-starts, and shapes the DevOps sprint.",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "vercel",  "label": "Vercel",       "description": "Best for Next.js. Edge functions, preview deploys, zero-config." },
        { "value": "fly",     "label": "Fly.io",        "description": "Run any Docker workload close to users. Good for heavy backends." },
        { "value": "render",  "label": "Render",        "description": "Heroku-like simplicity, supports background workers natively." },
        { "value": "aws-ecs", "label": "AWS (ECS / Fargate)", "description": "Pick when scale, compliance, or existing AWS footprint demand it." }
      ],
      "recommended": "vercel",
      "hint": "Vercel for the Next.js frontend + Fly.io or Render for the Fastify backend is the sweet-spot setup."
    },
    {
      "id": "integrations-mix",
      "category": "integrations",
      "question": "Which 3rd-party services do you need wired up beyond the AI video API?",
      "rationale": "Each integration is its own sprint — auth, billing, email, and analytics together can be 2+ weeks if all in v1.",
      "required": false,
      "type": "toggle_chips",
      "options": [
        { "value": "stripe",     "label": "Stripe (billing / credits)" },
        { "value": "clerk",      "label": "Clerk (auth)" },
        { "value": "posthog",    "label": "PostHog (product analytics)" },
        { "value": "sentry",     "label": "Sentry (error monitoring)" },
        { "value": "resend",     "label": "Resend (transactional email)" },
        { "value": "discord",    "label": "Discord (community / share-to)" }
      ],
      "recommended": ["stripe", "clerk", "sentry"],
      "hint": "Stripe + Clerk + Sentry is the minimum stack for a paid AI product. PostHog and Resend land in v1.1."
    },
    {
      "id": "audience-tier",
      "category": "audience",
      "question": "Who is the primary audience for v1?",
      "rationale": "Consumer ships fast with simple UX; pro/agency needs project files, exports, and team features.",
      "required": true,
      "type": "select_card",
      "options": [
        { "value": "consumer", "label": "Consumers / creators",       "description": "Short-form social content. One-click flows, mobile-friendly." },
        { "value": "pro",      "label": "Professional editors",        "description": "Long-form, granular timeline control, project file imports." },
        { "value": "b2b",      "label": "Businesses / marketing teams", "description": "Brand kits, team seats, asset library, approval workflows." }
      ],
      "recommended": "consumer",
      "hint": "Consumer-first is the typical wedge — fastest to wow people, easiest to demo. Pro/B2B can layer on once you have a core flow."
    },
    {
      "id": "timeline-target",
      "category": "timeline",
      "question": "What's your target launch window?",
      "rationale": "Tight windows force scope cuts; longer windows let us add the nice-to-haves.",
      "required": false,
      "type": "preset_chips",
      "options": [
        { "value": "1m",     "label": "1 month (MVP demo)" },
        { "value": "2m",     "label": "2 months" },
        { "value": "3m",     "label": "3 months (typical v1)" },
        { "value": "6m",     "label": "6 months (polished)" },
        { "value": "custom", "label": "Custom" }
      ],
      "recommended": "3m",
      "hint": "3 months is the sweet spot for a Veo 3 + 3 editing features web app with consumer onboarding. 1 month is realistic only for a demo with a single model and no auth."
    },
    {
      "id": "budget-tier",
      "category": "budget",
      "question": "What's the rough monthly budget for managed-API + infra spend?",
      "rationale": "Video-gen APIs are expensive per second; tier dictates usage caps, queueing, and whether premium models are default-on.",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "bootstrap", "label": "Bootstrap (≤ $500/mo)",          "description": "Hard usage caps, watermarks, queue-not-realtime. Cheaper models as fallback." },
        { "value": "seed",      "label": "Seed-stage ($500–5k/mo)",         "description": "Free tier with caps + paid tier. Veo 3 for paid, Pika for free." },
        { "value": "funded",    "label": "Funded / Series A+ ($5k–50k/mo)", "description": "Generous limits, premium models default-on, faster turnaround SLAs." },
        { "value": "enterprise","label": "Enterprise ($50k+/mo)",            "description": "Reserved compute, custom SLAs, possibly self-hosted models." }
      ],
      "recommended": "seed",
      "hint": "Most early-stage AI video products land in seed-tier. Below that you need a free-tier with hard limits; above that you can default to premium models for every user."
    },
    {
      "id": "compliance-content",
      "category": "compliance",
      "question": "Which compliance / safety requirements apply?",
      "rationale": "AI-generated content has unique risks: copyright, deepfake / likeness, minor-protection, regional restrictions. Each one is its own sprint.",
      "required": true,
      "type": "toggle_chips",
      "options": [
        { "value": "gdpr",            "label": "GDPR (EU users)" },
        { "value": "age-gate",        "label": "Age gate (18+)" },
        { "value": "content-mod",     "label": "Content moderation (NSFW, violence)" },
        { "value": "watermark",       "label": "AI-content watermarks (C2PA)" },
        { "value": "likeness-consent","label": "Likeness consent (face / voice clones)" },
        { "value": "copyright-check", "label": "Copyright detection on prompts" }
      ],
      "recommended": ["content-mod", "watermark", "gdpr"],
      "hint": "Most AI video products ship with at minimum content moderation + AI-content watermarks (C2PA) + GDPR. Likeness consent is required if you support face/voice clones; without it you risk takedowns."
    }
  ]
}
```

---

## Example 4 — Highly detailed brief — "confirm and refine"

**Brief:** "Build a 4-week internal admin tool for moderating user reports.
Next.js + Postgres on Vercel. Single engineer. No external integrations.
List/filter/assign workflow; no reporting beyond a count dashboard.
Auth via Clerk SSO with our existing Google Workspace."

**Literacy signal:** Highly technical and highly detailed. We do NOT return
zero questions — we still ask one question per mandatory category, framed
as "confirm and refine" with the stated answer pre-selected as
`recommended`. The user accepts each one with a single click.

```json
{
  "understanding": "Internal moderation admin tool. Next.js + Postgres on Vercel, Clerk SSO, single engineer, 4-week target. No external integrations beyond Clerk. Confirming the gaps the brief did not fully pin.",
  "questions": [
    {
      "id": "platform-surface",
      "category": "platform",
      "question": "Confirming — web only?",
      "rationale": "Internal admin tools are nearly always web; confirming there is no mobile companion.",
      "required": false,
      "type": "segmented",
      "options": [
        { "value": "web",        "label": "Web only" },
        { "value": "web-mobile", "label": "Web + mobile companion" }
      ],
      "recommended": "web",
      "hint": "For internal moderation tools, web-only is the right default — admins work from a desk."
    },
    {
      "id": "feature-extras",
      "category": "features",
      "question": "Beyond list / filter / assign, anything else for v1?",
      "rationale": "Confirms scope so we don't add unexpected sprints; the brief explicitly excludes reporting beyond a count dashboard.",
      "required": false,
      "type": "toggle_chips",
      "options": [
        { "value": "bulk-actions",  "label": "Bulk actions (multi-select moderation)" },
        { "value": "audit-trail",   "label": "Audit trail (who-did-what)" },
        { "value": "notes",         "label": "Internal notes / comments per report" },
        { "value": "export",        "label": "CSV export of resolved reports" }
      ],
      "recommended": ["audit-trail"],
      "hint": "Audit trail is essentially free since you're on Postgres — every admin action gets a row. The rest are nice-to-haves for v2."
    },
    {
      "id": "stack-confirm",
      "category": "tech_stack",
      "question": "Confirming the stack: Next.js + Postgres on Vercel?",
      "rationale": "Confirming the stated stack so the orchestrator scaffolds the right project.",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "next-postgres-vercel", "label": "Next.js + Postgres + Vercel (as stated)", "description": "App Router, Vercel Postgres or Neon, deployed to Vercel." },
        { "value": "alt-supabase",         "label": "Switch to Supabase",                       "description": "Postgres + Clerk-equivalent auth + storage if you'd rather not run two services." }
      ],
      "recommended": "next-postgres-vercel",
      "hint": "The stated stack is solid. Supabase is the only swap worth mentioning if you'd like one less integration to manage."
    },
    {
      "id": "auth-confirm",
      "category": "integrations",
      "question": "Confirming — Clerk SSO with Google Workspace?",
      "rationale": "Confirms auth provider so we plan the Clerk + Google org-restricted setup.",
      "required": false,
      "type": "segmented",
      "options": [
        { "value": "clerk-google",   "label": "Clerk + Google Workspace (as stated)" },
        { "value": "google-direct",  "label": "Google sign-in only (no Clerk)" }
      ],
      "recommended": "clerk-google",
      "hint": "Clerk is the right call — it handles the role/permission layer Google sign-in alone won't give you."
    },
    {
      "id": "audience-size",
      "category": "audience",
      "question": "How many admins will use this concurrently?",
      "rationale": "Tiny internal user counts skip the load-test sprint and let us run on the smallest Vercel/Postgres tiers.",
      "required": false,
      "type": "preset_chips",
      "options": [
        { "value": "small",  "label": "1–5 admins" },
        { "value": "medium", "label": "5–20 admins" },
        { "value": "large",  "label": "20+ admins" },
        { "value": "custom", "label": "Custom" }
      ],
      "recommended": "small",
      "hint": "Single-engineer internal tools almost always live in the 1–5 admin range. Vercel Hobby + Neon free tier handle this."
    },
    {
      "id": "timeline-confirm",
      "category": "timeline",
      "question": "Confirming — 4-week target?",
      "rationale": "The brief says 4 weeks; confirming there's no soft buffer.",
      "required": false,
      "type": "segmented",
      "options": [
        { "value": "4w-hard", "label": "4 weeks — hard deadline" },
        { "value": "4w-soft", "label": "4 weeks — target, with a soft buffer" }
      ],
      "recommended": "4w-hard",
      "hint": "Single-engineer 4-week scopes are usually hard deadlines because every day matters."
    },
    {
      "id": "budget-tier",
      "category": "budget",
      "question": "Any monthly budget constraint we should plan around?",
      "rationale": "Internal tools often have zero or near-zero infra budget; matters for Postgres tier and Clerk plan choice.",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "free-tier", "label": "Free tier where possible",   "description": "Vercel Hobby, Neon free, Clerk free up to 10k MAUs. $0/month at this scale." },
        { "value": "paid-tier", "label": "Paid where it helps",         "description": "Vercel Pro ($20/mo) for previews + Clerk Pro for organization features." }
      ],
      "recommended": "free-tier",
      "hint": "For a 1–5 admin internal tool, free tiers everywhere are realistic — Vercel Hobby + Neon free + Clerk free covers it entirely."
    },
    {
      "id": "compliance-data",
      "category": "compliance",
      "question": "Do the moderated reports contain PII or regulated data?",
      "rationale": "PII or regulated data triggers retention rules, encryption-at-rest verification, and a deletion-request flow.",
      "required": true,
      "type": "select_card",
      "options": [
        { "value": "no-pii",     "label": "No PII — only public report content",           "description": "Standard Postgres + Vercel setup is fine." },
        { "value": "some-pii",   "label": "Some PII (usernames, emails)",                   "description": "Add a data-deletion endpoint and a retention policy task." },
        { "value": "sensitive",  "label": "Sensitive (health, finance, minor data)",        "description": "Plan an encryption-at-rest verification + access-log sprint." }
      ],
      "recommended": "some-pii",
      "hint": "Even 'just user reports' usually contains some PII — usernames, account IDs, sometimes uploaded media. Plan the data-deletion flow now."
    }
  ]
}
```
