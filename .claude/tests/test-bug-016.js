/**
 * BUG-016 regression test: `Modules/tasks/helpers/mongo_helper.js` had
 * two sites that called `reject(error)` AFTER the outer Promise had
 * already been settled with `resolve(...)`. Calling `reject` on an
 * already-settled Promise is a no-op, so the underlying error was
 * silently swallowed.
 *
 *   Site 1: `HandleTask` — `.then` calls `resolve(...)` first, then
 *           fires two `HandleHistory(...).catch(reject)` chains.
 *   Site 2: `convertToSubTaskFunction` — `.catch` chained to the inner
 *           `MongoDbCrudOpration(...).then(...)` runs AFTER the inner
 *           `resolve(...)`, so its `reject(error)` was a no-op.
 *
 * The fix:
 *   - Site 1 awaits the two history calls via `Promise.allSettled` and
 *     resolves AFTER they finish, logging any failures via `logger`.
 *   - Site 2 replaces `reject(error)` with `logger.error(...)` since the
 *     outer Promise is already resolved by the time the catch fires.
 *
 * Run from project root: `node .claude/tests/test-bug-016.js`
 */
'use strict';

const path = require('path');
const fs = require('fs');
const projectRoot = path.resolve(__dirname, '..', '..');
require.main.filename = path.join(projectRoot, 'server.js');

