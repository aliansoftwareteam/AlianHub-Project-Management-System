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
- Create a topic branch from the latest `staging` — **not** `main`
- Keep changes focused and minimal
- Open the PR against `staging` (not `main`)

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


## Testing Requirements
- All new features must include tests where applicable
- Bug fixes should include regression coverage
- Refactors must not break existing tests


## Code Style & Quality
- Follow existing code style and patterns
- Avoid unnecessary dependencies
- Keep functions small and readable
- Comment complex logic where necessary


## Pull Request Review Process
- All PRs require review before merging
- Maintainers may request changes
- Be respectful and responsive to feedback


## Code of Conduct
By participating, you agree to follow the project's **[Code of Conduct](../../CODE_OF_CONDUCT.md)**.

Thank you for helping make this project better 🚀
