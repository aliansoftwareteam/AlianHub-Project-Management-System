# Progress: Beta build version and log

## Checklist
- [ ] Step 1–2: `scripts/build-info.js`, `version:stamp`, `version:log`, `version:show`
- [ ] Step 3–4: runtime resolver and every version consumer
- [ ] Step 5: Docker image stamped in `docker.yml`
- [x] Interface: Instance console → Stats → Version (extend)
- [x] Interface: Instance console → Upgrade → builds since release (extend)
- [ ] Step 7: `CLAUDE.md` rule, `BRANCHING.md` section, first `docs/BETA-LOG.md`
- [ ] Exit gate met and gates green

## Log
| Date | Entry |
|---|---|
| 2026-09-11 | Filed after the owner saw Stats report v14.35.0 on a build 58 merges past it; owner chose derived beta build numbers over release-please prerelease or per-PR bumps. |
| 2026-09-11 | Frontend on `feat/033-build-version-ui`: Stats shows the build label with commit · channel · Node beneath; Upgrade shows the label on the chip and a "Builds since vX.Y.Z" card (newest 20, show all, PR and commit links); the rail and login read the label from public `GET /version` once per page load, falling back to `package.json`. Falls back cleanly against a backend without the new fields. vitest, i18n check, eslint and the frontend build green; owner and member sweep still to record. |

## Last step
Interface rows built against the shared contract; waiting on the backend PR on `feat/033-build-version`, then the owner and member sweep.
