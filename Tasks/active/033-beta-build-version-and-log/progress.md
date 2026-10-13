# Progress: Beta build version and log

## Checklist
- [x] Step 1–2: `scripts/build-info.js`, `version:stamp`, `version:log`, `version:show`
- [x] Step 3–4: runtime resolver and every version consumer
- [x] Step 5: Docker image stamped in `docker.yml`
- [x] Interface: Instance console → Stats → Version (extend) — owner and member sweep still to record
- [x] Interface: Instance console → Upgrade → builds since release (extend) — owner and member sweep still to record
- [x] Step 7: `CLAUDE.md` rule, `BRANCHING.md` section, first `docs/BETA-LOG.md`
- [ ] Exit gate met and gates green

## Log
| Date | Entry |
|---|---|
| 2026-09-11 | Filed after the owner saw Stats report v14.35.0 on a build 58 merges past it; owner chose derived beta build numbers over release-please prerelease or per-PR bumps. |
| 2026-09-11 | Frontend on `feat/033-build-version-ui`: Stats shows the build label with commit · channel · Node beneath; Upgrade shows the label on the chip and a "Builds since vX.Y.Z" card (newest 20, show all, PR and commit links); the rail and login read the label from public `GET /version` once per page load, falling back to `package.json`. Falls back cleanly against a backend without the new fields. vitest, i18n check, eslint and the frontend build green; owner and member sweep still to record. |
| 2026-09-11 | Backend on `feat/033-build-version`: `scripts/build-info.js` and the `version:*` scripts, `Config/buildInfo.js` resolver behind Instance stats and upgrade, `/health`, new `GET /version`, setup status, MCP server info, backups, migrations, changelog and public config; `docker.yml` stamps `build-info.json`; `CLAUDE.md` Rule 4, `BRANCHING.md` "Beta build numbers", first `docs/BETA-LOG.md` (59 builds, `14.36.0-beta.59` at 5716ca60). |
| 2026-09-11 | Merged and verified: `/version` and `/health` report `14.36.0-beta.61` at `d2cefe29`; in the browser, Stats shows `v14.36.0-beta.61` with `d2cefe29 · beta · v20.20.2`, and Upgrade shows the label, next release v14.36.0 and all 61 builds with PR and commit links. #582 became build 59, #583 became build 60, #584 became build 61. `docs/BETA-LOG.md` regenerated through build 61; this PR becomes build 62. |
| 2026-09-11 | #617 `c59b27be` (build 87): the resolver answers `git-pending` while git is slow, retries at 15 s, 60 s and 5 min, and takes `BUILD_INFO_GIT_TIMEOUT_MS`, so a loaded machine no longer reports the last release. `docs/BETA-LOG.md` regenerated through build 105 in the QA and Sprint 3 docs PR. |
| 2026-09-12 | Owner sweep on the local server at build 141, signed in as the instance owner (Local PM) with a one-hour session the owner authorised. Verified: Instance settings → AI shows the monthly budget, this month's spend, the 80% and 100% alert lines and the per-feature breakdown; Instance console → AI providers lists each provider and model with health, breaker state, calls, latency, last error, rate-limit budget and unpriced warnings, naming the node it answers for; Instance → Stats shows the build label with commit, channel and Node version; Instance → Upgrade lists builds since v14.35.0 with their pull requests; an agent's run detail shows TRACE, REPLAY with its redaction note, the PINNED revision and the revert control correctly disabled once the undo window has passed; the agent settings page shows revision history and a pinned-model selector listing only priced models, defaulting to the workspace routing policy. Not swept: the routing policy screen, which is being moved from the instance console into workspace settings. |
| 2026-09-12 | Stats and Upgrade swept by the owner at build 141: the build label with commit, channel and Node version, and every build since v14.35.0 with its pull request. The only outstanding item is confirming a Docker image built by `docker.yml` reports the stamped label. |

## Last step
Merged and verified locally. Remaining: the owner and member sweep of Stats and Upgrade, and a Docker image built by `docker.yml` confirming it reports the stamped label.
