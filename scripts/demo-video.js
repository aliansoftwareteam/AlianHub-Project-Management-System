/* Records the product videos: boots the e2e harness against a disposable MongoDB with a scripted model,
 * fills the made-up "Northwind Studio" workspace, and films each scene with Playwright.
 * Usage: npm run demo:video [-- --only promo|howto] [-- --out <dir>] [-- --mongo-url <url>] [-- --serve] */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const argValue = (flag) => {
    const at = process.argv.indexOf(flag);
    return at === -1 ? null : process.argv[at + 1];
};

const MONGO_URL = argValue('--mongo-url') || 'mongodb://127.0.0.1:27018';
const LOOPBACK_URL = /^mongodb:\/\/(?:[^@/]*@)?(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/;
if (!LOOPBACK_URL.test(MONGO_URL) || /:27017(\/|$)/.test(MONGO_URL)) {
    process.stderr.write(`Refusing ${MONGO_URL}: the script drops every database it finds, so it only runs against a disposable MongoDB on this machine, never 27017.\n`);
    process.exit(1);
}
Object.assign(process.env, { E2E_MONGODB_URL: MONGO_URL });

const { resetDatabase, listCompanyIds } = require('../e2e/support/database');
const { startServer } = require('../e2e/support/server');
const { startScriptedModel } = require('./demo-video/scriptedModel');
const { seed } = require('./demo-video/seed');
const { ENC_KEY } = require('./demo-video/stage');

const log = (message) => process.stdout.write(`${message}\n`);

const SERVER_ENV = {
    MCP_TOOLS_WORK: 'on',
    MCP_TOOLS_MANAGE: 'on',
    APP_CONNECTIONS: 'on',
    DISPATCHER: 'on',
    CLOUD_STORAGE_ENC_KEY: ENC_KEY,
};

async function main() {
    await resetDatabase(MONGO_URL);
    const model = await startScriptedModel({ delayMs: 150 });
    const server = await startServer({ mongoUrl: MONGO_URL, logFile: path.join(os.tmpdir(), `demo-video-server-${process.pid}.log`), env: { ...SERVER_ENV, ...model.env } });
    const stop = async () => {
        const companyIds = await listCompanyIds(MONGO_URL).catch(() => []);
        await server.stop({ companyIds });
        await model.stop();
    };
    try {
        const world = await seed(server.baseURL);
        model.state.memberIds = world.people.map((p) => p.userId);
        log(`seeded ${world.companyId} on ${server.baseURL}`);
        if (process.argv.includes('--serve')) {
            fs.writeFileSync(path.join(os.tmpdir(), 'demo-video-world.json'), JSON.stringify({ baseURL: server.baseURL, companyId: world.companyId, projectId: world.project._id, lists: world.lists, tasks: world.tasks.map((t) => ({ _id: t._id, name: t.name, sprintId: t.sprintId })) }, null, 2));
            log('serving; Ctrl-C to stop');
            await new Promise((resolve) => process.once('SIGINT', resolve));
            return;
        }
        const { record } = require('./demo-video/record');
        await record({ world, model, out: path.resolve(argValue('--out') || path.join(os.homedir(), '.claude/projects/-Users-mevil-Alian-Hub/handoff', new Date().toISOString().slice(0, 10), 'videos')), only: argValue('--only') });
        if (model.state.unknown.length) log(`scripted model had no answer for: ${[...new Set(model.state.unknown)].join(' | ')}`);
    } finally {
        await stop();
    }
}

main().then(() => process.exit(0), (error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exit(1);
});
