# 105 — progress

## Checklist
- [x] `docs-site/.vitepress/seo.mjs`: per-page description, canonical, Open Graph, Twitter, JSON-LD
- [x] FAQPage JSON-LD from the questions on `/help/faq`
- [x] Share image `docs-site/public/og-image.png` (1200×630)
- [x] `docs-site/public/robots.txt`
- [x] `llms.txt`, `llms-full.txt` and a `.md` copy per page at build time
- [x] Generated API pages carry `lastUpdated` from `docs/API.md`
- [x] Home page title and description
- [x] `npm run docs:build` passes; built pages checked
- [ ] Merge, then confirm on https://docs.alianhub.com after the next release to `main` (the site deploys from `main`)
- [ ] Owner: submit `sitemap.xml` in Google Search Console and Bing Webmaster Tools, then run the Rich Results Test on `/help/faq`

## Log
- 2026-11-12 — Task created from an SEO/AEO/GEO audit of the live site (all 114 pages share one description; no canonical, Open Graph, JSON-LD, robots.txt or llms.txt; API pages lack sitemap `lastmod`).
- 2026-11-12 — Built. `seo.mjs` hooks into `transformPageData` (description, head tags, JSON-LD), `transformHead` and `buildEnd` (llms files). Descriptions come from frontmatter `description`, else the first prose paragraph (topped up from the next paragraph or list when under 100 characters), cut at a sentence to 160. VitePress 1.6.4 writes its own description meta without escaping `"`, which broke 6 pages' attributes; `transformHead` now supplies the tag so it is escaped.
- 2026-11-12 — Verified on the build: 114/114 sitemap URLs with `lastmod`, 114 unique descriptions, canonical = sitemap URL on every page, Open Graph and Twitter tags on every page, one JSON-LD block per page that parses, FAQPage with 38 questions = 38 `h3` on the page, 113 `.md` copies, `llms.txt` 24 KB, `llms-full.txt` 1.2 MB. In the preview, client-side navigation swaps the canonical, description and JSON-LD with no duplicates and no console errors. ESLint clean on the changed files. Share image rendered with Playwright from a scratch HTML card (logo, title, tagline).
- Pages with short intros (under 90 characters): `api/identity`, `api/imports`, `api/pagination`, `api/whiteboards`, `user-guide/templates`, `user-guide/time-tracker-app`, `user-guide/import-from-clickup`, `admin/backups`. A `description:` in their frontmatter (or a longer section intro in `docs/API.md`) would give them fuller snippets. `api/stability` has no prose and falls back to "Stability. <site description>".

## Last step
Built and verified locally; nothing committed yet.
