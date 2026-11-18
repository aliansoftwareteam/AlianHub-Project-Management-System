# Branches, versions and releases

AlianHub has two long-running branches. All work lands on `staging`, which is deployed to the staging server on every merge; `main` holds tagged releases. Every merge into `staging` becomes a numbered build, and releases are cut by release-please from Conventional Commits. This page explains the branches, how the version is derived, what the docs pull request after a merge must do, and the release steps.

## Branches

| Branch | Purpose | How it changes |
|---|---|---|
| `main` | Stable, public releases. Every commit is a tagged release (`v14.x.x`) | Only by promoting `staging`, or a `hotfix/*` pull request. Needs one approval and green CI |
| `staging` | Active development; the base for all work. Every merge deploys the staging server (`.github/workflows/main.yml`) | Pull requests with green CI. Maintainers may self-merge. No force push |
| `<type>/<description>` | Your topic branch | Yours. Branch from `staging` (from `main` for a hotfix) |

```
           main      ◄── tagged releases
             ▲  promoted at release time (merge commit)
             │
          staging    ◄── every merge is a build, deployed to the staging server
             ▲
   ┌─────────┼──────────┐
feat/...   fix/...   chore/...
```

The `beta` branch was retired on 2026-10-14; nothing branches from it or targets it.

## The version is derived from git

`package.json` only changes when release-please cuts a release. Between releases the running version is computed:

- **Label:** `<next>-beta.<build>`, for example `14.36.0-beta.59`. A checkout sitting on a release tag reports the plain release (`14.35.0`).
- **Build:** the number of first-parent commits on the branch since the latest `vX.Y.Z` tag. Every pull request merged into `staging` is one build, and its number never changes once merged.
- **Next:** the latest tag bumped by the Conventional Commits since it: a breaking change (`!` or `BREAKING CHANGE`) is major, `feat` is minor, anything else is a patch.
- **Where it shows:** the Instance console (Stats and Upgrade), `/health`, `GET /version`, the setup status, the MCP server info, backup names and manifests, and the version recorded on each migration.
- **Docker images** have no `.git`, so `.github/workflows/docker.yml` stamps `build-info.json` before the build, and the server reads that.

| Command | What it does |
|---|---|
| `npm run version:show` | Prints the current version (`scripts/build-info.js`) |
| `npm run version:stamp` | Writes `build-info.json` |
| `npm run version:log` | Regenerates `docs/BETA-LOG.md` from the history of `origin/staging` |

Never edit the version by hand. Only release-please edits `package.json` and `CHANGELOG.md`.

## After merging into `staging`: the docs pull request

Generated files are not touched by feature pull requests, so two pull requests that each add a route cannot conflict or break `staging`. After one or more merges, a follow-up `docs` pull request into `staging`:

1. Runs `npm run version:log` and commits `docs/BETA-LOG.md`, naming the build numbers those merges became. The docs pull request itself becomes the next build.
2. Ticks the task progress in `Tasks/` (`progress.md`).
3. If a merge added or changed a route: describes it in `scripts/api-doc.meta.json`, runs `npm run api:doc`, and commits `docs/API.md` and `docs/api/openapi.json`. `npm run api:doc:check` fails while they are stale.
4. If a merge added an environment variable: runs `node scripts/env-doc.js` and commits `docs/ENV.md`, `.env.example` and `frontend/.env.example`. `npm run env:doc:check` fails while they are stale.

`docs/BETA-LOG.md` lists each build with its version, date, pull request and title. Do not edit it by hand.

## Releasing (`staging` to `main`)

Releases happen on demand, when `staging` is stable and there is value to ship (typically every one to four weeks).

1. Check that everything intended for the release is merged into `staging` and CI is green on its head.
2. Open the promotion pull request: base `main`, head `staging`, title `chore(release): promote staging to main`.
3. After approval and green CI, merge it with **Create a merge commit**.
4. release-please runs on the push to `main` and opens a Release pull request (`chore: release main`) that bumps `package.json` and `.release-please-manifest.json` and writes the `CHANGELOG.md` section from the commits.
5. Merge the Release pull request. release-please creates the `vX.Y.Z` tag and the GitHub Release.
6. Back-merge `main` into `staging` through a `chore/backmerge-main-vX.Y.Z` branch, again with a merge commit, so `staging` carries the version bump and the new tag is reachable from it. Until this is done, `staging` keeps counting builds from the previous tag.

::: warning Never squash or rebase the promotion
The merge commit is what brings every `feat` and `fix` commit onto `main`. A squashed promotion hides them from release-please and no release is cut. If that happens, create the release by hand (`gh release create vX.Y.Z --target main --notes-file <notes>`), open a `chore(release): vX.Y.Z` pull request that bumps `package.json`, `.release-please-manifest.json` and `CHANGELOG.md`, then back-merge `main` into `staging`.
:::

## Hotfixes

For an urgent production bug that cannot wait for the next promotion:

1. Branch `hotfix/<short-description>` from `main`.
2. Fix, commit with a `fix:` message, and open a pull request into `main`. Hotfix pull requests may be squashed.
3. After the merge, backport to `staging` with `git cherry-pick <sha>` or a `hotfix-backport/<name>` pull request.
4. Release the patch.

## Related

- [Contributing](./contributing)
- [Conventions](./conventions)
- [Upgrades](/admin/upgrades)
- [Changelog](/help/changelog)
