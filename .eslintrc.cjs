module.exports = {
    root: true,
    env: { node: true, es2022: true },
    parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
    extends: ['eslint:recommended'],
    ignorePatterns: [
        'frontend/',
        'installation/',
        'time-tracker-app/',
        'log/',
        'logs/',
        'node_modules/',
        'public/',
        'storage/',
        'wasabiUploadsLocal/',
        'under-maintenance/',
        '.claude/',
        'coverage/'
    ],
    rules: {
        'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
        'no-empty': ['error', { allowEmptyCatch: true }],
        'no-async-promise-executor': 'warn'
    },
    overrides: [
        { files: ['tests/**/*.js', '**/*.test.js'], env: { jest: true } },
        { files: ['**/*.mjs'], parserOptions: { sourceType: 'module' } }
    ]
};
