const base = {
    testEnvironment: 'node',
    rootDir: __dirname,
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>/frontend/', '<rootDir>/time-tracker-app/', '<rootDir>/.claude/']
};

module.exports = {
    projects: [
        { ...base, displayName: 'unit', testMatch: ['<rootDir>/tests/*.test.js'] },
        { ...base, displayName: 'conventions', testMatch: ['<rootDir>/tests/conventions/*.test.js'] }
    ],
    maxWorkers: '50%',
    verbose: true
};
