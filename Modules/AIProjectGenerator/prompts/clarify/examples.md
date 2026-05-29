# Examples

Three briefs across the range. Notice that question count tracks **open
product decisions**, not brief length, and that **no example asks an
engineering question** — the stack always defaults silently.

---

## 1. One-line brief → bundled product questions

**Brief:** "Create a project for a dating mobile app."

Nothing is decided product-wise, so ask broadly — but bundle. The
archetype question alone resolves audience, match style, and monetization.
No stack question: the engineering stack defaults to a standard mobile
stack stated in the plan's assumptions.

```json
{
  "understanding": "A dating mobile app — no specifics yet. Asking the key product decisions; the technical stack will default to industry standards in the plan.",
  "questions": [
    {
      "id": "app-archetype",
      "category": "features",
      "question": "What style of dating app are you building?",
      "rationale": "Sets the audience, the matching flow, and how it makes money in one go.",
      "required": true,
      "type": "select_card",
      "options": [
        { "value": "tinder", "label": "Tinder-style", "description": "General consumers, swipe matching, freemium with a paid tier." },
        { "value": "hinge",  "label": "Hinge-style",  "description": "Marriage-focused, detailed profiles, subscription." },
        { "value": "bumble", "label": "Bumble-style", "description": "Consumers, swipe plus a friend/local-meetup mode, freemium." },
        { "value": "niche",  "label": "Niche audience", "description": "LGBTQ+, religious, professional, etc. — custom feature set." }
      ],
      "recommended": "tinder",
      "hint": "Most new dating apps launch as a Tinder-style consumer MVP and niche down later."
    },
    {
      "id": "launch-region",
      "category": "compliance",
      "question": "Where are you launching first?",
      "rationale": "EU/UK add age verification and data-deletion work as separate sprints.",
      "required": true,
      "type": "toggle_chips",
      "options": [
        { "value": "us",     "label": "United States" },
        { "value": "eu",     "label": "EU" },
        { "value": "uk",     "label": "United Kingdom" },
        { "value": "global", "label": "Global from day one" }
      ],
      "recommended": ["us"],
      "hint": "US-only is the simplest start; EU/UK adds real compliance work for a dating app."
    },
    {
      "id": "platforms",
      "category": "platform",
      "question": "Which mobile platforms?",
      "rationale": "Decides whether we ship to one app store or both.",
      "required": true,
      "type": "segmented",
      "options": [
        { "value": "ios",     "label": "iOS only" },
        { "value": "android", "label": "Android only" },
        { "value": "both",    "label": "Both" }
      ],
      "recommended": "both",
      "hint": "Both is standard for consumer dating apps."
    },
    {
      "id": "mobile-stack",
      "category": "tech_stack",
      "question": "Which tech stack should we use to build the mobile app and its backend?",
      "rationale": "Determines the mobile framework, backend, and database — affects time-to-ship and team skills.",
      "required": true,
      "type": "select_card",
      "options": [
        { "value": "rn-firebase",  "label": "React Native + Firebase",            "description": "Cross-platform; Firebase handles auth, database, push, storage out-of-the-box." },
        { "value": "rn-node-pg",   "label": "React Native + Node.js + PostgreSQL", "description": "Cross-platform with a full custom backend — more control." },
        { "value": "flutter",      "label": "Flutter + Firebase",                  "description": "Native-feeling UI, single codebase. Great for animations and swipe feel." },
        { "value": "ai-decide",    "label": "Let AI decide",                       "description": "We'll default to React Native + Firebase." }
      ],
      "recommended": "rn-firebase",
      "hint": "React Native + Firebase is the fastest path to a consumer dating MVP on both stores."
    },
    {
      "id": "timeline-team",
      "category": "timeline",
      "question": "What's your timeline and team size?",
      "rationale": "Scope and sprint sizing depend on how much time and how many people you have.",
      "required": false,
      "type": "preset_chips",
      "options": [
        { "value": "2m-solo",  "label": "2 months, solo" },
        { "value": "4m-3devs", "label": "4 months, 2–3 devs" },
        { "value": "6m-team",  "label": "6 months, 4+ devs" },
        { "value": "custom",   "label": "Custom" }
      ],
      "recommended": "4m-3devs",
      "hint": "4 months with a small team is the typical dating-app MVP."
    },
    {
      "id": "budget-tier",
      "category": "budget",
      "question": "What's your monthly budget tier for running the app?",
      "rationale": "Decides whether we plan around free tiers or premium services.",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "lean",   "label": "Lean (≤ $500/mo)",  "description": "Free tiers where possible, usage caps." },
        { "value": "seed",   "label": "Seed ($500–5k/mo)", "description": "Paid tiers for core services." },
        { "value": "funded", "label": "Funded ($5k+/mo)",  "description": "Premium services default-on." }
      ],
      "recommended": "seed",
      "hint": "Most pre-launch apps sit in the seed tier."
    }
  ]
}
```

---

## 2. Detailed but technical brief, non-technical user → product questions only

