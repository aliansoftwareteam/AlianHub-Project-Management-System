# Discoverability Playbook

**Internal document — not contributor-facing.** Maintained by the AlianHub team. Tracks how we make AlianHub *found* by potential users in the open-source self-hosted ecosystem.

> 📌 This is step 7 of the open-source repo maintenance baseline initiative. See [BRANCHING.md](../BRANCHING.md) for the broader context.

---

## TL;DR

| Layer | Where users find us | Action |
|---|---|---|
| GitHub native | Topics, description, README | ✅ Mostly done — 3 high-value topics to add |
| Package manifest | `package.json` metadata | ✅ Done in this PR |
| Aggregator sites | awesome-selfhosted, alternativeto.net, etc. | ⏳ Submit using ready copy below |
| Launch platforms | Product Hunt, Hacker News, Reddit | ⏳ One-shot, requires your account + timing |
| Long-form | Dev.to, Hashnode, blog | ⏳ Optional but high ROI |
| Owned media | `alianhub.com` SEO | ⏳ Apply meta-tag snippets below |

---

## Current state (audit as of this writing)

Run `gh api repos/aliansoftwareteam/AlianHub-Project-Management-System --jq '{description, homepage, topics}'` to re-verify any time.

| Setting | Value |
|---|---|
| Description | "🔥 Alianhub — the open-source alternative to Jira, Linear, Monday & ClickUp. Manage tasks, sprints, docs, and triage, all in one modern workspace." |
| Homepage | `https://alianhub.com` |
| Topics (17) | `ai-agents`, `ai-assistant`, `board-view`, `chatbot`, `custom-fields`, `gantt-chart`, `kanban-board`, `nodejs`, `open-source`, `project-management`, `scrum-agile`, `task-management`, `team-collaboration`, `template`, `time-tracker`, `timeline`, `vue3` |
| Discussions | Enabled |
| Issues | Enabled |

---

## GitHub repo metadata — 3 high-value topics to add

GitHub caps topics at **20**. We're at 17. Three of the most-searched topics in this space are missing:

```bash
gh repo edit aliansoftwareteam/AlianHub-Project-Management-System \
  --add-topic self-hosted \
  --add-topic mongodb \
  --add-topic jira-alternative
```

| Topic | Why it matters |
|---|---|
| `self-hosted` | One of the top searches on GitHub by people *specifically* looking for OSS to run themselves |
| `mongodb` | Tech-stack discoverability — Mongo users browsing the `mongodb` topic see us |
| `jira-alternative` | Intent-based — people actively looking to migrate off Jira |

Optional further additions (if you want to use more of the 20 slots):

```bash
gh repo edit aliansoftwareteam/AlianHub-Project-Management-System \
  --add-topic asana-alternative \
  --add-topic monday-alternative \
  --add-topic electron
```

To remove a topic: `--remove-topic <name>`.

---

## Submission targets — ranked by ROI

### 1. 🥇 awesome-selfhosted (highest ROI)

**Where:** [github.com/awesome-selfhosted/awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted)
**Why:** The canonical list. 200K+ stars, indexed by every search engine, regularly cited.
**How:**
1. Fork [awesome-selfhosted/awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted)
2. Add this entry under the `### Project Management` section (alphabetical):
3. Open a PR — they typically merge within 1–2 weeks if entry is clean

**Ready entry:**

```markdown
- [AlianHub](https://alianhub.com) - Multi-tenant project management with kanban/list/calendar/board views, real-time collaboration via Socket.io, built-in timesheet & workload reporting, custom fields, AI assist, and web + Electron desktop apps. ([Source Code](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System)) `AGPL-3.0` `Nodejs/Vue`
```

> ⚠️ Use **AGPL-3.0** in the entry only after PR #207 has merged. Until then use `MIT`.

### 2. 🥈 alternativeto.net

