const Module = require('module');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const [companyId, taskId] = process.argv.slice(2);
const errors = [];
const unhandled = [];

process.on('unhandledRejection', (reason) => { unhandled.push(String((reason && reason.stack) || reason)); });

const stub = (relative, exports) => {
    const filename = require.resolve(path.join(ROOT, relative));
    const stubbed = new Module(filename, module);
    stubbed.filename = filename;
    stubbed.loaded = true;
    stubbed.exports = exports;
    require.cache[filename] = stubbed;
};

const rejectWithoutReason = () => Promise.reject(undefined);

stub('Config/loggerConfig', { info() {}, warn() {}, error: (line) => errors.push(String(line)) });
stub('utils/mongo-handler/mongoQueries', { MongoDbCrudOpration: rejectWithoutReason });
stub('Modules/Automations/engine/matcher', { match: rejectWithoutReason, invalidateAll() {} });
stub('Modules/Automations/engine/runner', { createRun: rejectWithoutReason, execute: rejectWithoutReason });

const domainEventBus = require(path.join(ROOT, 'event/domainEventBus'));
const engine = require(path.join(ROOT, 'Modules/Automations/engine'));

(async () => {
    await engine.start();
    const doc = { _id: taskId, CompanyId: companyId, TaskKey: '--' };
    domainEventBus.bus.emit('domain.event', domainEventBus.buildEnvelope({ companyId, type: 'task.created', doc, changedFields: new Set(), actor: { kind: 'user', userId: null } }));
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    process.stdout.write(JSON.stringify({ errors, unhandled }));
    process.exit(0);
})();