**Brief (attached PDF):** "Bliss MVP — Chrome extension for scheduled-savings
purchases. Plaid for bank balance. Notifications via Firebase or OneSignal.
Four features listed. No payment processing in MVP. Demo-ready."

**User typed:** "Create a project based on the attached document."

The brief uses technical terms, but the **user typed nothing technical** —
treat them as non-technical. Product scope is clear. Platform = Chrome
extension ✓ stated, but the brief never names a frontend framework,
backend, or database — so the **tech stack archetype** is open. Timeline
and future-mobile are also open. Low-level engineering choices (specific
notification SDK, auth provider) still default silently.

```json
{
  "understanding": "Bliss MVP — a Chrome extension for scheduled-savings purchases with Plaid balance display. Product scope is clear; asking about the tech stack archetype, timeline, and mobile plan.",
  "questions": [
    {
      "id": "tech-stack",
      "category": "tech_stack",
      "question": "Which tech stack should we use to build the extension and its backend?",
      "rationale": "Determines the frontend framework, backend, and database — affects sprint shape and team skills needed.",
      "required": true,
      "type": "select_card",
      "options": [
        { "value": "react-node-pg",  "label": "React + Node.js + PostgreSQL", "description": "Modern JavaScript stack — most common, biggest community. Safest default." },
        { "value": "react-node-mongo", "label": "React + Node.js + MongoDB",  "description": "Same JS stack but with flexible schema — good for fast iteration." },
        { "value": "vue-node-pg",   "label": "Vue + Node.js + PostgreSQL",    "description": "Vue is simpler to learn; PostgreSQL is rock-solid." },
        { "value": "ai-decide",     "label": "Let AI decide",                  "description": "We'll default to React + Node.js + PostgreSQL." }
      ],
      "recommended": "react-node-pg",
      "hint": "React + Node.js + PostgreSQL is the safest default — it's the most common choice for new MVPs."
    },
    {
      "id": "demo-target",
      "category": "timeline",
      "question": "When do you want the demo ready?",
      "rationale": "A tight deadline means trimming polish; more time allows the full flow.",
      "required": true,
      "type": "preset_chips",
      "options": [
        { "value": "2w",     "label": "2 weeks" },
        { "value": "1m",     "label": "1 month" },
        { "value": "2m",     "label": "2 months" },
        { "value": "custom", "label": "Custom" }
      ],
      "recommended": "1m",
      "hint": "1 month is realistic for the full four-feature MVP."
    },
    {
      "id": "future-mobile",
      "category": "platform",
      "question": "Should we plan for an iOS/Android app after the Chrome extension?",
      "rationale": "If mobile is coming, we structure the backend now to support it cleanly.",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "no",      "label": "Chrome extension only",  "description": "Just the demo MVP for now." },
        { "value": "later",   "label": "Plan for it later",      "description": "Keep the design mobile-ready; minimal extra effort." }
      ],
      "recommended": "later",
      "hint": "Keeping the door open for mobile costs almost nothing now and saves a rebuild later."
    },
    {
      "id": "anything-to-add",
      "category": "features",
      "question": "Anything you'd like to add or change about the brief?",
      "rationale": "Catches context the document may be missing — audience, region, or extra features.",
      "required": false,
      "type": "text",
      "hint": "For example: a target region, a must-have feature, or a constraint we should know about."
    }
  ]
}
```

---

## 3. Complete brief → no questions

**Brief:** "4-week internal admin tool for moderating user reports. Single
engineer. List/filter/assign workflow only, count dashboard, audit trail.
Reports contain PII — needs a GDPR data-deletion flow for EU users. Hard
deadline."

Product scope, audience (internal), timeline, and compliance are all
pinned. There is nothing a non-technical decision-maker still needs to
choose. Return an empty list — the wizard skips straight to plan
generation.

```json
{
  "understanding": "Internal report-moderation admin tool — scope, audience, timeline, and compliance are all specified. No clarifying questions needed.",
  "questions": []
}
```

If you ever find yourself inventing a question just to have one, return
`[]` instead.

---

## 4. AI text project (chatbot) — show TEXT model options

**Brief:** "Build an AI-powered customer support chatbot for our
e-commerce store. It should handle FAQs, order status, and refund
requests automatically. Escalate to a human agent when needed."

No tech stack stated. No AI model named. Project uses **text / conversation
AI** → show TEXT model options (LLMs). Do NOT show image or video models.
Timeline and budget are open.

