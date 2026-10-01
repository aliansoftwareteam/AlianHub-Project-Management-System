const base = require('@playwright/test');
const { loginAs, readState, storageStatePath } = require('./fixtures');
const { describeError, pageTrees, unexpectedErrors, watchConsole } = require('./consoleGuard');

const failed = (testInfo) => testInfo.status !== testInfo.expectedStatus;

const test = base.test.extend({
    // Playwright reads fixture dependencies from the destructuring pattern, so an empty one is required.
    // eslint-disable-next-line no-empty-pattern
    state: async ({}, use) => {
        await use(readState());
    },
    baseURL: async ({ state }, use) => {
        await use(state.baseURL);
    },
    loginAs: async ({ state }, use) => {
        await use((role) => loginAs(role, { state }));
    },
    // Both are switched on by the config of the suite that wants them, so the screenshot suite keeps its own rules.
    consoleGuard: [false, { option: true }],
    pageTreeOnFailure: [false, { option: true }],
    expectedConsoleErrors: [[], { option: true }],
    context: async ({ context, consoleGuard, pageTreeOnFailure, expectedConsoleErrors }, use, testInfo) => {
        const seen = watchConsole(context);
        await use(context);
        if (pageTreeOnFailure && failed(testInfo)) {
            const trees = await pageTrees(context);
            await testInfo.attach('page-tree', { body: trees, contentType: 'text/plain' });
            if (process.env.CI) console.log(`\n[page tree] ${testInfo.titlePath.slice(1).join(' › ')}\n${trees}\n`);
        }
        if (!consoleGuard) return;
        const unexpected = [...new Set(unexpectedErrors(seen, { expected: expectedConsoleErrors }).map(describeError))];
        base.expect(unexpected, 'console errors and uncaught errors in the page').toEqual([]);
    },
});

const asRole = (role) => ({ storageState: storageStatePath(role) });

module.exports = { test, expect: base.expect, asRole, storageStatePath };
