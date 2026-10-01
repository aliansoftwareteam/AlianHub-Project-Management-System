const base = {
    testEnvironment: 'node',
    rootDir: __dirname,
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>/frontend/', '<rootDir>/time-tracker-app/', '<rootDir>/.claude/']
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
    // A worker that grows past this is replaced between files; without it one long-lived worker ran out of heap in CI.
    workerIdleMemoryLimit: '1500MB',
    verbose: true
};
