# Contributing

AlianHub welcomes bug reports, features, refactors and documentation. This page covers how to report an issue, how a change goes from a fork to `staging`, and what review expects. It summarises `CONTRIBUTING.md`, `BRANCHING.md` and `CODE_OF_CONDUCT.md` in the repository.

## Report a bug or ask for a feature

- Search the [issues](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues) first.
- Use the **Bug Report** issue form, with clear steps to reproduce.
- For a feature, open a **Feature Request** and explain the motivation and the use case.
- Security problems are not filed as issues; follow `SECURITY.md`.

## Plan before you build

Match the ceremony to the change:

- **Trivial** (a typo, a one-line fix, a rename, a copy or style tweak): just do it.
- **Non-trivial** (a new feature, a change across modules, anything ambiguous or architectural): restate the goal, answer what you can from the code, ask only what is genuinely open, and write the plan as `task.md` (goal, scope, out of scope, acceptance criteria) under `Tasks/`. Confirm it before building, and keep `progress.md` up to date as you go. `Tasks/README.md` describes the folders.

## Make the change

### External contributors: fork

```bash
git clone https://github.com/<your-username>/AlianHub-Project-Management-System.git
cd AlianHub-Project-Management-System
git remote add upstream https://github.com/aliansoftwareteam/AlianHub-Project-Management-System.git

git fetch upstream
git checkout staging
git merge upstream/staging
git checkout -b feat/your-feature
```

Maintainers branch directly in the main repository.

### Branch from `staging`

All work starts from the latest `staging`, never `main`. Name the branch `<type>/<short-kebab-case-description>`:

| Type | Use for | Example |
|---|---|---|
| `feat/` | New features | `feat/employee-workload-report-widget` |
| `fix/` | Bug fixes | `fix/login-validation-error` |
| `hotfix/` | Urgent production fixes, branched from `main` | `hotfix/payment-gateway-timeout` |
| `refactor/` | No behaviour change | `refactor/auth-helper-extract` |
| `chore/` | Build, config, licence, dependencies | `chore/upgrade-deps` |
| `docs/` | Documentation only | `docs/api-reference` |
| `perf/` | Performance | `perf/task-list-query` |
| `test/` | Tests | `test/auth-helper-coverage` |
| `ci/` | CI configuration | `ci/add-release-workflow` |
| `build/` | Build system | `build/upgrade-webpack` |
| `style/` | Formatting only | `style/prettier-config` |

Keep names short and leave issue numbers out; link the issue in the pull request instead. `.github/workflows/branch-name.yml` checks the name.

### Commit

Every commit and the pull request title follow Conventional Commits (`<type>(<scope>): <description>`), checked by commitlint in `.github/workflows/commitlint.yml`. See [Conventions](./conventions#commit-messages-and-pr-titles). Check locally with `npm run lint:commits`.

### Test

New features include tests where they apply: helpers in `tests/<module>-rules.test.js`, UI in `frontend/tests/*.spec.js`. Bug fixes include a regression test. Before pushing, run the CI gate:

```bash
npm run lint && npm test && (cd frontend && npm run lint -- --no-fix && npm test && npm run build)
```

See [Testing](./testing).

## Open the pull request

| Branch | Pull request into |
|---|---|
| `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`, `perf/`, `test/`, `ci/`, `build/`, `style/` | `staging` |
| `hotfix/` | `main`, then backported to `staging` |

```bash
git push -u origin feat/your-feature
gh pr create --base staging --fill
```

- Keep it focused and small.
- CI must be green: lint, Jest, Vitest, the frontend build, and the integration and browser shards.
- A pull request into `staging` needs green CI and no conflicts; maintainers may self-merge. A pull request into `main` also needs one maintainer's approval and resolved conversations.
- A feature pull request does not touch `docs/API.md`, `docs/api/openapi.json` or `docs/BETA-LOG.md`; those are regenerated in the docs pull request after the merge. See [Branches, versions and releases](./releases).
- To bring your branch up to date, rebase onto `origin/staging` and force-push your own branch. Only `main` and `staging` block force pushes.

## Review

All pull requests are reviewed before merging. Maintainers may ask for changes; be respectful and responsive. Reviewers look for the rules in [Conventions](./conventions): tenant scoping, socket events and cache clearing after writes, i18n, tokens, minimal comments, and tests.

## Code of conduct

Everyone taking part agrees to `CODE_OF_CONDUCT.md`: be kind, respect differing views, give and accept feedback gracefully, take responsibility for mistakes. Harassment, insults, personal or political attacks, and publishing someone's private information are not accepted. Maintainers may remove, edit or reject contributions that do not follow it.

## Licence

AlianHub is released under the AGPL-3.0 (`LICENSE` in the repository).

## Related

- [Local setup](./local-setup)
- [Conventions](./conventions)
- [Branches, versions and releases](./releases)
- [Getting help](/help/support)
