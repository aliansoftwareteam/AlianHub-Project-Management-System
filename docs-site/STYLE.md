# Writing the AlianHub docs

This folder is the AlianHub documentation site (VitePress). This file is not published; it is the house style for anyone who writes a page.

## Who reads what

| Section | Reader | Voice |
|---|---|---|
| `getting-started/`, `user-guide/`, `ai/` (except `mcp-server`, `architecture`), `help/` | People who manage work. Not technical. | Plain words, short sentences, second person ("you"). No code, no env names, no file paths. |
| `admin/` | The person who installs and runs an instance. | Exact commands, env names, file paths. Explain why a setting matters. |
| `developer/`, `api/`, `ai/mcp-server`, `ai/architecture` | Contributors and integrators. | Accurate paths (relative to the repo root), real code taken from the repo. |

## Every page

- Starts with one `# Title` and a short paragraph: what this is, and why you would use it.
- Then the how: numbered steps for tasks, tables for fields and options.
- Names buttons and menus exactly as the app shows them, in **bold** (read `frontend/src/locales/en.js` for the real labels).
- Says what the feature cannot do, in a "Good to know" or "Limits" list, when that matters.
- Ends with a "Related" list of links when there are natural next pages.
- Links are relative and without `.md` (`[Views](/user-guide/views/)`, `[Tasks](./tasks)`). Every link must point to a page that exists — the build fails on dead links.
- Never invent a feature. If the code does not show it, do not write it. If unsure, leave it out and note it in the hand-over.
- Never copy a secret, connection string, real customer name or real email into a page. Use `example.com`.
- No screenshots in Markdown unless the image file already exists under `public/screenshots/`.

## Callouts

Use VitePress containers: `::: tip`, `::: info`, `::: warning`, `::: danger`, `::: details`.

## Things that are changing

Reports, the timesheet screens and Ask AlianHub are being reworked. Describe them in general terms (what they are for and the main steps) and avoid pixel-level detail that will go stale.
