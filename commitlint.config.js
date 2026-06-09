/**
 * Commitlint configuration for AlianHub.
 *
 * Enforces the Conventional Commits standard on:
 *   - Every commit message (when wired to a local pre-commit hook)
 *   - Every commit in a pull request (CI: .github/workflows/commitlint.yml)
 *   - Every pull request title (CI: .github/workflows/commitlint.yml)
 *
 * Accepted types stay in sync with the branch-type prefixes documented in
 * BRANCHING.md → "Topic branches". Update both files together if you add a type.
 *
 * Docs:
 *   - Conventional Commits: https://www.conventionalcommits.org/
 *   - commitlint:          https://commitlint.js.org/
 *
 * Run locally:
 *   npm run lint:commits
 */
module.exports = {
    extends: ['@commitlint/config-conventional'],
    rules: {
        // Accepted types — keep in sync with BRANCHING.md § Topic branches.
        // `hotfix` and `release` are branch-only types — for commits within
        // a hotfix, use `fix`; for release prep, use `chore(release)`.
        'type-enum': [
            2, // error
            'always',
            [
                'build',    // Build system or external dependencies
                'chore',    // Maintenance: deps, config, license, repo housekeeping
                'ci',       // CI configuration
                'docs',     // Documentation only
                'feat',     // New feature
                'fix',      // Bug fix
                'perf',     // Performance improvement
                'refactor', // Code change that neither fixes a bug nor adds a feature
                'revert',   // Revert a previous commit
                'style',    // Formatting, whitespace (no code change)
                'test',     // Adding or fixing tests
            ],
        ],

        // Header (first line) length — generous to accommodate scope + description
        'header-max-length': [2, 'always', 100],

        // Subject (text after the colon) rules
        'subject-case': [
            2,
            'never',
            ['sentence-case', 'start-case', 'pascal-case', 'upper-case'],
        ],
        'subject-empty': [2, 'never'],
        'subject-full-stop': [2, 'never', '.'],

        // Type and scope must be lowercase
        'type-case': [2, 'always', 'lower-case'],
        'type-empty': [2, 'never'],
        'scope-case': [2, 'always', 'lower-case'],

        // Body and footer: warn-only on line length (Conventional Commits-tolerant)
        'body-max-line-length': [1, 'always', 200],
        'footer-max-line-length': [1, 'always', 200],
    },
};
