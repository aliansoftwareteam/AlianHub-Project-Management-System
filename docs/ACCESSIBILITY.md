# Accessibility

AlianHub aims to meet the [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/)
at level AA. We are not there everywhere yet. This page says what we check, what works today, what we
know is still missing, and how to tell us about a problem.

It covers the web app and the desktop app, which shares the same screens. Public share pages and public
forms are covered where noted.

## What we check

- **Automated checks on every pull request.** The end-to-end suite runs [axe](https://github.com/dequelabs/axe-core)
  against the WCAG 2.0, 2.1 and 2.2 A and AA rules on the everyday screens: sign in, Home, a project's List
  and Board, the task panel, creating a task, Inbox, Settings → Members, Ask, the command palette, the
  shortcut sheet, and Home in high contrast (light and dark). A serious or critical finding fails the build.
  The spec is [`e2e/specs/a11y.spec.js`](../e2e/specs/a11y.spec.js).
- **Colour contrast in unit tests.** Colour contrast is excluded from the axe run above because it is
  tested separately: the frontend unit tests read the colour tokens and fail when text drops below 4.5:1
  (7:1 in high contrast) or borders below 3:1.
- **Keyboard paths in tests.** The same suite drives the keyboard: focus stays inside the task panel and
  returns to the row that opened it, pickers open and close with Enter and Escape, and the undo notice
  works with Ctrl+Z or Cmd+Z.

## What works today

- **Keyboard.** Every control on the everyday screens can be reached and used with the keyboard. Dialogs
  keep focus inside them, close with Escape and hand focus back to what opened them. The first Tab on
  any page reaches a "Skip to content" link that jumps past the navigation.
- **Shortcuts.** Press `?` to see every shortcut. `c` creates a task, `/` searches, `g h`, `g i`, `g p`
  and `g t` go to Home, Inbox, Projects and Time, and Cmd+K or Ctrl+K opens the command palette.
  Single-key shortcuts are on by default and never fire while you type in a field. If they get in the way
  of speech input or another tool, turn them off in **My settings → Keyboard**; shortcuts with Cmd or Ctrl
  keep working.
- **Menus and pickers.** The shared dropdowns announce themselves as menus or lists, move with the arrow
  keys, close with Escape and return focus. Long lists have a search box above them.
- **Contrast.** Body text meets 4.5:1 in the light and dark themes. **My settings → Contrast → High**
  darkens text and borders (lightens them in the dark theme) to 7:1 or more and draws a thick focus ring
  on every control. It turns on by itself when your device asks for more contrast, unless you pick
  Standard.
- **Focus.** Every control shows a visible focus ring when reached with the keyboard.
- **Motion.** When your device asks for reduced motion, transitions and decorative animations stop.
  Spinners keep turning so you can tell something is loading.
- **Structure.** Each screen has one main heading and one main region, and icon-only buttons have names.

## Known gaps

These are open. Most come from our own review in September 2026.

- **Inbox tabs.** The Inbox side navigation is marked up as tabs but has no tab panels or arrow-key
  support. A screen reader announces tabs that do not behave like tabs.
- **Dark theme leftovers.** Some older screens and panels stay light in the dark theme or keep light-theme
  colours: the project calendar, the Integrations panel, Create channel, Create team, and the charts in
  the custom report builder and capacity planning. Some image icons are dark on dark. High contrast does
  not reach these older screens either.
- **Small touch targets.** A few controls on phone-sized screens are still smaller than 24 by 24 pixels,
  such as the Teams colour swatches and the checkboxes on public forms.
- **AI section navigation.** At some widths the AI side navigation shows icons only, with no visible
  labels.
- **Public pages.** Public share pages and public forms are shown in English only and always in the
  light theme.
- **Screen readers.** We check with automated tools and the accessibility tree. We have not yet done a
  full pass with VoiceOver, NVDA or JAWS.

## Report a problem

If something stops you from using AlianHub with a keyboard, a screen reader, zoom, speech input or any
other assistive technology, please tell us.

- Open an issue on [GitHub](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues)
  and start the title with "Accessibility:". Say which screen, what you tried, what happened, and which browser
  and assistive technology you use.
- If you would rather not post in public, use the contact routes in [SUPPORT.md](../SUPPORT.md).

We treat problems that block a task as bugs, not feature requests.
