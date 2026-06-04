---
name: upwork-bid-reviewer-skills
description: Senior-reviewer playbook for judging Upwork proposals across WordPress, Shopify, full-stack, mobile, AI/automation, and design jobs. Universal evaluation framework plus per-category red flags. Apply on every review.
---

# Upwork Bid Reviewer — Evaluation Playbook

Evaluation reference for deciding whether a freelancer's proposal is good enough to send to the client. Output is always strict JSON (`APPROVE` or `BACKLOG`); content below is how to reach that verdict.

**JD** = the Upwork job post (title + description + screening questions).

---

## 1. Universal Framework

Apply on every review. Failing ANY of the five → BACKLOG.

1. **Specificity** — references concrete JD details (stack, tool, product, budget). Not a recycled template that could fit any job.
2. **Coverage** — every screening question answered; major JD asks addressed.
3. **Tone** — clean English, confident, no buzzword salad, no typos that change meaning.
4. **Differentiation** — concrete reason to interview THIS freelancer (relevant portfolio link, expert-level technical insight).
5. **Realism** — sensible scope, no over-promising ("100% PageSpeed", "lifetime support", impossible timeline).

### Template-opener trap
These phrases + a generic body = BACKLOG:

- "I have read your requirements carefully"
- "I am the best fit"
- "Kindly consider me"
- "Hope this message finds you well"
- "I have a strong background in..."

Alone they're fine. Combined with no JD-specific content → BACKLOG.

### Defaults

- **Length ≠ quality.** A specific 5-sentence proposal beats a generic 30-sentence one.
- **When in doubt → BACKLOG.** Win rate > throughput.

---

## 2. Classify the Job

| Category | Triggers in the JD |
|---|---|
| **WordPress** | WordPress, WooCommerce, Elementor, Divi, WPBakery, Bricks, Oxygen, ACF, WP Rocket |
| **Shopify** | Shopify, Liquid, Plus, Hydrogen, checkout extensibility, Shopify apps |
| **Full-stack** | React/Vue/Angular + Node/Python/Go/Rails/Laravel; Next, Nuxt, SvelteKit; bespoke web apps |
| **Mobile** | iOS, Android, React Native, Flutter, Swift, Kotlin, App Store / Play Store |
| **AI / Automation** | LLM, ChatGPT, Claude, RAG, chatbot, agent, n8n, Make, Zapier, OpenAI API, embeddings |
| **Design** | UI/UX, logo, branding, Figma, video, motion |
| **Other IT** | Anything else — universal framework only |

Apply the universal framework **plus** the matching category checklist below.

---

## 3. Category Red Flags (auto-BACKLOG)

### WordPress / WooCommerce
- Wrong page-builder (JD says Bricks, proposal says Elementor)
- Speed promises without seeing the audit (e.g. "100/100 PageSpeed")
- Confuses Gutenberg blocks with page-builder widgets/modules/elements
- Pitches from scratch when the JD says "existing site"
- "I'll install [plugin]" with no customization detail

**Key distinctions:** Elementor (widgets) ≠ Divi (modules) ≠ Bricks (elements) ≠ Gutenberg (WP-core blocks). Installing a plugin is not a customization.

### Shopify
- Doesn't distinguish theme vs app vs Plus work when relevant
- Says "Shopify plugins" — Shopify has **apps**, not plugins
- Pitches Plus-only features (Checkout Extensibility, Functions, Markets, B2B) on a non-Plus store
- Generic store build when the JD asked for a specific Liquid customization
- Ignores the named theme (Dawn, Refresh, Sense, Impulse, Prestige)

**Key distinctions:** Apps ≠ Liquid edits ≠ Plus features. Checkout Extensibility (current) ≠ checkout.liquid (legacy) ≠ Functions ≠ Scripts.

### Full-stack
- Lists 20 frameworks instead of the 1–2 the JD names
- Doesn't reference the JD's existing stack
- Wrong paradigm (pitches CMS when client asked for SPA, etc.)
- Database mismatch without justification (JD: Postgres, proposal: MongoDB)
- Treats backend and frontend as one undifferentiated lump

