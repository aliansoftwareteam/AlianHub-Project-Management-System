const { chromium } = require('@playwright/test');
const { startHarness } = require('../support/harness');
const { assertOk, loginAs, writeState } = require('../support/fixtures');
const { saveStorageState } = require('../support/pages');

const idOf = (res, what) => String(assertOk(res, what).data._id);

/* The harness fixtures have a project and three tasks. The doc and dashboard screens need a
 * record each; names are fixed because they are in the screenshot. */
async function seedScreens(state) {
    const owner = await loginAs('owner', { state });
    const page = await owner.api.post('/api/v2/pages', { title: 'Release checklist', projectId: state.projects.shared._id });
    const dashboard = await owner.api.post('/api/v1/dashboards', { title: 'Delivery overview', visibility: 'private' });
    return { pageId: idOf(page, 'create the page'), dashboardId: idOf(dashboard, 'create the dashboard') };
}

module.exports = async () => {
    const startedAt = Date.now();
    const harness = await startHarness({ name: 'visual' });
    const browser = await chromium.launch();
    try {
        const state = { ...harness.state, visual: { startedAt, ...(await seedScreens(harness.state)) } };
        writeState(state);
        await saveStorageState(browser, state, 'owner');
    } catch (error) {
        await harness.stop();
        throw error;
    } finally {
        await browser.close();
    }
    return () => harness.stop();
};
