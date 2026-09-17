// Run as a child process (node tests/fixtures/performanceReadProbe.js) so the time zone
// it runs under is the one the process started with. Prints what performance.read
// answered for the agile seed as JSON.

const Module = require('module');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

global.jest = { fn: (impl) => impl || (() => undefined) };
const db = require('./fakeMongo').create();

const stub = (relative, exports) => {
    const file = require.resolve(path.join(ROOT, relative));
    const m = new Module(file);
    m.filename = file;
    m.loaded = true;
    m.exports = exports;
    require.cache[file] = m;
};

stub('utils/mongo-handler/mongoQueries', { MongoDbCrudOpration: (...a) => db.crud(...a) });
stub('Config/config', { myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } });
stub('Config/loggerConfig', { info: () => {}, error: () => {}, warn: () => {} });
stub('event/socketEventEmitter', { emit: () => {} });
stub('Modules/Tasks/helpers/completionStore', { forStatusChange: async () => null, recordWork: async () => null });

const { SCHEMA_TYPE } = require(path.join(ROOT, 'Config/schemaType'));
const { IDS, seedAgileReports } = require('./agileReportsSeed');

const main = async () => {
    process.env.AGENT_PERFORMANCE_READ = 'on';
    seedAgileReports(db, SCHEMA_TYPE);
    db.seed(SCHEMA_TYPE.TIMESHEET, { Loggeduser: IDS.OWNER, ProjectId: IDS.PROJECT, TicketID: '6f0000000000000000000f24', LogTimeDuration: 10, LogStartTime: Math.floor(Date.parse('2026-08-01T02:00:00Z') / 1000) });
    db.seed(SCHEMA_TYPE.TIMESHEET, { Loggeduser: IDS.OWNER, ProjectId: IDS.PROJECT, TicketID: '6f0000000000000000000f24', LogTimeDuration: 20, LogStartTime: Math.floor(Date.parse('2026-07-31T23:00:00Z') / 1000) });
    const performanceRead = require(path.join(ROOT, 'Modules/Agents/performanceRead'));
    const out = await performanceRead.read({
        companyId: IDS.COMPANY,
        actor: { kind: 'agent', userId: IDS.OWNER, agentId: null, runId: null },
        args: { projectId: IDS.PROJECT, from: '2026-08-01', to: '2026-08-31', metrics: ['time', 'flow'] },
    });
    const replay = (db.store[SCHEMA_TYPE.AI_REPLAYS] || [])[0];
    process.stdout.write(JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, out, replayArgs: replay && replay.query.args }));
};

main().catch((error) => {
    process.stderr.write(String(error && error.stack));
    process.exit(1);
});
