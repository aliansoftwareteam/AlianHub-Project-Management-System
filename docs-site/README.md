# AlianHub documentation site

The user, admin, developer and API documentation, built with [VitePress](https://vitepress.dev). It has its own dependencies, separate from the app.

```bash
cd docs-site
npm install
npm run docs:dev       # http://localhost:5173, reloads on save
npm run docs:build     # static site in .vitepress/dist; fails on a dead link
npm run docs:preview   # serve the build
```

- House style for writers: [STYLE.md](STYLE.md).
- Sidebar and navigation: `.vitepress/config.mjs`. A new page needs a sidebar entry there.
- The API section is generated from `../docs/API.md` by `scripts/build-api-reference.mjs` on every dev and build run, so it is not committed. Change the API docs at their source (`npm run api:doc` at the repo root), never under `api/`.
- Screenshots live in `public/screenshots/` as WebP at 1440×900. They were taken with `npm run atlas` (read-only) against the demo workspace with the demo banner hidden and English forced.
- Hosting: `.github/workflows/docs.yml` builds the site on every pull request that touches it and publishes it to GitHub Pages at https://docs.alianhub.com on each push to `main`. `public/CNAME` holds the domain.
