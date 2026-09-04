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
        {
            files: ['Modules/**/controller*.js'],
            rules: {
                'no-restricted-syntax': ['error',
                    {
                        selector: "CallExpression[callee.name='MongoDbCrudOpration'][arguments.0.type='Literal'][arguments.0.value!='global'], CallExpression[callee.property.name='MongoDbCrudOpration'][arguments.0.type='Literal'][arguments.0.value!='global']",
                        message: 'Scope the query to the request tenant (tenantOf(req) / tenantDb(req)) instead of a literal company id.'
                    },
                    {
                        selector: "CallExpression[callee.name='MongoDbCrudOpration'][arguments.0.type='Identifier'][arguments.0.name='undefined'], CallExpression[callee.property.name='MongoDbCrudOpration'][arguments.0.type='Identifier'][arguments.0.name='undefined']",
                        message: 'A query without a tenant reads the wrong database; pass the company id from tenantOf(req).'
                    }
                ]
            }
        },
        { files: ['**/*.mjs'], parserOptions: { sourceType: 'module' } }
    ]
};
