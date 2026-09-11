const path = require('node:path');
const { listCompanyIds, resetDatabase } = require('./database');
const { STATE_DIR, resolveMongoUrl } = require('./env');
const { STATE_FILE, createFixtures, writeState } = require('./fixtures');
const { startServer } = require('./server');

/* One server and one fixture set per run of a layer. The database is wiped first:
 * the setup wizard only runs on an empty instance. */
async function startHarness({ name }) {
    const mongoUrl = resolveMongoUrl();
    await resetDatabase(mongoUrl);
    const server = await startServer({ mongoUrl, logFile: path.join(STATE_DIR, `${name}-server.log`) });

    const stop = async () => {
        const companyIds = await listCompanyIds(mongoUrl).catch(() => []);
        await server.stop({ companyIds });
    };

    try {
        const state = await createFixtures(server.baseURL);
        writeState(state);
        process.env.E2E_BASE_URL = server.baseURL;
        process.env.E2E_STATE_FILE = STATE_FILE;
        return { state, server, stop };
    } catch (error) {
        await stop();
        throw new Error(`${error.message}\nServer log: ${server.logFile}`);
    }
}

module.exports = { startHarness };
