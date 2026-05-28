# Output schema — clarifying questions

Return ONE JSON object, exactly this shape:

```json
{
  "understanding": "<1-2 sentence restatement of what you understood from the brief>",
  "questions": [
    {
      "id":          "<short kebab-case stable id>",
      "category":    "platform | features | tech_stack | integrations | audience | timeline | budget | compliance",
      "question":    "<the question, conversational, ends in '?'>",
      "rationale":   "<1 sentence: what about the plan changes depending on the answer>",
      "required":    true | false,
      "type":        "segmented | select_card | toggle_chips | toggle | preset_chips | text", // radio_cards
      "options":     [ /* see per-type rules below; omit for type=text and type=toggle */ ],
      "recommended": <see per-type rules below>,
      "hint":        "<1 sentence: consultative voice — trade-off, what most teams pick, or a risk flag>"
    }
  ]
}
```

## `understanding`

A short, plain-language restatement of what the brief is asking for. This
is shown to the user at the top of the Clarify step as a "here's what I
heard" banner. Keep it to 1–2 sentences. Do not editorialize.

## `questions[]`

Cap at **14**. Lightweight briefs land around **8–10** questions (one per
mandatory category, plus a couple of natural follow-ups). Tech-heavy briefs
land around **11–14**, because the `tech_stack` category fans out into a
question per stack layer (frontend, backend, database, storage,
deployment).

**Do NOT return an empty array.** The eight mandatory categories
(`platform`, `features`, `tech_stack`, `integrations`, `audience`,
`timeline`, `budget`, `compliance`) must each have at least one question.
If the brief already states the answer, frame the question as a
"confirm and refine" — give the stated answer as the `recommended`
option so the user can accept it in one click.

## Mandatory categories (display order)

| # | `category` id  | Display label                       |
|---|---|---|
| 1 | `platform`     | 🖥️  Platform                         |
| 2 | `features`     | ✨ Core Features                     |
| 3 | `tech_stack`   | 🛠️  Tech Stack Preferences          |
| 4 | `integrations` | 💳 Third-Party Integrations          |
| 5 | `audience`     | 👥 Target Audience & Scale           |
| 6 | `timeline`     | 📅 Timeline                          |
| 7 | `budget`       | 💰 Budget                            |
| 8 | `compliance`   | 🌍 Compliance & Regional Requirements |

## Question types (pick the right one)

### `segmented`

A small set (2–4) of short, single-choice labels. Use when the options are
short enough to fit on one row of pills.

```json
{
  "type": "segmented",
  "options": [
    { "value": "web",    "label": "Web only" },
    { "value": "mobile", "label": "Mobile only" },
    { "value": "both",   "label": "Web + Mobile" }
  ],
  "recommended": "web"
}
```

`recommended` is a single string matching one of the option `value`s.

### `select_card`

Single choice, but each option needs a description (1 line) because the
trade-off isn't obvious from the label. Use when 3–6 options each have
meaningful explanation.

```json
{
  "type": "select_card",
  "options": [
    { "value": "guest",    "label": "Guest checkout",  "description": "Fastest first order; no retention data." },
    { "value": "accounts", "label": "Accounts only",   "description": "Best for return customers; adds signup friction." },
    { "value": "both",     "label": "Both",            "description": "Guest by default with optional account creation after purchase." }
  ],
  "recommended": "both"
}
```

### `toggle_chips`

Multiple-choice (user can select any number). Use for lists of features,
integrations, platforms, etc.

```json
{
  "type": "toggle_chips",
  "options": [
    { "value": "stripe",   "label": "Stripe" },
    { "value": "paypal",   "label": "PayPal" },
    { "value": "applepay", "label": "Apple Pay" },
    { "value": "gpay",     "label": "Google Pay" }
  ],
  "recommended": ["stripe", "applepay"]
}
```

`recommended` is an array of `value`s.

### `toggle`

Yes / No. Use ONLY when the decision is genuinely binary.

```json
{
  "type": "toggle",
  "recommended": true
}
```

No `options` field. `recommended` is a boolean.

### `preset_chips`

Single choice from preset buckets, with a `"custom"` escape hatch. Use for
ranges that don't need exact numbers (team size, timeline, scale).

```json
{
  "type": "preset_chips",
  "options": [
    { "value": "2w", "label": "2 weeks" },
    { "value": "1m", "label": "1 month" },
    { "value": "2m", "label": "2 months" },
    { "value": "3m", "label": "3 months" },
    { "value": "custom", "label": "Custom" }
  ],
  "recommended": "1m"
}
```

When the user picks `custom`, the frontend collects free text into the
answer field. The model gets `{"value": "custom", "customText": "..."}`.

### `text`

Free-form short answer. Use only when no structured input fits. No
`options`, no `recommended`. Keep this rare.

```json
{ "type": "text" }
```

## Validation rules the server enforces

- `id` matches `^[a-z][a-z0-9-]{0,40}$` and is unique within `questions`.
- `category` is one of the listed enum values.
- `type` is one of the six listed values.
- Each `option.value` is unique within the question.
- `recommended` matches the type (string for single-choice, array for
  multi, boolean for toggle, absent for text).
- `questions.length <= 14`.

If you violate any of these, the server's repair pass will return your
output to you with the validation error and ask you to fix it. Avoid the
repair pass — write valid JSON the first time.
