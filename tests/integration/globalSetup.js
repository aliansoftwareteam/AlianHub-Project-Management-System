const { startHarness } = require('../../e2e/support/harness');

module.exports = async () => {
    globalThis.__E2E_HARNESS__ = await startHarness({ name: 'integration' });
};
