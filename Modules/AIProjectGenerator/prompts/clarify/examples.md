# Examples

Three situations. Notice that the question count tracks the **missing
points the message allows you to ask about**, never brief length or
domain, and that no example asks an engineering question.

---

## 1. Two-line brief, round 1 → three questions on the highest-priority missing points

**Brief:** "An online store for our handmade ceramics. We sell at markets
today and want to sell online too."

**Reviewer:** `what_for_whom` met (a store for a ceramics maker's market
customers). Missing: `done_when`, `existing`, `constraints`, `team`.
**Allowed this round:** 3.

Four points are missing and three questions are allowed, so `team` is left
for the next round (or becomes an assumption). Options are shaped for this
brief — a market seller going online — not for "an e-commerce project".

```json
{
  "understanding": "A first online shop for a handmade-ceramics business that currently sells in person at markets.",
  "questions": [
    {
      "id": "done-when",
      "point": "done_when",
      "category": "features",
      "question": "What does 'finished' look like for the first version of the shop?",
      "rationale": "Sets the cut-line for the first release and what the last sprint must prove.",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "order-pay-ship", "label": "Customers can order, pay and get shipping updates", "description": "A complete buying flow with card payment and order emails." },
        { "value": "catalogue-enquire", "label": "Customers can browse and send an enquiry", "description": "A catalogue with a contact form; payment stays offline for now." },
        { "value": "preorders", "label": "Customers can pre-order upcoming batches", "description": "Deposits on pieces before they are fired; fulfilment later." }
      ],
      "recommended": "order-pay-ship",
      "hint": "Most makers moving online want the full buying flow first; a catalogue alone rarely pays for itself."
    },
    {
      "id": "deadline-budget",
      "point": "constraints",
      "category": "timeline",
      "question": "When do you need the shop live, and roughly what can you spend on tools each month?",
      "rationale": "Decides the number of sprints and whether the plan uses free tiers or paid services.",
      "required": false,
      "type": "preset_chips",
      "options": [
        { "value": "6w-lean", "label": "About 6 weeks, keep monthly costs under $50" },
        { "value": "season-mid", "label": "Before the next market season, up to $200 a month" },
        { "value": "no-rush", "label": "No fixed date, whatever it reasonably takes" },
        { "value": "custom", "label": "Custom" }
      ],
      "recommended": "6w-lean",
      "hint": "A six-week first release on a hosted store platform is the common path for a solo maker."
    },
    {
      "id": "already-have",
      "point": "existing",
      "category": "integrations",
      "question": "Which of these do you already have?",
      "rationale": "Anything you already have is a task we skip; anything missing becomes one.",
      "required": false,
      "type": "toggle_chips",
      "options": [
        { "value": "product-photos", "label": "Product photos" },
        { "value": "price-list", "label": "A price list or product spreadsheet" },
        { "value": "logo-brand", "label": "A logo or brand colours" },
        { "value": "domain", "label": "A domain name" },
        { "value": "social", "label": "An Instagram or Facebook page" },
        { "value": "payments", "label": "A card reader or payment account (Square, SumUp, PayPal)" }
      ],
      "recommended": ["product-photos", "social"],
      "hint": "Market sellers usually have photos and a social page; a domain and a payment account are the usual gaps."
    }
  ]
}
```

---

## 2. Complete brief → no questions

**Brief:** "Roll out the new expense-claims process to Finance, Sales and
Field Ops (about 120 people). Done when every claim from 1 November is
filed and approved in the new tool and the old spreadsheet is closed. We
already have the tool licensed and a claims export from the spreadsheet.
Must be live before the November close; no budget beyond existing licences.
Team: me (ops lead) plus one analyst; IT does the SSO setup."

**Reviewer:** all five points met. **Allowed this round:** 0.

```json
{
  "understanding": "A three-department rollout of a licensed expense-claims tool, live before the November close, run by an ops lead and an analyst with IT handling SSO.",
  "questions": []
}
```

If you ever find yourself inventing a question just to have one, return
`[]` instead.

---

## 3. Round 2 → ask again only where the answer left the point open

Same ceramics brief. **Round-1 answers:** `done-when` → "order-pay-ship";
`deadline-budget` → "I don't know yet"; `already-have` → "product-photos".

**Reviewer after round 1:** `done_when` met. `constraints` still missing
(marked unknown — never asked again). `existing` still missing: one
selected item says what they have but not what the shop starts from — a
photo set alone does not say whether there is a brand, a domain or a
payment account to build on. `team` missing and never asked.
**Allowed this round:** 2.

```json
{
  "understanding": "A full buying flow for the ceramics shop; the deadline and budget will be assumed. Two things left to pin down: what the shop starts from, and who is doing the work.",
  "questions": [
    {
      "id": "starting-point",
      "point": "existing",
      "category": "platform",
      "question": "Is there anything already set up online that the shop should build on?",
      "rationale": "Building on an existing account or page removes setup tasks; starting from nothing adds them.",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "nothing", "label": "Nothing yet — just the photos", "description": "We start with a fresh store account, domain and payments." },
        { "value": "social-shop", "label": "An Instagram or Facebook shop", "description": "We move the listings across and keep the page as a channel." },
        { "value": "store-draft", "label": "A half-built store on Shopify, Etsy or similar", "description": "We finish what is there rather than starting over." }
      ],
      "recommended": "nothing",
      "hint": "Say 'nothing' if you are unsure — it is cheaper to plan a fresh start than to plan around an account nobody can log into."
    },
    {
      "id": "who-does-it",
      "point": "team",
      "category": "audience",
      "question": "Who will do the work on the shop?",
      "rationale": "Decides which tasks are planned for you, for a helper, or for a hired freelancer.",
      "required": false,
      "type": "select_card",
      "options": [
        { "value": "just-me", "label": "Just me, in between making", "description": "Tasks are sized for evenings and weekends." },
        { "value": "me-plus-helper", "label": "Me plus a friend or family member who is good with computers", "description": "Setup tasks go to the helper; product and photos stay with you." },
        { "value": "freelancer", "label": "I will hire someone for the setup", "description": "The plan includes briefing and reviewing a freelancer." }
      ],
      "recommended": "just-me",
      "hint": "Most makers do it themselves on a hosted platform; the plan keeps each task under two hours for that reason."
    }
  ]
}
```
