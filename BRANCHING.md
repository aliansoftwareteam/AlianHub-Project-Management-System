# Branching Strategy

AlianHub uses a **three-branch model** with a clear separation between stable releases, the pre-release line and active development. This guide documents how branches flow, what each branch is for, and how contributors should work with them.

---

## TL;DR

| Branch | Purpose | Stability | Direct push? |
|---|---|---|---|
| `main` | Stable, public-facing | Production-ready | ❌ PR + review only |
| `staging` | Pre-release, deployed to the demo/staging server | Release candidate | ❌ PR + CI only |
| `beta` | Active development — where topic branches land | Work in progress, always green | ❌ PR + CI only |
| `<type>/<desc>` | Feature / fix / chore branches | Work in progress | ✅ Your branch |

- **Internal contributors** → branch off `beta` → PR back to `beta`
- **External contributors** → fork → branch off `beta` → PR back to `beta`
- **Promotion** → `beta` → `staging` (deploys the demo server) → `main` (release)
- **Production hotfixes** → branch off `main` → PR to `main` → backport to `staging` and `beta`

**CI gate.** `.github/workflows/ci.yml` runs on every pull request and push to `beta`, `staging` and `main`: backend `npm run lint` + `npm test`, frontend lint + `npm test` (Vitest) + `npm run build`. A red check blocks the merge; see [docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md) for what each job checks. The sections below describe the `staging → main` promotion; `beta → staging` follows the same PR-with-merge-commit rule.

---

## Branch flow

```
                    ┌─────────────────┐
                    │      main       │  ◄── stable, production, tagged releases
                    │   (protected)   │
                    └────────▲────────┘
                             │  promoted at release time
                             │
                    ┌────────┴────────┐
                    │     staging     │  ◄── active development (base for all work)
                    │   (protected)   │
                    └────────▲────────┘
                             │  PRs from topic branches
                ┌────────────┼────────────┐
                │            │            │
        feat/widget   fix/login-bug   chore/cleanup
        (your work)   (your work)     (your work)
```

---

## Long-running branches

### `main`
- The **stable**, public-facing branch.
- Every commit on `main` corresponds to a **tagged release** (`v14.x.x`).
- Updated only by:
  - Promotion (merge) from `staging` at release time, **or**
  - `hotfix/*` PRs for urgent production fixes.
- **Never** push directly to `main`.
- Protected: requires PR + 1 approving review + green CI + linear history.

### `staging`
- The **active development** branch — the base for all new work.
- All `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`, `perf/`, `test/`, `ci/`, `build/`, `style/` PRs target `staging`.
- Should always be deployable to the demo / staging environment.
- Protected: requires PR + green CI. Maintainers can self-merge (no second reviewer required), but force-push is blocked.

---

## Topic branches

All work happens on short-lived **topic branches** that target `staging` (or `main` for hotfixes).

### Naming convention

```
<type>/<short-kebab-case-description>
```

| Type | Use for | Example |
|---|---|---|
| `feat/` | New features | `feat/employee-workload-report-widget` |
| `fix/` | Bug fixes | `fix/login-validation-error` |
| `hotfix/` | Urgent production fixes (branch from `main`) | `hotfix/payment-gateway-timeout` |
| `refactor/` | Code refactoring (no behavior change) | `refactor/auth-helper-extract` |
| `chore/` | Build, config, license, deps | `chore/relicense-to-agpl-3.0` |
| `docs/` | Documentation only | `docs/branching-strategy` |
| `perf/` | Performance improvements | `perf/task-list-query` |
| `test/` | Adding or fixing tests | `test/auth-helper-coverage` |
| `ci/` | CI configuration changes | `ci/add-release-workflow` |
| `build/` | Build system changes | `build/upgrade-webpack` |
| `style/` | Formatting only | `style/prettier-config` |

> Keep descriptions short, kebab-case, and informative. Avoid issue numbers in the branch name — link them in the PR description instead.

### Lifecycle

1. **Create** from the latest `staging`:
   ```bash
   git checkout staging
   git pull
   git checkout -b feat/your-feature
   ```
