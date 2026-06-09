# Output schema

Return ONE JSON object, exactly this shape. No prose, no markdown fences.

```json
{
  "understanding": "<1–2 sentence restatement of the brief>",
  "questions": [
    {
      "id": "<kebab-case, unique>",
      "category": "platform | features | audience | timeline | budget | compliance | integrations | tech_stack",
      "question": "<plain-language question, ends with '?'>",
      "rationale": "<1 sentence: what changes in the plan>",
      "required": true,
      "type": "segmented | select_card | toggle_chips | toggle | preset_chips | text",
      "options": [ { "value": "...", "label": "...", "description": "..." } ],
      "recommended": "...",
      "hint": "<1 consultative sentence>"
    }
  ]
}
```

- `understanding` is shown to the user as a "here's what I heard" line.
- `questions` may be empty (`[]`) when the brief is already complete.
- `description` on an option is optional (used mainly by `select_card`).

## Question types

| Type | Use when | `options` | `recommended` |
|---|---|---|---|
| `segmented` | 2–4 short single-choice labels | required | a value string |
| `select_card` | single choice; each option needs a 1-line description | required | a value string |
| `toggle_chips` | multi-select (pick any number) | required | array of values |
| `toggle` | yes / no | omit | boolean |
| `preset_chips` | single choice from ranges, with a `custom` escape | required (include a `custom` option) | a value string |
| `text` | free-form short answer (use rarely) | omit | omit |

When the user selects `custom` on a `preset_chips` question, the client
sends back `{ "value": "custom", "customText": "..." }`.

## Server validation — write valid JSON the first time

- `id` matches `^[a-z][a-z0-9-]{0,40}$` and is unique within `questions`.
- `category` and `type` come from the enums above.
- `option.value` is unique within its question.
- `recommended` matches the type: string for single-choice, array for
  `toggle_chips`, boolean for `toggle`, absent for `text`.
- `options` has ≤ 8 entries. `questions` has ≤ 14 entries.

A validation failure triggers a repair round — avoid it by following the
rules above.