**Where:** [alternativeto.net/software/jira/](https://alternativeto.net/software/jira/) (and similar pages for Asana, Monday, Linear, ClickUp, Trello)
**Why:** Massive SEO traffic from people googling "alternative to [popular tool]". Free listing.
**How:**
1. Sign up for a free account at alternativeto.net
2. Submit AlianHub as a new app
3. Once approved, propose it as alternative to: Jira, Asana, Monday, Linear, ClickUp, Trello

**Ready short description (80 chars):**

```
Self-hosted, open-source project management with kanban, timesheets & AI.
```

**Ready long description:**

```
AlianHub is a self-hosted, open-source project management platform built for teams that need control over their data and workflow. It combines kanban, list, table, calendar, and workload views with real-time collaboration, built-in timesheet tracking, custom fields, role-based permissions, multi-currency support, and AI-assisted task generation. AlianHub runs as a Docker container or from source, stores data in MongoDB, and supports both web and Electron desktop clients. AGPL-3.0 licensed.
```

**Tags to apply:** project-management, task-management, self-hosted, open-source, kanban, gantt, timesheet, collaboration

### 3. 🥉 Product Hunt

**Where:** [producthunt.com](https://producthunt.com)
**Why:** One big launch day → bursts of traffic, signups, GitHub stars.
**Timing:** Tuesday–Thursday launch performs best. Submit the day before, post at 12:01 AM PST.
**Prep needed:** Logo (240×240), gallery (1270×760, 4-5 images), 60-char tagline, 260-char description, "first comment" from the maker.

**Tagline (60 chars):**

```
Open-source project management you can self-host
```

**Description (260 chars):**

```
The open-source, self-hosted alternative to Jira, Asana & Monday. Kanban + list + calendar + workload views, real-time collab, built-in timesheets, custom fields, role-based permissions, and AI assist. Free forever, your data on your servers. AGPL-3.0.
```

**First comment (from maker):**

```
Hey Product Hunt 👋

We built AlianHub because every modern PM tool eventually becomes "your data, our servers, our price hikes." If you've ever had to migrate off a tool because the per-seat cost outgrew the value, this is for you.

AlianHub is fully open-source under AGPL-3.0 and runs as one Docker container + a MongoDB. No SaaS lock-in, no per-seat fees, your data stays on your infrastructure. You get kanban boards, list views, calendar, gantt-style workload reports, built-in timesheets, AI-assisted task generation, and a desktop app — same feature surface as commercial PM tools.

What we ship:
🔹 Multi-tenant from day one (one instance, many companies)
🔹 Real-time collaboration via Socket.io
🔹 Custom fields, role-based permissions, audit logs
🔹 Web + Electron desktop
🔹 Multi-currency, multi-language

Happy to answer anything. If you're a self-hoster, we'd love your feedback.

Demo: https://demo.alianhub.com
Code: https://github.com/aliansoftwareteam/AlianHub-Project-Management-System
```

### 4. Hacker News — Show HN

**Where:** [news.ycombinator.com/submit](https://news.ycombinator.com/submit)
**Why:** Tech-savvy audience, big spikes if it ranks. Sub-100 votes still drives meaningful traffic.
**Timing:** Tuesday–Thursday, 8–10 AM PST submission window.

**Title (80 chars):**

```
Show HN: AlianHub – Open-source, self-hosted alternative to Jira and Asana
```

**Body:**

```
Hey HN — I'm part of the team behind AlianHub, a self-hosted project management system we've been building. It's our take on what an open-source alternative to Jira/Asana/Monday should look like in 2026.

Stack: Node.js + Express + MongoDB + Vue 3 + Socket.io. Multi-tenant from day one, real-time collaboration, kanban/list/calendar/workload views, built-in timesheets, custom fields, role-based permissions, AI-assisted task generation. Web + Electron desktop.

Why another PM tool: the commercial options are all heading the same direction (per-seat pricing, walled-garden data, AI features only on the top tier). For teams that need control or are operating in regulated industries, "your data lives on someone else's S3 bucket" is a non-starter. AlianHub runs as one Docker container + a Mongo — that's it.

What's actually working well so far:
- Kanban + workload report in the same project (most OSS PMS don't do capacity planning)
- Multi-tenancy without the usual setup pain
- Conventional Commits + release-please for predictable releases

What I'd love feedback on:
- Where the Docker setup feels rough
- Edge cases in the permission model
- Comparisons with Plane and other OSS PMS — what they do better

License: AGPL-3.0. Github: https://github.com/aliansoftwareteam/AlianHub-Project-Management-System
Demo: https://demo.alianhub.com (read-only)
```

**Tips:**
- **Aim for 30+ upvotes in the first hour to break onto the front page.** Sub-50 votes typically buries the post within hours. The first 60 minutes are decisive.
- Stay engaged in the comments for the first 6–8 hours — comments drive HN ranking more than votes after the initial spike
- Don't ask friends to upvote — HN detects coordinated voting and will dead the post (silent ban)
- If asked "how is this different from X?", answer specifically with concrete features — vague replies kill momentum
- If the post stalls, do NOT delete and re-submit; HN dupe-detects and will penalize. Wait at least 7 days before a retry with a different title.

### 5. Reddit

#### r/selfhosted (1.4M members)

**Title:**
```
AlianHub: open-source, self-hosted project management — kanban, timesheets, AI, multi-tenant. Docker one-liner install.
```

**Body:**

```
Hey r/selfhosted 👋

Just shipped Docker images for AlianHub — open-source, AGPL-3.0 project management you can run with one `docker compose up -d`.

What you get:
• Kanban / list / calendar / workload views
• Real-time collaboration (Socket.io)
• Built-in timesheets + capacity planning
• Custom fields, role-based permissions
• Multi-tenant (one instance, many companies)
• AI assist for task/description generation
• Web + Electron desktop clients

Image: ghcr.io/aliansoftwareteam/alianhub:latest
Compose: https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/blob/main/docker-compose.yml
Demo: https://demo.alianhub.com
Repo: https://github.com/aliansoftwareteam/AlianHub-Project-Management-System

Happy to answer setup questions or take feedback on what's missing.
```

#### ⚠️ r/projectmanagement — RECOMMEND SKIPPING

This subreddit's mods aggressively remove posts that look like product promotion disguised as a question. The previously-drafted post (listing 4 named competitors as a lead-in to "have you tried AlianHub?") is **likely to be removed within hours** and could earn a soft ban.

**If you still want to engage there:**
- Don't post a launch announcement
- Instead, become a regular community member: answer other people's questions for 2–3 weeks first
- Only then organically mention AlianHub when it's directly relevant to someone else's question
- Never compare against named competitors in the post body

**Safer alternatives that reach the same audience:**
- r/selfhosted (above)
- r/opensource (below)
- r/sysadmin (for IT-led PM deployments)
- r/devops (for engineering teams)

#### r/opensource (200K+)

**Title:** Same as r/selfhosted

### 6. Dev.to / Hashnode launch post

**Title options:**
1. "Building AlianHub: lessons from 14 versions of an open-source PM tool"
2. "Why we relicensed our project management tool from MIT to AGPL"
3. "Self-hosting your project management: Docker + Mongo + Vue, end-to-end"

**Outline:**

```
Hook (problem):
  "Every commercial PM tool eventually does X..."

Context (why now):
  "We've been building AlianHub for 14 major versions. Today we're..."

What we built (the tour):
  - 8 screenshots from README
  - Architecture diagram
  - Why each piece (MongoDB, Socket.io, multi-tenant from day 1)

Decisions we made:
  - AGPL-3.0 over MIT (link to PR #207 reasoning)
  - main + staging branching model
  - Conventional Commits + release-please
  - Multi-arch Docker images

Try it:
  - docker compose one-liner
  - demo.alianhub.com link

Contribute:
  - good-first-issue + help-wanted labels
  - BRANCHING.md
  - SUPPORT.md
```

Cross-post to: Dev.to, Hashnode, Medium, your personal blog.

### 7. Other aggregators (low effort, low-medium impact)

| Site | Action | URL |
|---|---|---|
| **LibHunt** | Auto-indexes GitHub repos — usually shows up within 1–2 weeks of activity | [libhunt.com/r/aliansoftwareteam/AlianHub-Project-Management-System](https://www.libhunt.com/r/aliansoftwareteam/AlianHub-Project-Management-System) |
| **opensource.builders** | Submit via [their GitHub repo](https://github.com/opensourcebuilders/opensource.builders) — add an entry comparing AlianHub to Jira/Asana/Monday | [opensource.builders](https://opensource.builders) |
| **Indie Hackers** | Post launch story in the "Show IH" section | [indiehackers.com](https://indiehackers.com) |
| **opensourceshowcase.com** | Submit listing | [opensourceshowcase.com](https://opensourceshowcase.com) |
| **awesome-self-hosted-alternatives** | PR your entry | various forks of awesome-selfhosted |
| **/r/coolgithubprojects** | Submit GitHub link | [reddit.com/r/coolgithubprojects](https://reddit.com/r/coolgithubprojects) |

---

## SEO for alianhub.com

Paste these into the `<head>` of your homepage and key landing pages.

### Core meta tags

```html
<!-- Primary Meta Tags -->
<title>AlianHub — Open-source project management you can self-host</title>
<meta name="title" content="AlianHub — Open-source project management you can self-host" />
<meta name="description" content="Open-source, self-hosted project management. Kanban, timesheets, custom fields, real-time. An alternative to Jira, Asana & Monday. AGPL-3.0." />

<!-- Open Graph / Facebook / LinkedIn -->
<meta property="og:type" content="website" />
<meta property="og:url" content="https://alianhub.com/" />
<meta property="og:title" content="AlianHub — Open-source project management you can self-host" />
<meta property="og:description" content="The open-source, self-hosted alternative to Jira, Asana, and Monday. Kanban, timesheets, AI, multi-tenant. AGPL-3.0." />
<meta property="og:image" content="https://alianhub.com/og-image.png" />

<!-- Twitter / X -->
<meta property="twitter:card" content="summary_large_image" />
<meta property="twitter:url" content="https://alianhub.com/" />
<meta property="twitter:title" content="AlianHub — Open-source project management you can self-host" />
<meta property="twitter:description" content="The open-source, self-hosted alternative to Jira, Asana, and Monday. Kanban, timesheets, AI, multi-tenant. AGPL-3.0." />
<meta property="twitter:image" content="https://alianhub.com/og-image.png" />

<!-- Canonical -->
<link rel="canonical" href="https://alianhub.com/" />
```

> ⚠️ **REQUIRED ASSET — does not yet exist:** You must create `og-image.png` and host it at `https://alianhub.com/og-image.png` **before submitting anywhere**. Without it, every share on Twitter, LinkedIn, Slack, Discord, and Facebook will show a blank or generic preview instead of a branded card.
>
> **Spec:** 1200×630 px, PNG, under 1 MB.
>
> **Quick way to create one:**
> 1. Take the existing `AlianHub_Main.png` hero screenshot as the base
> 2. Crop/resize the canvas to exactly 1200×630
> 3. Overlay the AlianHub logo (top-left corner, ~120×40 px)
> 4. Overlay the tagline "Open-source project management you can self-host" (large, centered-bottom)
> 5. Export as PNG, optimize with [tinypng.com](https://tinypng.com)
>
> **Tools:** [og-image.vercel.app](https://og-image.vercel.app) (free, programmatic), Canva, Figma, or Photoshop.
>
> **Verify after deploy:** paste the homepage URL into [opengraph.xyz](https://www.opengraph.xyz/) — the preview should show the new image, not a blank.

### schema.org structured data (for rich Google results)

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "AlianHub",
  "alternateName": "Alian Hub Project Management",
  "description": "Open-source, self-hosted project management system. Multi-tenant, real-time, with kanban, timesheets, custom fields, and AI assist. Alternative to Jira, Asana, Monday, Linear.",
  "applicationCategory": "BusinessApplication",
  "operatingSystem": "Linux, macOS, Windows (via Docker)",
  "url": "https://alianhub.com",
  "downloadUrl": "https://github.com/aliansoftwareteam/AlianHub-Project-Management-System",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "license": "https://www.gnu.org/licenses/agpl-3.0.html",
  "softwareVersion": "14.0.26",
  "author": {
    "@type": "Organization",
    "name": "Alian Software",
    "url": "https://aliansoftware.net"
  },
  "screenshot": "https://raw.githubusercontent.com/aliansoftwareteam/AlianHub-Project-Management-System/main/.gitbook/assets/screenshots/dashboard.png",
  "featureList": [
    "Kanban board view",
    "List view with bulk actions",
    "Calendar view",
    "Workload reporting",
    "Built-in timesheets",
    "Custom fields",
    "Role-based permissions",
    "Multi-tenant architecture",
    "AI-assisted task generation",
    "Real-time collaboration",
    "Self-hosted via Docker"
  ]
}
</script>
```

### Sitemap & robots.txt reminders

- Ensure `https://alianhub.com/sitemap.xml` exists and references key landing pages
- `robots.txt` should allow indexing of marketing pages but block the demo (so demo URL doesn't outrank the marketing site)

---

## Tracking checklist

Copy this into a project task (irony noted — eat your own dog food):

```
GitHub repo
- [ ] Add topics: self-hosted, mongodb, jira-alternative
- [ ] Add topics: asana-alternative, monday-alternative (optional)
- [ ] Enable Sponsors (if applicable)

Aggregators
- [ ] PR to awesome-selfhosted/awesome-selfhosted
- [ ] Submit to alternativeto.net + propose as alternative to Jira, Asana, Monday, Linear, ClickUp, Trello
- [ ] PR to opensource.builders
- [ ] Submit to LibHunt (or wait for auto-index)
- [ ] Submit to opensourceshowcase.com
- [ ] Submit to indiehackers.com

Launch posts
- [ ] Product Hunt — pick a Tue/Wed/Thu launch date, 2 weeks out
- [ ] Hacker News — Show HN post on launch day
- [ ] Reddit r/selfhosted post
- [ ] ~~Reddit r/projectmanagement~~ — skipped, see playbook (high mod-removal risk)
- [ ] Reddit r/opensource post
- [ ] Reddit r/coolgithubprojects post
- [ ] (optional) Reddit r/sysadmin or r/devops post for IT-led teams
- [ ] Dev.to launch article
- [ ] Cross-post to Hashnode, Medium

SEO (alianhub.com)
- [ ] **Create og-image.png** at 1200×630 px and host at https://alianhub.com/og-image.png (BLOCKER — every social share is blank without this)
- [ ] Apply meta tags to homepage <head>
- [ ] Apply schema.org SoftwareApplication markup
- [ ] Verify rendering at https://www.opengraph.xyz/?url=https://alianhub.com
- [ ] Submit sitemap to Google Search Console
- [ ] Submit sitemap to Bing Webmaster Tools

Maintenance
- [ ] Update awesome-selfhosted entry after each major release (version + feature changes)
- [ ] Refresh PR Hunt + alternativeto.net listings if branding changes
- [ ] Re-check GitHub topics after major feature adds
```

---

## Cadence

| Cadence | Action |
|---|---|
| **Once** | All aggregator submissions, all launch posts, SEO meta tags |
| **Per major release** | Update awesome-selfhosted entry, post release notes to Reddit r/selfhosted |
| **Quarterly** | Audit GitHub topics, refresh schema.org `softwareVersion`, refresh README badges |
| **Annually** | Re-submit to alternativeto.net (their algorithm boosts recently-updated listings) |

---

## What we deliberately skipped

| Channel | Why |
|---|---|
| Twitter/X ads | Wait until product-market fit; cold ads to OSS audience perform poorly |
| LinkedIn ads | Same — better organic via founder posts |
| Google Ads | Burns money before SEO matures; revisit when domain has authority |
| Influencer outreach | Requires established user wins / case studies first |
| Conference sponsorships | Too expensive for current stage |

---

## See also

- [REFERENCES.md](REFERENCES.md) — external resources and tools
- [BRANCHING.md](../BRANCHING.md) — release flow that feeds into "Per major release" cadence
- [SUPPORT.md](../SUPPORT.md) — what we point new users at
- [ROADMAP.md](../ROADMAP.md) — what to highlight in launch posts
- [PR #207](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/207) — license decision (AGPL-3.0) referenced in entries