2. **Commit** following [Conventional Commits](https://www.conventionalcommits.org/) (see PR & branch name formats — coming in step 3 of the OSS baseline).
3. **Push** with upstream tracking:
   ```bash
   git push -u origin feat/your-feature
   ```
4. **Open PR** targeting `staging` (or `main` for hotfixes).
5. **Delete** the branch after merge (GitHub auto-deletes on merge if enabled in repo settings).

---

## Pull Request workflow

### Where do PRs target?

| Branch type | PR base |
|---|---|
| `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`, `perf/`, `test/`, `ci/`, `build/`, `style/` | `staging` |
| `hotfix/` | `main` (and backported to `staging` after merge) |
| `release/v*` | `main` (cut from `staging`) |

### Requirements (enforced via branch protection)

**For PRs into `main`:**
- ✅ 1 maintainer approval required
- ✅ All CI checks passing
- ✅ No merge conflicts
- ✅ Conventional Commit format in PR title
- ✅ **Merge method — the `staging → main` promotion MUST use a _merge commit_** (not squash, not rebase) so every `feat`/`fix` commit lands on `main` and release-please can read them and cut the release automatically. Squashing collapses the whole promotion into a single `chore` commit, which starves release-please and forces a manual release cut. (Hotfix PRs into `main` may squash.)
- ✅ Conversation resolution required

**For PRs into `staging`:**
- ✅ All CI checks passing
- ✅ No merge conflicts
- ✅ Conventional Commit format in PR title
- 🟡 Self-merge allowed for maintainers (no required reviewer)

---

## Hotfix workflow

For urgent production bugs that can't wait for the next `staging → main` promotion:

1. Branch from `main`:
   ```bash
   git checkout main
   git pull
   git checkout -b hotfix/short-description
   ```
2. Fix, commit, push. Open PR **targeting `main`**.
3. After review and merge, backport to `staging`:
   ```bash
   git checkout staging
   git pull
   git cherry-pick <hotfix-commit-sha>
   git push
   ```
   *(Or open a separate `hotfix-backport/<name>` PR → `staging`.)*
4. Tag a patch release on `main` (e.g., `v14.0.27` → `v14.0.28`).

---

## Release workflow (`staging` → `main`)

Releases happen **on demand** when `staging` is stable and ready to ship. There is no fixed cadence — release when there is meaningful value to ship (typically every 1–4 weeks).

Versioning, the `CHANGELOG.md`, the git tag, and the GitHub Release are all cut **automatically by release-please** — **provided the promotion is merged with a merge commit.** A squashed promotion hides the Conventional Commits from release-please and produces no release (this was the cause of releases silently not being tagged through v14.4.0).

### Steps

1. Verify all PRs intended for the release are merged into `staging`, and CI is green on `staging` HEAD.
2. Open the promotion PR: base **`main`**, head **`staging`**. Title: `chore(release): promote staging to main`.
   - Head = `staging` (not a `release/v*` branch) keeps it exempt from the per-commit commitlint job, which would otherwise fail on legacy commit subjects.
3. After approval + green CI, merge it with **"Create a merge commit" — never squash, never rebase.** This brings every `feat`/`fix` commit onto `main`.
4. release-please runs on the push to `main` and **opens a Release PR** (`chore: release main`) that bumps `package.json` + `.release-please-manifest.json` and writes the `CHANGELOG.md` section from the commits.
5. Review and **merge the Release PR.** release-please then **creates the `v14.x.x` tag and the GitHub Release automatically** — no manual tagging or changelog editing.
6. **Back-merge `main → staging`** via a `chore/backmerge-main-vX.Y.Z` branch, **merged with a merge commit (never squash)**, so staging carries the version bump and stays an ancestor of `main`.

> ⚠️ **Never squash or rebase the `staging → main` promotion.** A merge commit is what makes the entire release automatic; squashing it silently breaks release-please and forces the manual fallback below.

### Manual fallback (only if a release was missed)

If a promotion was squashed by mistake and no release was cut: run `gh release create vX.Y.Z --target main --notes-file <notes>`, then open a `chore(release): vX.Y.Z` PR bumping `package.json` / `.release-please-manifest.json` / `CHANGELOG.md`, then back-merge `main → staging`.

---

## External contributors

External contributors do **not** have push access to the upstream repo. The workflow is fork-based:

1. **Fork** the repo on GitHub.
2. **Clone** your fork:
   ```bash
   git clone https://github.com/<your-username>/AlianHub-Project-Management-System.git
   cd AlianHub-Project-Management-System
   git remote add upstream https://github.com/aliansoftwareteam/AlianHub-Project-Management-System.git
   ```
3. **Sync** your fork's `staging` with upstream:
   ```bash
   git fetch upstream
   git checkout staging
   git merge upstream/staging
   git push origin staging
   ```
4. **Branch** off `staging`:
   ```bash
   git checkout -b feat/your-feature
   ```
5. **Commit, push, open PR** from your fork's branch → upstream's `staging`.

---

## Protected branch rules

The following rules are enforced via GitHub branch protection. Admins should not bypass these except in genuine emergencies (and document the override in the next commit).

### `main`
- ❌ Direct pushes blocked
- ❌ Force push blocked
- ❌ Branch deletion blocked
- ✅ PR required
- ✅ 1 approving review required
- ✅ All status checks must pass
- ✅ Branches must be up to date before merging
- ✅ Linear history required (squash or rebase merge only)
- ✅ Conversation resolution required

### `staging`
- ❌ Direct pushes blocked (maintainers must use PRs)
- ❌ Force push blocked
- ❌ Branch deletion blocked
- ✅ PR required
- ✅ All status checks must pass
- 🟡 No required reviewer (maintainer self-merge OK)

---

## How to enable branch protection (one-time setup)

Run these from a terminal with the GitHub CLI (`gh`) authenticated as a repo admin:

```bash
# main: require PR + 1 review + status checks + linear history
gh api -X PUT repos/aliansoftwareteam/AlianHub-Project-Management-System/branches/main/protection \
  --input - <<'EOF'
{
  "required_status_checks": { "strict": true, "contexts": [] },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
EOF

# staging: require PR + status checks, no required reviewer
gh api -X PUT repos/aliansoftwareteam/AlianHub-Project-Management-System/branches/staging/protection \
  --input - <<'EOF'
{
  "required_status_checks": { "strict": true, "contexts": [] },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

After step 4 (release process) sets up CI, populate `required_status_checks.contexts` with the actual check names (e.g., `["build", "test", "lint"]`).

---

## Cheatsheet

```bash
# Start a new feature
git checkout staging && git pull
git checkout -b feat/your-feature-name

# Start a hotfix
git checkout main && git pull
git checkout -b hotfix/your-fix-name

# Sync your branch with the latest staging (preferred: rebase)
git fetch origin
git rebase origin/staging

# Push and open PR
git push -u origin feat/your-feature-name
gh pr create --base staging --fill

# After merge, clean up local branch
git checkout staging && git pull
git branch -d feat/your-feature-name
```

---

## FAQ

**Q: Why two branches instead of GitHub Flow (just `main`)?**
A: AlianHub is a self-hosted product with paying users. We need a stable branch that represents "what is in production" separate from "what is being worked on." `main` = released, `staging` = pre-release.

**Q: Why not GitFlow with `develop`?**
A: GitFlow's `develop`/`release`/`master` triple is over-engineered for a single-repo product. Two branches give us the same safety with half the ceremony.

**Q: Can I merge directly to `main` to skip the staging step?**
A: No. Only `hotfix/*` and `release/v*` branches target `main`. Everything else goes through `staging` first so it's been deployed to the demo environment and exercised.

**Q: How often is `staging` promoted to `main`?**
A: On demand, when there's meaningful value to ship. Typically every 1–4 weeks. Maintainers decide.

**Q: What if my PR has been sitting in `staging` for weeks and now conflicts with `main`?**
A: Rebase your branch onto the latest `staging`, resolve conflicts, force-push your branch (allowed on your own topic branch — only `main`/`staging` block force-pushes), and re-request review.

---

## See Also

- [CONTRIBUTING.md](CONTRIBUTING.md) — Contribution guidelines
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Community standards
- [SECURITY.md](SECURITY.md) — Security reporting policy
- Plane's reference: https://github.com/makeplane/plane (uses `master` + `preview` — same two-branch idea, different names)
