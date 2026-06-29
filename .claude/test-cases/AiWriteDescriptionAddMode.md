# Write with AI — "Add to description" mode

**Sprint:** v14.7.0 — Write with AI enhancement
**Type:** Feature (frontend + backend)
**Status:** Implemented locally — pending manual test / PR

---

## Summary

The "Write with AI" description popover could previously only **replace** the
whole description. It now supports **adding** to an existing description without
losing what's already there.

When a description already exists, the popover shows a small toggle:

- **Add to description** (default) — the author says *what* to add and *where*
  (e.g. "add acceptance criteria", "add a note under What to do"). The model
  returns the **complete description with the existing content kept verbatim and
  the addition inserted at the requested place**.
- **Rewrite** — regenerates the whole description (the original behavior).

Empty descriptions skip the toggle and just generate (then "Use this").

The **preview is the safety contract**: the exact final description is shown and
nothing is saved until the author approves it — so existing content can never be
silently lost or changed.

---

## How it works

- **Frontend** (`AiWriteDescription.vue`): toggle sets `mode` (`add` | `rewrite`),
  sent in the generate request. Mode-aware placeholder/hint. On approve it emits
  the full previewed markdown; the parent applies it as a single reviewed replace.
- **Parent** (`Description.vue`):
  - `blocksToMarkdown()` converts the existing Editor.js blocks to **faithful
    Markdown** (headings, nested bullet/numbered lists, checklists, quotes, code)
    — this is what is sent to the model, so Add mode reproduces real structure
    rather than a lossy/`[object Object]` flatten.
  - `applyAiDescription()` always replaces via the proven converter path; the user
    already reviewed the result in the preview.
- **Backend** (`Modules/AI/aiDescriptionWriter.js`, `prompts/write-description.md`):
  in `mode === 'add'` the prompt instructs the model to keep all existing content
  exactly and only insert the addition. Input cap raised to 20k chars and output
  to 8k tokens so long descriptions come back in full. A **guard** refuses Add
  (rather than truncating) when the description exceeds the input cap — use Rewrite
  or edit manually.

---

## Test steps

Prereq: a paid plan with an AI provider configured (same gate as the existing
"Write with AI"). Open a **task that already has a description with headings and
bullet lists** (e.g. a generated task with "What to do" / "Acceptance criteria").

1. **Add — positional placement**
   - Click **Write with AI** → confirm the **Add to description** / **Rewrite**
     toggle appears with **Add to description** selected.
   - Type: *"add a point under What to do: review the AI enhancement"* → **Generate**.
   - ✅ Preview shows the **full description with real bullets** (no `[object Object]`,
     no collapsed comma lines) and the new point placed **under What to do**.
   - ✅ Every existing line (summary, all steps, acceptance criteria) is intact and
     unchanged.
   - Click **Add to description** → the description is saved exactly as previewed.
   - **Reload** → the change persisted; bullets preserved.

2. **Add — other positions** — repeat with *"add at the very top"* and *"add after
   the acceptance criteria"*; confirm the model honors the position.

3. **Rewrite** — switch to **Rewrite**, enter intent, Generate → preview shows a
   fresh full description → **Use this** → replaces the description.

4. **Empty description** — open a task with no description → **Write with AI** →
   no toggle shown → Generate → **Use this** → description is set.

5. **Both contexts** — verify on a **task** description and a **project** description
   (shared component).

6. **Plan gate** — on a free plan, both entry points show the upgrade prompt.

---

## Notes / known limitations

- Add mode faithfully round-trips text, headings, bullet/numbered lists,
  checklists, quotes, and code. **Tables and embeds** are not yet serialized to the
  model, so a description containing one would come back missing that block in Add
  mode — the **preview reveals it** (so it is not silent data loss; cancel and use
  Rewrite). Tracked as a follow-up (emit GFM tables from `blocksToMarkdown`).
