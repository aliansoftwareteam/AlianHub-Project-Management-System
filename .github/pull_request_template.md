<!--
🎉 Thanks for contributing to AlianHub!

📋 Before opening this PR, please confirm:
  1. PR title follows Conventional Commits: <type>(<optional-scope>): <description>
     ✅ feat(workload-report): add weekly view
     ✅ fix(auth): correct JWT expiry handling
     ❌ Added a new report (no type prefix)
     ❌ feat: Added new report (subject starts with uppercase)
  2. Branch name follows <type>/<kebab-description> — see BRANCHING.md
  3. Target branch is `staging` (NOT `main` — hotfixes are the only exception)

📝 Want a more detailed template? Open this PR using one of:
   • ?expand=1&template=new_feature.md
   • ?expand=1&template=bug_fix.md
   • ?expand=1&template=refactor.md
-->

## Summary

<!-- 1–3 sentences: what does this PR do, and why? -->

## Type of change

<!-- Check all that apply. The first one should match your PR title prefix.
     Note: `hotfix` is a branch-type only — for PR title and commit messages on
     hotfix branches, use `fix` as the type. -->

- [ ] 🚀 `feat` — New feature
- [ ] 🐛 `fix` — Bug fix (use this for `hotfix/*` branches too)
- [ ] ♻️ `refactor` — Code refactor (no behavior change)
- [ ] 🔧 `chore` — Build / config / deps / housekeeping
- [ ] 📘 `docs` — Documentation only
- [ ] ⚡ `perf` — Performance improvement
- [ ] 🧪 `test` — Adding or fixing tests
- [ ] 🤖 `ci` — CI configuration
- [ ] 📦 `build` — Build system changes
- [ ] 🎨 `style` — Formatting only (no code change)

## Related issue

<!-- Link the issue this PR closes (or relates to). Delete if not applicable. -->

Closes #<issue_number>

## Test plan

<!-- How can a reviewer verify this works? Be concrete with steps and expected results. -->

- [ ] …
- [ ] …

## Screenshots / demo

<!-- For UI changes: drag-drop screenshots, GIFs, or short videos. Delete if not applicable. -->

## Breaking changes

<!-- Check one. -->

- [ ] ❌ No breaking changes
- [ ] ⚠️ Yes — described below with migration steps

## Checklist

- [ ] PR title follows [Conventional Commits](https://www.conventionalcommits.org/) (`<type>: <description>`)
- [ ] Branch name follows `<type>/<kebab-description>` (see [BRANCHING.md](../BRANCHING.md))
- [ ] PR targets the correct branch (`staging` for most work; `main` only for `hotfix/*` or `release/v*`)
- [ ] All existing tests pass locally (`npm test`)
- [ ] New tests added for new behavior (if applicable)
- [ ] Documentation updated (README / CLAUDE.md / inline comments) where relevant
- [ ] I have performed a self-review of my changes
- [ ] I have read the [Contributing Guidelines](../CONTRIBUTING.md) and [Code of Conduct](../CODE_OF_CONDUCT.md)

## Notes for reviewers

<!-- Anything reviewers should know? Trade-offs, follow-ups, areas needing extra eyes. Delete if not applicable. -->
