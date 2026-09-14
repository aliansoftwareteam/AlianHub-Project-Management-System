const base = {
    testEnvironment: 'node',
    rootDir: __dirname,
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>/frontend/', '<rootDir>/time-tracker-app/', '<rootDir>/.claude/'],
    // The picker under frontend/src/views/Ai reads the same work-kind and input
    // vocabulary the server runs; webpack and vitest alias it the same way.
    moduleNameMapper: { '^@agentWork$': '<rootDir>/Modules/Agents/workKinds.js' }
};

module.exports = {
    projects: [
        { ...base, displayName: 'unit', testMatch: ['<rootDir>/tests/*.test.js'] },
        { ...base, displayName: 'conventions', testMatch: ['<rootDir>/tests/conventions/*.test.js'] },
        {
            ...base,
            displayName: 'integration',
            testMatch: ['<rootDir>/tests/integration/*.int.test.js'],
            globalSetup: '<rootDir>/tests/integration/globalSetup.js',
            globalTeardown: '<rootDir>/tests/integration/globalTeardown.js',
            setupFilesAfterEnv: ['<rootDir>/tests/integration/testTimeout.js']
        }
    ],
    maxWorkers: '50%',
    verbose: true
};
