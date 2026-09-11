const base = require('@playwright/test');
const { loginAs, readState, storageStatePath } = require('./fixtures');

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
});

const asRole = (role) => ({ storageState: storageStatePath(role) });

module.exports = { test, expect: base.expect, asRole, storageStatePath };
