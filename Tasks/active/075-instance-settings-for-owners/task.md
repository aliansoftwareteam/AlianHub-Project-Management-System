---
id: 075
title: Instance settings an owner can fill in — no env names, grouped, with setup steps
status: active
priority: high
depends_on: [067]
created: 2026-10-30
---

# Instance settings an owner can fill in — no env names, grouped, with setup steps

> Part of [060 AlianHub Cloud](../060-alianhub-cloud-programme/task.md) · Branch `feat/instance-settings-friendly` into `chore/pre-staging`

## Goal

The Settings › Instance page on a hosted (AlianHub Cloud) instance is written for a developer: it
lists values the customer cannot change ("Managed by AlianHub Cloud"), prints env names such as
`APIURL` and `ANTHROPIC_API_KEY`, shows every AI provider's fields at once, and gives no hint where
a key comes from. A workspace owner should see only what they can set, grouped by what it is for,
in plain words, with the steps and links to get each key.

## Scope

### Hide what the owner cannot change (hosted)

- Rows AlianHub Cloud sets (`managed`) and rows the environment sets are not shown at all.
- A tab whose every row is hidden is not shown (today: Mail, Storage). If a plan hands a group to
  the customer (e.g. own SMTP), its rows are no longer managed and the tab comes back on its own.
- The read-only "Hold risky AI writes for approval" row (changed only in `.env`) is not shown.
- General keeps Product name and Scheduler time zone.

### No developer wording

- The env key (`APIURL`, `AI_API_KEY`, …) is no longer printed under each field on a hosted
  instance. Self-hosted keeps it, as a hover tooltip on the label, since its admin edits `.env`.
- Help text that names env variables or `.env` is rewritten in plain words.

### Scheduler time zone is a dropdown

- A searchable list of IANA zones (`Intl.supportedValuesOf('timeZone')`), grouped by region; the
  server refuses a zone `Intl` does not know (`err_timezone`).

### Sections with setup steps

Each tab is split into titled sections; a section can carry a short "how to get this" note with a
link. Fields that only matter for one choice show only when that choice is made.

- **AI** — *AI on this instance* (AI features, Workspace Guide, daily AI-field limit, replay
  records) · *Model provider* (provider dropdown, then only that provider's key, model and address,
  with where to create the key: OpenAI platform.openai.com/api-keys, Anthropic
  console.anthropic.com/settings/keys, DeepSeek platform.deepseek.com/api_keys, OpenAI-compatible:
  your server's address, Ollama / vLLM / LM Studio examples) · *Model prices* · *Connect AI apps*
  (connect by address, the three tool groups).
- **Sign-in** — *Email sign-in* (emailed link, authenticator app name) · *Single sign-on* ·
  *Google*, *GitHub*, *GitLab*: the on/off switch first; the client id and secret show when it is
  on, with the console link, the exact URL to paste (this instance's web address) and the scopes;
  the GitHub/GitLab server address sits under "Using your own GitHub Enterprise / GitLab server?".
- **Calling** — *Connection helpers (STUN)* · *Relay server (TURN)* with a choice "Shared secret
  (recommended, coturn `use-auth-secret`)" or "Username and password", each showing only its
  fields, and a note on when a relay is needed and where to get one (own coturn, or a hosted TURN
  provider).
- **Security** — every option says what happens when it is on and when it is off; each choice of
  a dropdown (permission checks off / report / enforce) gets its own one-line description.

### TURN belongs to the customer

- `TURN_URLS`, `TURN_STATIC_AUTH_SECRET`, `TURN_USERNAME`, `TURN_PASSWORD` move from `platform` to
  `customer` ownership (the cloud repo never sets them), with the ownership test and env matrix
  updated.

## Out of scope

- The other Instance tabs (Health, Agents, Knowledge, …).
- New settings, or making `.env`-only settings editable.
- Fetching a provider's model list into a dropdown (Test connection already lists models).

## Acceptance criteria

- [ ] Hosted: General shows Product name and a time-zone dropdown only; no "Managed" row anywhere;
      no Mail or Storage tab; no env key visible on any tab.
- [ ] Self-hosted: every setting is still reachable; env keys appear on hover only.
- [ ] AI: choosing Anthropic shows only the Anthropic key and model, with the key link; switching
      provider swaps the fields without losing typed values.
- [ ] Sign-in: Google/GitHub/GitLab each have their own section; credentials appear when the
      provider is switched on, with the URL to paste.
- [ ] Calling: TURN is editable on a hosted instance; picking an auth method shows only its fields.
- [ ] Security: every visible option states the on and off (or each choice's) effect.
- [ ] Saving an unknown time zone is refused with a field error.
- [ ] All strings in `en.js` under `Instance`, backfilled; `i18n:check`, `style:check`, catalog,
      ownership and Instance tests pass.