```json
{
  "understanding": "An AI chatbot for e-commerce support — handling FAQs, order status, and refunds with human escalation. Asking the key product decisions; low-level engineering choices will default to industry standards.",
  "questions": [
    {
      "id": "platform-type",
      "category": "tech_stack",
      "question": "Where should the chatbot live?",
      "rationale": "Sets the build target — a website widget is a different scope than a mobile SDK or a standalone portal.",
      "required": true,
      "type": "select_card",
      "options": [
        { "value": "web-widget",  "label": "Website chat widget",  "description": "Embedded on your store pages — the most common choice." },
        { "value": "mobile-app",  "label": "Mobile app (iOS / Android)", "description": "A dedicated support app alongside your store." },
        { "value": "both",        "label": "Website + Mobile",    "description": "Full coverage — more scope." },
        { "value": "whatsapp",    "label": "WhatsApp / Messaging", "description": "Chat via WhatsApp or similar — no new app needed." }
      ],
      "recommended": "web-widget",
      "hint": "A website widget is fastest to ship and covers most e-commerce support traffic."
    },
    {
      "id": "ai-model",
      "category": "tech_stack",
      "question": "Which AI model should power the chatbot?",
      "rationale": "The model choice affects response quality, cost per conversation, and data-privacy constraints.",
      "required": true,
      "type": "select_card",
      "options": [
        { "value": "gpt4o",      "label": "GPT-4o (OpenAI)",           "description": "Best reasoning and instruction-following; higher cost per message." },
        { "value": "gpt4o-mini", "label": "GPT-4o mini (OpenAI)",      "description": "Fast and cost-effective; great for FAQ-style responses." },
        { "value": "claude",     "label": "Claude 3.5 Sonnet (Anthropic)", "description": "Excellent at nuanced conversations and long context." },
        { "value": "opensource", "label": "Open-source (Llama / Mistral)", "description": "Self-hosted — no per-message API fees, full data control." }
      ],
      "recommended": "gpt4o-mini",
      "hint": "GPT-4o mini handles most support scenarios at a fraction of the cost of GPT-4o."
    },
    {
      "id": "timeline-budget",
      "category": "timeline",
      "question": "What's your target launch timeframe and monthly budget for AI usage?",
      "rationale": "Timeline sets sprint scope; AI budget decides which model tier is practical long-term.",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "fast-lean",   "label": "4–6 weeks, lean (< $200/mo)",    "description": "MVP scope, free/cheap tiers only." },
        { "value": "normal-seed", "label": "2–3 months, seed ($200–1k/mo)",  "description": "Full feature set, paid API tiers." },
        { "value": "funded",      "label": "3+ months, funded ($1k+/mo)",    "description": "Premium models, analytics, fine-tuning." }
      ],
      "recommended": "normal-seed",
      "hint": "Most e-commerce chatbot MVPs land in the seed tier — enough budget for reliable API calls without over-committing."
    }
  ]
}
```

---

## 5. AI image generation project — show IMAGE model options

**Brief:** "Create a custom Shopify app for AI-powered product photo
generation. Merchants should be able to generate lifestyle images for
their products using a text prompt."

Project uses **image generation AI** → show IMAGE model options.
Do NOT show text/LLM options (GPT-4o, Claude, etc.) — those are wrong
for this use case. Tech stack is partially clear (Shopify app) but
which image AI to use and the v1 feature scope are open.

```json
{
  "understanding": "A Shopify app for AI product photo generation — merchants type a prompt and get lifestyle images. Asking about the AI model and scope; Shopify app tech stack will default to Remix + Shopify CLI.",
  "questions": [
    {
      "id": "image-ai-model",
      "category": "tech_stack",
      "question": "Which AI model should generate the product images?",
      "rationale": "Each model has different image quality, cost per generation, and commercial licensing rules.",
      "required": true,
      "type": "select_card",
      "options": [
        { "value": "dalle3",    "label": "DALL-E 3 (OpenAI)",       "description": "High quality, easy API, same key as ChatGPT." },
        { "value": "flux",      "label": "Flux 1.1 Pro",            "description": "Best quality right now, great for product photography." },
        { "value": "sd",        "label": "Stable Diffusion",        "description": "Open-source, self-hosted option — no per-image API fee." },
        { "value": "firefly",   "label": "Firefly (Adobe)",         "description": "Commercially safe, fully licensed — ideal for merchant use." }
      ],
      "recommended": "dalle3",
      "hint": "DALL-E 3 is the fastest to integrate; Firefly is best if your merchants need commercially safe images."
    },
    {
      "id": "v1-scope",
      "category": "features",
      "question": "What should merchants be able to do in the first version?",
      "rationale": "Determines how many sprints the MVP needs.",
      "required": true,
      "type": "select_card",
      "options": [
        { "value": "generate-only",   "label": "Generate images only",            "description": "Type a prompt, get an image, download it." },
        { "value": "generate-apply",  "label": "Generate + add to product",       "description": "One-click to set the generated image as the product photo." },
        { "value": "bulk",            "label": "Bulk generation for all products", "description": "Generate images for the entire catalog at once." }
      ],
      "recommended": "generate-apply",
      "hint": "Generate + apply is the most useful v1 without blowing out scope."
    },
    {
      "id": "timeline",
      "category": "timeline",
      "question": "What is your target launch timeline?",
      "rationale": "Scope and sprint count depend on how much time you have.",
      "required": false,
      "type": "preset_chips",
      "options": [
        { "value": "4w",     "label": "4 weeks" },
        { "value": "2m",     "label": "2 months" },
        { "value": "3m",     "label": "3 months" },
        { "value": "custom", "label": "Custom" }
      ],
      "recommended": "2m",
      "hint": "2 months is realistic for a generate + apply Shopify app with a small team."
    }
  ]
}
```
