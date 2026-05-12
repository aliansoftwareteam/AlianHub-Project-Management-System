/**
 * BUG-033 regression — sprint task-count reconciliation.
 *
 * Multi-step task mutation flows (moveTaskFunction, convertToListSubTask,
 * mergeTask) write a primary update then fire secondary `$inc` ops to
 * keep `sprints.tasks` in sync. If any secondary op fails, the count
 * silently drifts. The fix introduces a `reconcileSprintTaskCount`
 * helper that recomputes from the tasks collection and `$set`s the
 * correct value back onto the sprint.
 *
 * This test:
 *   1. Stubs MongoDbCrudOpration to simulate a sprint whose stored count
 *      is wrong (e.g. 99) but whose actual live-task count is 3.
 *   2. Calls `reconcileSprintTaskCount` and asserts the `$set` issued to
 *      Mongo carries `tasks: 3`.
 *   3. Verifies `scheduleReconciliation` invokes the same helper
 *      (off-loop, via setImmediate) for each sprintId given.
 */

const path = require('path');
const Module = require('module');

const calls = [];
const fakeMongoQueries = {
    MongoDbCrudOpration: async function (companyId, params, op) {
        calls.push({ type: params.type, op, params: JSON.parse(JSON.stringify(params)) });
        // The aggregate count query → return 3 live tasks.
        if (op === 'aggregate') {
            return [{ count: 3 }];
        }
        // The findOneAndUpdate set → echo the doc back.
        if (op === 'findOneAndUpdate') {
            return { _id: params.data[0]._id, tasks: 3 };
        }
        return null;
    },
    validateObjectId: () => true
};

const fakeSchemaType = {
    SCHEMA_TYPE: {
        TASKS: 'tasks',
        SPRINTS: 'sprints'
    }
};

const fakeLogger = { error: () => {}, info: () => {}, warn: () => {} };

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
    if (request.endsWith('mongo-handler/mongoQueries') || request.endsWith('utils/mongo-handler/mongoQueries')) return 'fake-mongoQueries';
    if (request.endsWith('Config/schemaType') || request.endsWith('../../Config/schemaType') || request.endsWith('../../../Config/schemaType')) return 'fake-schemaType';
    if (request.endsWith('Config/loggerConfig') || request.endsWith('../../../Config/loggerConfig')) return 'fake-logger';
    return originalResolve.call(this, request, parent, ...rest);
};

require.cache['fake-mongoQueries'] = { id: 'fake-mongoQueries', filename: 'fake-mongoQueries', loaded: true, exports: fakeMongoQueries };
require.cache['fake-schemaType'] = { id: 'fake-schemaType', filename: 'fake-schemaType', loaded: true, exports: fakeSchemaType };
require.cache['fake-logger'] = { id: 'fake-logger', filename: 'fake-logger', loaded: true, exports: fakeLogger };

function assert(cond, label) {
    if (!cond) {
        console.error('FAIL:', label);
        calls.forEach((c, i) => console.error(`  [${i}] ${c.type} (${c.op}):`, JSON.stringify(c.params).slice(0, 400)));
        process.exit(1);
    }
    console.log('PASS:', label);
}

(async function main() {
    const reconcile = require(path.resolve(__dirname, '../../Modules/tasks/helpers/reconcileTaskCount.js'));
    const validId = '507f1f77bcf86cd799439011';

    // ---- 1. computeLiveTaskCount queries the tasks collection with the
    //         standard filter and returns the count ----
    calls.length = 0;
    const count = await reconcile.computeLiveTaskCount('co1', validId);
    assert(count === 3, 'computeLiveTaskCount returns the aggregate count');
    const aggregateCall = calls.find(c => c.op === 'aggregate' && c.type === 'tasks');
    assert(!!aggregateCall, 'computeLiveTaskCount issued an aggregate against TASKS');
    const matchStage = aggregateCall.params.data[0][0].$match;
    assert(
        matchStage.deletedStatusKey && Array.isArray(matchStage.deletedStatusKey.$in) && matchStage.deletedStatusKey.$in.includes(0),
        'reconciliation uses the BUG-032 filter shape `{ $in: [0, undefined] }`'
    );

    // ---- 2. reconcileSprintTaskCount writes the recomputed count back ----
    calls.length = 0;
    const corrected = await reconcile.reconcileSprintTaskCount('co1', validId);
    assert(corrected === 3, 'reconcileSprintTaskCount resolves with the corrected count');
    const sprintUpdate = calls.find(c => c.op === 'findOneAndUpdate' && c.type === 'sprints');
    assert(!!sprintUpdate, 'reconcileSprintTaskCount issued a findOneAndUpdate against SPRINTS');
    assert(
        sprintUpdate.params.data[1].$set && sprintUpdate.params.data[1].$set.tasks === 3,
        'reconcileSprintTaskCount $sets `tasks: 3` (the recomputed value)'
    );

    // ---- 3. Invalid sprintId returns null without throwing ----
    calls.length = 0;
    const nullResult = await reconcile.reconcileSprintTaskCount('co1', '');
    assert(nullResult === null, 'reconcileSprintTaskCount returns null for missing sprintId');
    assert(calls.length === 0, 'no Mongo calls issued for empty sprintId');

    // ---- 4. scheduleReconciliation fans out off the event loop ----
    calls.length = 0;
    reconcile.scheduleReconciliation('co1', [validId, validId]);
    // Wait one macrotask for setImmediate to drain.
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    const aggregates = calls.filter(c => c.op === 'aggregate' && c.type === 'tasks');
    assert(aggregates.length >= 2, 'scheduleReconciliation runs once per sprintId in the array');

    console.log('\nAll BUG-033 assertions passed.');
})().catch(err => {
    console.error('TEST ERROR:', err);
    process.exit(1);
});