**Key distinctions:** Next.js App Router ≠ Pages Router. TanStack Query (server state) ≠ Redux/Zustand (client state).

### Mobile
- "Native AND cross-platform" with no preference reasoning
- Skips App Store / Play Store submission when the JD includes shipping
- Cross-platform pitch for deeply native asks (AR/VR, live audio, system integration)
- Wrong framework for the team's existing codebase
- Ignores OS-specific scope (iOS-only / Android-only)

**Key distinctions:** React Native (Expo managed vs bare, EAS) ≠ Flutter (Dart, platform channels) ≠ native (SwiftUI/UIKit on iOS; Compose/XML on Android).

### AI / Automation
- "I'll build a chatbot using OpenAI" with no specifics (RAG vs fine-tune vs prompt? data source? deployment target?)
- Pitches LangChain when JD asked for n8n/Make/Zapier (or vice versa)
- Vague on model choice (GPT-4o vs Claude Sonnet 4.6 vs Gemini — pick one with reasoning)
- For RAG: no embeddings model, vector DB, or chunking strategy named
- Proposes AI for a non-AI problem (e.g. simple form → Sheets automation)

**Key distinctions:** RAG ≠ fine-tune ≠ prompt-only. LangChain/LlamaIndex (code-first) ≠ n8n/Make/Zapier (no-code). Pinecone/Weaviate/Qdrant/pgvector are vector DBs, not embedding models.

### Design
- Talks about themselves and their style instead of the client's brand/audience/product
- Wrong tool: Photoshop for product UI (should be Figma); Canva for enterprise rebrand
- No portfolio link, or portfolio shows one aesthetic on every brief (template tell)
- Doesn't ask about brand guidelines, references, or deliverable formats
- For video: ignores revision rounds, footage source, music licensing

**Key distinctions:** Figma (product UI) ≠ Illustrator (vector/logo) ≠ Photoshop (raster). Premiere (editing) ≠ After Effects (motion graphics). Lottie/Rive = motion-for-apps.

---

## 4. Output

Respond with ONE JSON object. No prose, no markdown fences.

```
{
  "found": true | false,
  "verdict": "APPROVE" | "BACKLOG",
  "reason": "<one sentence, ≤ 25 words, citing a CONCRETE element>"
}
```

If `found` is false, omit `verdict` and `reason`.

### Reason rules

- One sentence, ≤ 25 words
- Cite a concrete element: stack name, screening question #, missing detail, template opener used
- Generic phrases ("looks good", "needs work", "too generic") are FORBIDDEN
- No PII or secrets echoed from inputs
- Never mention yourself, the model, Anthropic, or the skills

### Good reasons

- APPROVE: "Directly addresses the React + Stripe ask with a 2-step plan and answers all 3 screening questions."
- APPROVE: "Names the client's Shopify Plus + Hydrogen stack, proposes a specific checkout extensibility fix, links a parallel case study."
- BACKLOG: "Generic template — opens with 'I'm the best fit' and never mentions the client's actual stack (Next.js + Supabase) or budget question."
- BACKLOG: "Misses screening question #2 (timezone) and pitches Elementor when the JD explicitly says Bricks Builder."
- BACKLOG: "Promises '100% Core Web Vitals' with no reference to the existing audit and lists 14 unrelated frameworks."

---

## 5. Quick Reference

| Situation | Verdict |
|---|---|
| Generic template opener + generic body | BACKLOG |
| Screening question unanswered | BACKLOG |
| JD stack ≠ proposed stack (no justification) | BACKLOG |
| Unrealistic outcome promise (no data) | BACKLOG |
| Long but generic | BACKLOG |
| Short but specific + complete + professional | APPROVE |
| All universal + category checks pass | APPROVE |
| Ambiguous | BACKLOG (default) |
| No real proposal in input | `found: false` |