let passed = 0;
let failed = 0;
const failures = [];
function assert(name, cond, detail) {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// ---------------------------------------------------------------------------
// Stub modules via require.cache so the unit under test can be exercised
// without Mongo or the real notification path.
// ---------------------------------------------------------------------------
const mongoQueriesPath = require.resolve(path.join(projectRoot, 'utils', 'mongo-handler', 'mongoQueries.js'));
const socketEmitterPath = require.resolve(path.join(projectRoot, 'event', 'socketEventEmitter.js'));
const planHelperPath = require.resolve(path.join(projectRoot, 'utils', 'planHelper.js'));

const stubs = {
    mongoCalls: [],
    socketEmits: [],
    mongoBehaviour: () => Promise.resolve({ _id: 'new-task-id' }),
    // The history-call oracle is set per test. We watch `HandleHistory`
    // through `mongo_helper.exports` itself.
};

require.cache[mongoQueriesPath] = {
    id: mongoQueriesPath, filename: mongoQueriesPath, loaded: true,
    exports: {
        MongoDbCrudOpration: (...args) => {
            stubs.mongoCalls.push({ at: Date.now() });
            return stubs.mongoBehaviour(...args);
        },
    },
};
require.cache[socketEmitterPath] = {
    id: socketEmitterPath, filename: socketEmitterPath, loaded: true,
    exports: {
        emit: (event, payload) => { stubs.socketEmits.push({ event, payload, at: Date.now() }); },
    },
};
// planHelper.getCachedCompanyData is used by getTotalSprintCount —
// make it resolve to "permission granted".
require.cache[planHelperPath] = {
    id: planHelperPath, filename: planHelperPath, loaded: true,
    exports: {
        getCachedCompanyData: async () => ({ data: { planFeature: { maxTaskPerSprint: null } } }),
    },
};

const mongoHelper = require(path.join(projectRoot, 'Modules', 'tasks', 'helpers', 'mongo_helper.js'));
// Stub the plan-permission gate. HandleTask short-circuits to "upgrade your
// plan" when this returns false; we want every test to exercise the main
// branch unless explicitly overridden.
mongoHelper.getTotalSprintCount = async () => true;

function resetStubs() {
    stubs.mongoCalls = [];
    stubs.socketEmits = [];
    stubs.mongoBehaviour = () => Promise.resolve({ _id: 'new-task-id' });
}

(async () => {

// ---------------------------------------------------------------------------
// Site 1: HandleTask — resolve happens AFTER both history calls complete
// ---------------------------------------------------------------------------
section('HandleTask — history calls awaited before resolve');
{
    resetStubs();
    const historyCalls = [];
    const originalHandleHistory = mongoHelper.HandleHistory;
    mongoHelper.HandleHistory = (...args) => {
        return new Promise((r) => setImmediate(() => {
            historyCalls.push({ args, at: Date.now() });
            r({ status: true });
        }));
    };

    let resolvedAt = null;
    let historyCountAtResolve = null;
    const validObj = {
        TaskName: 'T',
        TaskKey: 'K',
        TaskType: 'task',
        ProjectID: '507f1f77bcf86cd799439011',
        CompanyId: '507f1f77bcf86cd799439022',
        sprintId: 'sprint-1',
        mainChat: false,
    };
    const promise = mongoHelper.HandleTask('co1', validObj, false, null, { Employee_Name: 'QA', id: 'u1' });
    promise.then(() => {
        resolvedAt = Date.now();
        historyCountAtResolve = historyCalls.length;
    });
    const result = await promise;
    await new Promise((r) => setImmediate(r));
    mongoHelper.HandleHistory = originalHandleHistory;

    assert('HandleTask resolved with status:true', result && result.status === true);
    assert('Mongo save was called', stubs.mongoCalls.length >= 1);
    assert('BOTH history calls happened before resolve',
        historyCountAtResolve === 2,
        `historyCountAtResolve=${historyCountAtResolve}`);
}

// ---------------------------------------------------------------------------
// Site 1: HandleTask — a history failure does NOT reject the outer Promise
// (it just gets logged via logger.error)
// ---------------------------------------------------------------------------
section('HandleTask — history failure does NOT reject');
{
    resetStubs();
    const originalHandleHistory = mongoHelper.HandleHistory;
    let historyCount = 0;
    mongoHelper.HandleHistory = () => {
        historyCount += 1;
        return Promise.reject(new Error(`history boom ${historyCount}`));
    };

    const validObj = {
        TaskName: 'T',
        TaskKey: 'K',
        TaskType: 'task',
        ProjectID: '507f1f77bcf86cd799439011',
        CompanyId: '507f1f77bcf86cd799439022',
        sprintId: 'sprint-1',
        mainChat: false,
    };

    let threw = null;
    let result = null;
    try {
        result = await mongoHelper.HandleTask('co1', validObj, false, null, { Employee_Name: 'QA', id: 'u1' });
    } catch (err) { threw = err; }
    mongoHelper.HandleHistory = originalHandleHistory;

    assert('HandleTask did NOT reject when history failed (pre-fix: silently lost)',
        threw === null && result && result.status === true,
        threw ? `threw: ${threw.message || threw}` : '');
    assert('both history attempts ran (allSettled, not all-or-nothing)',
        historyCount === 2);
}

// ---------------------------------------------------------------------------
// Site 1: HandleTask — DB failure still rejects (regression check for the
// outer .catch path)
// ---------------------------------------------------------------------------
section('HandleTask — DB failure rejects (unchanged behaviour)');
{
    resetStubs();
    stubs.mongoBehaviour = () => Promise.reject(new Error('mongo down'));

    const originalHandleHistory = mongoHelper.HandleHistory;
    let historyCalled = 0;
    mongoHelper.HandleHistory = () => { historyCalled += 1; return Promise.resolve({}); };

    const validObj = {
        TaskName: 'T',
        TaskKey: 'K',
        TaskType: 'task',
        ProjectID: '507f1f77bcf86cd799439011',
        CompanyId: '507f1f77bcf86cd799439022',
        sprintId: 'sprint-1',
        mainChat: false,
    };

    let threw = null;
    try {
        await mongoHelper.HandleTask('co1', validObj, false, null, { Employee_Name: 'QA', id: 'u1' });
    } catch (err) { threw = err; }
    mongoHelper.HandleHistory = originalHandleHistory;

    assert('HandleTask rejected on DB failure',
        threw && /mongo down/.test(threw.message || ''),
        threw ? threw.message : 'did not reject');
    assert('history NOT called when DB save failed', historyCalled === 0);
}

// ---------------------------------------------------------------------------
// Source-level grep: the reject-after-resolve patterns are gone
// ---------------------------------------------------------------------------
section('source — reject-after-resolve patterns removed');
const src = fs.readFileSync(path.join(projectRoot, 'Modules', 'tasks', 'helpers', 'mongo_helper.js'), 'utf-8');
const srcNoComments = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// The two HandleHistory().catch(error => reject(error)) calls inside HandleTask
// are gone — the catch body should now be a logger.error, not reject.
const handleTaskSlice = srcNoComments.slice(
    srcNoComments.indexOf('exports.HandleTask ='),
    srcNoComments.indexOf('exports.HandleHistory ='),
);
assert('HandleTask: no `HandleHistory(...).catch(reject)` chain remains',
    !/HandleHistory\([^)]*\)\s*\.catch\s*\(\s*\(\s*error\s*\)\s*=>\s*\{\s*reject/.test(handleTaskSlice),
    'old reject-after-resolve chain still present');
assert('HandleTask: source uses Promise.allSettled for the history calls',
    /Promise\.allSettled\s*\(\s*\[\s*[\s\S]*?HandleHistory[\s\S]*?HandleHistory/.test(handleTaskSlice));
assert('HandleTask: resolve(...) is AFTER the allSettled await',
    /await\s+Promise\.allSettled\([\s\S]*?\)\s*;[\s\S]*?resolve\s*\(\s*\{\s*status:\s*true/.test(handleTaskSlice));

// convertToSubTaskFunction: the inner .catch should no longer call reject.
const convertSlice = srcNoComments.slice(
    srcNoComments.indexOf('exports.convertToSubTaskFunction'),
    srcNoComments.indexOf('exports.moveTaskFunction'),
);
const innerInsideConvert = (convertSlice.match(/\.catch\s*\(\s*\(\s*error\s*\)\s*=>\s*\{[\s\S]*?\}/g) || []);
const innerWithReject = innerInsideConvert.filter((c) => /reject\s*\(/.test(c) && !/logger\./.test(c));
assert('convertToSubTaskFunction: no inner .catch still calls a bare reject',
    innerWithReject.length === 0,
    innerWithReject.join(' | '));

console.log(`\n========================================`);
console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log('========================================');
if (failed > 0) {
    console.log('Failed cases:');
    failures.forEach((f) => console.log(`  - ${f.name}${f.detail ? ': ' + f.detail : ''}`));
    process.exit(1);
}
process.exit(0);

})().catch((err) => { console.error('FATAL', err); process.exit(1); });
