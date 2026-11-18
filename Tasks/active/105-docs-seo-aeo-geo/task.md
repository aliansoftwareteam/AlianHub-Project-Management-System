---
id: 105
title: Docs site SEO, AEO and GEO — descriptions, canonical, social tags, structured data, robots.txt, llms.txt
status: active
priority: medium
depends_on: [088]
created: 2026-11-12
---

# Docs site SEO, AEO and GEO — descriptions, canonical, social tags, structured data, robots.txt, llms.txt

## Goal
An audit of https://docs.alianhub.com on 2026-11-12 found the pages well written and served as static HTML, but missing the metadata search engines, answer engines and AI assistants rely on. Give every page that metadata, generated from the Markdown so writers do nothing extra, and publish the files crawlers and AI tools look for.

## Audit findings this task fixes
- All 114 pages share one meta description (no page has `description` frontmatter).
- No canonical tag, while `/page.html` and `/page` both return 200.
- No Open Graph or Twitter tags and no share image.
- No structured data (JSON-LD).
- `/robots.txt`, `/llms.txt` and `/llms-full.txt` return 404.
- The 23 generated API pages have no `lastmod` in the sitemap.
- The home page title is only "AlianHub Docs".

## Scope
- `docs-site/.vitepress/` config and a helper module for the metadata.
- Per-page description: frontmatter `description` when present, otherwise the first prose paragraph of the page, cut to about 160 characters.
- Head tags on every page: canonical, Open Graph (title, description, url, type, image, site name, locale), Twitter card, `article:modified_time`.
- JSON-LD: Organization, WebSite and SoftwareApplication for AlianHub; TechArticle and BreadcrumbList per page; FAQPage built from the questions on `/help/faq`.
- A 1200×630 share image in `docs-site/public/`.
- `docs-site/public/robots.txt` allowing all crawlers, AI crawlers named explicitly, with the sitemap.
- `llms.txt` (sidebar-ordered index with descriptions), `llms-full.txt` (every page's Markdown) and a `.md` copy of each page, written at build time.
- Generated API pages take their last-updated date from `docs/API.md` in git.
- Home page title and description.
- This task folder and its row in `Tasks/index.md`.

## Out of scope
- Rewriting page content or adding new pages.
- Google Search Console or Bing Webmaster setup, sitemap submission (owner).
- The VitePress theme's sidebar markup (group titles render as `h2`).
- Per-page share images.
- Deploying; the site publishes from `main` through `.github/workflows/docs.yml`.

## Acceptance criteria
- `cd docs-site && npm run docs:build` succeeds with no dead links.
- Every built page has a unique meta description, a self-referencing canonical, Open Graph and Twitter tags and valid JSON-LD; `/help/faq` carries FAQPage with every question on the page.
- `dist/` contains `robots.txt`, `llms.txt`, `llms-full.txt` and a `.md` copy per page; every sitemap URL has a `lastmod`.
- Descriptions and FAQ answers match the visible page text.
