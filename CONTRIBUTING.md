# Contributing Guidelines

Thank you for your interest in contributing! 🎉  
We welcome contributions of all kinds — bug reports, features, refactors, and documentation.

Please read this guide carefully before submitting issues or pull requests.


## How to Contribute

### 1. Reporting Bugs
- Search existing issues before opening a new one
- Use the **Bug Report** issue form
- Provide clear reproduction steps

### 2. Suggesting Features
- Open a **Feature Request** issue
- Clearly explain the motivation and use case
- Be open to feedback and discussion

### 3. Submitting Pull Requests
- Fork the repository (external contributors) or branch directly (maintainers)
- Create a topic branch from the latest `beta` — **not** `main`
- Keep changes focused and minimal
- Open the PR against `beta` (not `main`); `beta` is promoted to `staging` and then `main`
- CI (`.github/workflows/ci.yml`) must be green: backend lint + Jest, frontend lint + Vitest + build

> 📘 See [BRANCHING.md](BRANCHING.md) for the full branching strategy, including hotfix and release workflows.


## Branch Naming Convention

Use the format `<type>/<short-kebab-case-description>`:

- `feat/user-notifications`
- `fix/login-validation`
- `refactor/api-layer`
- `chore/upgrade-deps`
- `docs/api-reference`
- `hotfix/payment-gateway-timeout` *(branched from `main`, not `staging`)*

Full list of accepted types and examples: [BRANCHING.md § Topic branches](BRANCHING.md#topic-branches).


## Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages and PR titles. CI enforces this automatically.

**Format:**

```
<type>(<optional-scope>): <short description>
```

**Examples:**

- `feat(workload-report): add weekly view`
- `fix(auth): correct JWT expiry handling`
- `docs(readme): add Docker quick start`
- `chore: bump dependencies`

**Accepted types:** `feat`, `fix`, `refactor`, `chore`, `docs`, `perf`, `test`, `ci`, `build`, `style`, `revert`.

See [`commitlint.config.js`](commitlint.config.js) for the full configuration. Run `npm run lint:commits` to check your commits locally before pushing.


## Testing Requirements
- All new features must include tests where applicable — helpers in `tests/<module>-rules.test.js`, UI in `frontend/tests/*.spec.js`
- Bug fixes should include regression coverage
- Refactors must not break existing tests
- Before pushing, run the same gate as CI:
  `npm run lint && npm test && (cd frontend && npm run lint -- --no-fix && npm test && npm run build)`
- The `conventions` Jest project fails on a new unguarded `/api/v2` prefix, a tenant id read from the request body, an undescribed environment variable, an orphaned `.vue` file, a `*V2` locale namespace or an unknown `t()` key — see [docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md)


## Code Style & Quality
- Follow existing code style and patterns; `npm run lint` must report 0 errors
- Avoid unnecessary dependencies
- Keep functions small and readable
- Comment only what the code cannot say (a non-obvious why); never narrate what the code does


## Pull Request Review Process
- All PRs require review before merging
- Maintainers may request changes
- Be respectful and responsive to feedback


## Code of Conduct
By participating, you agree to follow the project's **[Code of Conduct](../../CODE_OF_CONDUCT.md)**.

Thank you for helping make this project better 🚀
