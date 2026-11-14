# Design tokens and styles

Every colour in the web app comes from a design token, so a screen follows the light and dark themes, the accent colour a person picks, and high contrast without extra work. This page lists the main tokens, the `ah-` classes built on them, and the check that keeps hard-coded colours from coming back.

## The rule

- Styles never ship a hard-coded colour (`#hex`, `rgb()`/`rgba()`, `hsl()`/`hsla()`, or a colour name such as `white` or `black`).
- Styles never use a legacy utility class with a hard-coded colour or font value (`bg-white`, `bg-light-gray`, `GunPowder`, `color47`, `btn-white`, `font-size-13`, `font-weight-500`, `form-control`, …).
- Use the tokens in `frontend/src/assets/css/tokens.css` (`var(--surface)`, `var(--ink)`, `var(--brand)`, …) and the `ah-` classes.

```css
.foo-card {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    color: var(--ink);
}
```

## How themes work

`tokens.css` defines every token on `:root` for the light theme, and redefines the colour tokens under `:root[data-theme="dark"]`. The shell sets `data-theme` on `<html>` (`frontend/src/components/organisms/Shell/shellState.js`). Other layers override the same tokens:

| Selector | What it changes |
|---|---|
| `:root[data-theme="dark"]` | The dark theme |
| `[data-accent-swatch="..."]` | The accent colour: `indigo` (default), `blue`, `purple`, `teal`, `green`, `orange`, `pink`, each with a dark variant |
| `:root.ah-high-contrast` | High contrast (Settings, Contrast, or `prefers-contrast: more`): body text at 7:1 or more, borders at 3:1 or more |
| `:root[data-variant="a" / "b" / "c" / "classic"]` | The look's sizes and spacing. The dense look is the default |
| `[data-density="compact"]` | Row density of the List and the Table, from 768 px wide |

Because a token can change under any of these, never copy its light value into a stylesheet.

## Main colour tokens

| Token | Light | Dark | Use for |
|---|---|---|---|
| `--brand` | `#2F3990` | `#a892ff` | Primary actions, links, focus |
| `--brand-deep` | `#1e2666` | `#8f7bf0` | Hover on brand fills |
| `--brand-tint` | brand at 10% | brand at 16% | Soft brand backgrounds |
| `--on-brand` | `#ffffff` | `#111114` | Text and icons on `--brand` |
| `--ink` | `#17161c` | `#f2f1f6` | Body text |
| `--ink-2` | black at 55% | white at 62% | Secondary text |
| `--ink-3` | black at 40% | white at 42% | Hints, placeholders |
| `--canvas` | `#f7f6f3` | `#111114` | The page behind cards |
| `--surface` | `#ffffff` | `#18181c` | Cards, panels, inputs |
| `--surface-2` | `#faf9f7` | `#1d1d22` | A second surface level |
| `--surface-hover` | black at 4% | white at 5% | Hover on a row or item |
| `--hairline` | black at 8% | white at 9% | Dividers, card borders |
| `--border` | black at 14% | white at 16% | Input and button borders |
| `--ok` / `--ok-bg` / `--ok-ink` | `#2f9e7e` / `#e6f4ef` / `#1f6f58` | `#3ad29f` / tint / `#7fe6c3` | Success |
| `--warn` / `--warn-bg` / `--warn-ink` | `#d98324` / `#fdf1e3` / `#a4470f` | `#d98324` / tint / `#f0b06b` | Warning |
| `--danger` / `--danger-bg` / `--danger-ink` | `#c1121f` / `#fdeced` / `#9c1f2e` | `#ff7b85` / tint / `#ff8f98` | Errors, destructive actions |
| `--agent` / `--agent-bg` / `--agent-ink` | `#6b5ce7` / `#eeebfd` / `#5747d6` | `#6b5ce7` / tint / `#b3a4ff` | Anything an AI agent did |
| `--rail` | `#1a1a1a` | `#000000` | The left rail, dark in both themes |
| `--scrim` | black at 35% | black at 35% | The dimmed page behind a dialog |
| `--focus` | 2px `--brand` ring | 2px `--brand` ring | Focus outline |

## Other tokens

| Group | Tokens |
|---|---|
| Type | `--font-ui`, `--font-mono`, and shorthands `--text-display`, `--text-h1` to `--text-h3`, `--text-body`, `--text-small`, `--text-label`, `--text-data`; sizes `--fs-2xs` to `--fs-xl` |
| Spacing | `--sp-1` (2px) to `--sp-9` (20px); `--page-pad-x`, `--page-pad-y`, `--card-pad-x`, `--card-pad-y`, `--gap-stack`, `--gap-row` |
| Radius | `--r-sm`, `--r-md`, `--r-lg`, `--r-chip`, `--r-input`, `--r-card`, `--r-modal` |
| Shadow | `--shadow-pop`, `--shadow-modal`, `--shadow-card`, `--shadow-panel` |
| Sizes | `--control-h-sm`, `--control-h`, `--control-h-lg`, `--row-h`, `--chip-h`, `--hit-min` (24px, the smallest control) |
| Motion | `--ease`, `--t-state` (150ms), `--t-panel` (240ms) |

## The `ah-` classes

`tokens.css` also defines the shared primitives. Use them before writing your own:

| Class | Variants |
|---|---|
| `ah-btn` | `--primary`, `--secondary`, `--outline`, `--ghost`, `--danger`, `--dark`, `--sm`, `--lg`, `--block` |
| `ah-chip` | `--brand`, `--ok`, `--warn`, `--danger`, `--agent`, `--automation`, `--dark`, `--mono`, `--sm` |
| `ah-card` | `ah-card__head` |
| `ah-input`, `ah-field`, `ah-check` | `ah-input--error` |
| `ah-avatar` | `--sm`, `--lg`, `--agent`, `--automation` |
| `ah-dot` | `--ok`, `--warn`, `--danger` |
| `ah-page`, `ah-empty`, `ah-divider`, `ah-label` | |

## The check

`scripts/style-check.js` counts, for every `.vue`, `.css` and `.scss` file under `frontend/src`, the hard-coded colours and legacy classes it still uses. `scripts/style-baseline.json` holds those two counts per file.

- **Hard-coded colours** are read from declaration values in stylesheets, `<style>` blocks and `style=` / `:style=` attributes. Not counted: selectors, comments, strings, `url()`, `var()` and its fallback, `<script>`, SVG attributes such as `fill=`, and `tokens.css` itself.
- **Legacy classes** are classes that a sheet in `frontend/src/assets/css` (other than `tokens.css`) defines on its own with a hard-coded colour or font value. The list is derived from those sheets on every run, so a utility rewritten onto tokens stops counting.

| Command | What it does |
|---|---|
| `npm run style:check` | Totals, and every file above or below its baseline. `--top 25` adds the files with the most; `--json` prints the counts |
| `npm run style:check -- <file>` | Every finding in that file, by line |
| `npm run style:baseline` | Lowers the baseline to the current counts. Refuses to raise one |
| `npm run style:baseline -- --allow-increase` | Also raises. A deliberate exception only |

`tests/conventions/style-check.test.js` fails when a file is above its baseline, when a file with no entry has any finding, and when an entry is higher than the file now needs. So:

- The pull request that removes colours runs `npm run style:baseline` and commits the lowered baseline.
- A deliberate exception (a file that moved or was split, or a colour that cannot be a token) uses `--allow-increase` and says which in the PR body.
- On a merge conflict in the baseline, keep the higher count and re-run `npm run style:baseline`.

## Related

- [Frontend](./frontend)
- [Conventions](./conventions)
- [Testing](./testing)
