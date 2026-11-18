---
id: 033
title: Beta build version and log — every merge is a numbered build
status: active
priority: high
depends_on: []
created: 2026-09-11
---

# 033 — Beta build version and log — every merge is a numbered build

Status: active · branch `feat/033-build-version` (from `beta`), backend and frontend as parallel PRs · owner decision 2026-09-11

## Goal
Anyone looking at a running AlianHub can tell exactly which build it is, and every update merged to `beta` has its own version number and a log entry, without changing how release-please cuts releases on `main`.

## Why
Instance → Stats showed `v14.35.0` on 2026-09-11 while `beta` was 58 merges and 266 commits past that tag. The running version is read from `package.json`, which only release-please bumps, and only when `staging` is promoted to `main`. Between releases the version is wrong by construction.

## Scope
1. `scripts/build-info.js`: derive the build from git. Base = the latest release tag (`vX.Y.Z`, no prerelease) reachable from `HEAD`. Build number = first-parent commits on the branch since that tag (a PR merge commit or a squash commit is one build). Next version = the base bumped by the Conventional Commits since the tag (breaking → major, `feat` → minor, otherwise patch), the same rule release-please applies. Label = `<next>-beta.<build>`, or the plain release when `HEAD` is the tag. Each build entry carries number, label, date, PR number (from `Merge pull request #N` or a trailing `(#N)`), title, type and short commit.
2. `npm run version:stamp` writes `build-info.json` (gitignored). `npm run version:log` regenerates `docs/BETA-LOG.md`, newest first. `npm run version:show` prints the current label.
3. A runtime resolver (`Config/buildInfo.js`): live from git when `.git` is present, otherwise from `build-info.json`, otherwise `package.json` as a release. Computed once at startup.
4. Every place that reports the running version uses the resolver: Instance stats, Instance upgrade info, `/health`, setup status, the MCP server info, backup names and manifests, and the app version recorded on applied migrations. The update check keeps comparing the release version from `package.json`.
5. Images: `docker.yml` fetches full history and runs `npm run version:stamp` before `docker build`; the Dockerfile copies `build-info.json` when present.
6. Interface rows below.
7. Process: `CLAUDE.md` gains a working-agreement rule and `BRANCHING.md` a "Beta build numbers" section. After merges to `beta`, `docs/BETA-LOG.md` is regenerated in the same follow-up docs PR that ticks task progress.

## Interface
| Area | Surface | State | Delivers |
|---|---|---|---|
| Instance | Instance console → Stats → Version | extend | The build label, with the commit, the channel and the Node version beneath it |
| Instance | Instance console → Upgrade | extend | The current build label on the version chip, and a "Builds since vX.Y.Z" list: number, date, PR link, title |

## Out of scope
- Any change to release-please, `release.yml`, `release-please-config.json`, `.release-please-manifest.json` or `CHANGELOG.md`.
- Hand-editing `package.json` versions per PR.
- `frontend/package.json`'s own version, which nothing reads at runtime.

## Acceptance
- [ ] On `beta` at 1247dbfe, `npm run version:show` prints `14.36.0-beta.58`, and Stats and Upgrade show the same label and commit.
- [ ] A test repository covers merge commits, squash commits with `(#N)`, a fix-only range (patch), a breaking change (major), `HEAD` on the tag (plain release), and the fallbacks with no git or no stamp.
- [ ] A Docker image built by `docker.yml` reports the stamped label, not `package.json`.
- [ ] `docs/BETA-LOG.md` lists all 58 builds since v14.35.0.
- [ ] Both interface rows swept by the owner and by a member.
- [ ] Gates: jest unit and conventions, vitest, `npm run i18n:check` after backfill, eslint 0 errors, frontend build.

## Decisions
- Owner, 2026-09-11: beta build numbers derived from git; release-please unchanged. Rejected: release-please prerelease on `beta` (changes the release workflow, back-merges conflict on version files) and hand bumps per PR (overwritten at release, conflicts between parallel PRs).
- The build number counts first-parent commits, so it is stable once merged and never needs a file edited in each PR.
