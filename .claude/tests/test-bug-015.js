/**
 * BUG-015 regression test: every method in `task_class.js` resolved the
 * outer Promise before its side effects (notification + history) had a
 * chance to run. Side-effect failures landed in `.catch` and were
 * logged, but the caller had already seen success.
 *
 * The fix collects each method's side effects, attaches a `.catch` to
 * each so individual failures don't reject the whole batch,
 * `await Promise.allSettled(...)`s them, and only then resolves.
 *
 * This test injects stub side-effect modules via Node's require cache so
 * the class can be exercised without Mongo or the real notification path.
 * Each stub records call ordering and timing so we can prove:
 *
 *   1. The outer Promise resolves AFTER notification + history complete.
 *   2. Side-effect failures don't reject the outer Promise.
 *   3. DB failures DO reject the outer Promise.
 *   4. The `isUpdateTask: false` branch still fires side effects
 *      (and resolves AFTER them).
 *
 * Run from project root: `node .claude/tests/test-bug-015.js`
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Module = require('module');

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

// --- Stub side-effect modules via the require cache --------------------------
const helperPath = require.resolve(path.join(projectRoot, 'Modules', 'tasks', 'helpers', 'helper.js'));
const handleNotificationPath = require.resolve(path.join(projectRoot, 'Modules', 'tasks', 'helpers', 'handleNotification.js'));
const notificationTemplatePath = require.resolve(path.join(projectRoot, 'Modules', 'tasks', 'helpers', 'notificationTemplate.js'));
const mongoQueriesPath = require.resolve(path.join(projectRoot, 'utils', 'mongo-handler', 'mongoQueries.js'));

const stubs = {
    historyCalls: [],
    notificationCalls: [],
    mongoCalls: [],
    // Each can be a function that returns a promise. Defaults are happy-path.
    history: () => new Promise((r) => setImmediate(() => { stubs.historyCalls.push({ at: Date.now() }); r({ ok: true }); })),
    notification: () => new Promise((r) => setImmediate(() => { stubs.notificationCalls.push({ at: Date.now() }); r({ ok: true }); })),
    mongo: () => new Promise((r) => setImmediate(() => { stubs.mongoCalls.push({ at: Date.now() }); r({ ok: true }); })),
};

require.cache[helperPath] = { id: helperPath, filename: helperPath, loaded: true, exports: {
    HandleHistory: (...args) => stubs.history(...args),
} };
require.cache[handleNotificationPath] = { id: handleNotificationPath, filename: handleNotificationPath, loaded: true, exports: {
    HandleBothNotification: (...args) => stubs.notification(...args),
} };
require.cache[notificationTemplatePath] = { id: notificationTemplatePath, filename: notificationTemplatePath, loaded: true, exports: {
    taskNameEdit: () => 'name-msg',
    taskPriorityChange: () => 'priority-msg',
    taskStatusChange: () => 'status-msg',
} };
require.cache[mongoQueriesPath] = { id: mongoQueriesPath, filename: mongoQueriesPath, loaded: true, exports: {
    MongoDbCrudOpration: (...args) => stubs.mongo(...args),
} };

// Now require the file under test — it'll pick up our stubs.
const { task } = require(path.join(projectRoot, 'Modules', 'tasks', 'helpers', 'task_class.js'));

function resetStubs() {
    stubs.historyCalls = [];
    stubs.notificationCalls = [];
    stubs.mongoCalls = [];
    stubs.history = () => new Promise((r) => setImmediate(() => { stubs.historyCalls.push({ at: Date.now() }); r({ ok: true }); }));
    stubs.notification = () => new Promise((r) => setImmediate(() => { stubs.notificationCalls.push({ at: Date.now() }); r({ ok: true }); }));
    stubs.mongo = () => new Promise((r) => setImmediate(() => { stubs.mongoCalls.push({ at: Date.now() }); r({ ok: true }); }));
}

function makeStatusArgs() {
    return {
        newStatus: { status: { text: 'Done' } },
        prevStatus: {
            taskId: '507f1f77bcf86cd799439011',
            taskName: 'T1', updatedTaskName: 'T1', name: 'OldName',
            statusName: 'In Progress', backColor: '#fff', color: '#000',
            bgColor: '#eee', textColor: '#111',
        },
        projectData: { _id: 'proj1', ProjectName: 'P', CompanyId: 'co1' },
        task: { sprintArray: { id: 'sprint1', folderId: 'folder1' } },
        userData: { Employee_Name: 'QA' },
    };
}

function makePriorityArgs() {
    return {
        firebaseObj: { Priority: 'high' },
        projectData: { _id: 'proj1', ProjectName: 'P', CompanyId: 'co1' },
        taskData: { sprintArray: { id: 'sprint1', folderId: 'folder1' } },
        priorityObj: {
            taskId: '507f1f77bcf86cd799439011',
            taskName: 'T1',
            priorityName: 'low', newPriorityName: 'high',
            statusImage: 's', newStatusImage: 'ns',
        },
        userData: { Employee_Name: 'QA' },
    };
}

function makeTaskNameArgs() {
    return {
        firebaseObj: { TaskName: 'NewTaskName' },
        projectData: { _id: 'proj1', ProjectName: 'P', CompanyId: 'co1' },
        taskData: { _id: '507f1f77bcf86cd799439011', sprintArray: { id: 'sprint1', folderId: 'folder1' } },
        obj: { previousTaskName: 'OldTaskName', userName: 'QA' },
        userData: { Employee_Name: 'QA' },
    };
}

(async () => {
    section('updateStatus — DB write happens, then side effects, then resolve');
    {
        resetStubs();
        let resolvedAt = null;
        let sideEffectsAtResolve = null;
        const args = makeStatusArgs();
        const p = task.updateStatus({ ...args, isUpdateTask: true });
        p.then(() => {
            resolvedAt = Date.now();
            sideEffectsAtResolve = {
                history: stubs.historyCalls.length,
                notification: stubs.notificationCalls.length,
            };
        });
        const result = await p;
        await new Promise((r) => setImmediate(r));
        assert('updateStatus resolves successfully',
            result && result.status === true);
        assert('updateStatus: DB call happened',
            stubs.mongoCalls.length === 1);
        assert('updateStatus: history was awaited BEFORE resolve',
            sideEffectsAtResolve && sideEffectsAtResolve.history >= 1,
            `history-at-resolve=${sideEffectsAtResolve && sideEffectsAtResolve.history}`);
        assert('updateStatus: notification was awaited BEFORE resolve',
            sideEffectsAtResolve && sideEffectsAtResolve.notification >= 1);
    }

    section('updateStatus — side-effect failure does NOT reject');
    {
        resetStubs();
        stubs.history = () => Promise.reject(new Error('history boom'));
        stubs.notification = () => Promise.reject(new Error('notification boom'));
        const args = makeStatusArgs();
        const result = await task.updateStatus({ ...args, isUpdateTask: true });
        assert('updateStatus still resolves when side effects fail',
            result && result.status === true);
    }

    section('updateStatus — DB failure DOES reject');
    {
        resetStubs();
        stubs.mongo = () => Promise.reject(new Error('mongo down'));
        const args = makeStatusArgs();
        let threw = null;
        try {
            await task.updateStatus({ ...args, isUpdateTask: true });
        } catch (err) { threw = err; }
        assert('updateStatus rejects when the DB write fails',
            threw && /mongo down/.test(threw.message));
        assert('history NOT called when DB failed',
            stubs.historyCalls.length === 0);
        assert('notification NOT called when DB failed',
            stubs.notificationCalls.length === 0);
    }

    section('updateStatus — isUpdateTask:false fires side effects, no DB');
    {
        resetStubs();
        const args = makeStatusArgs();
        const result = await task.updateStatus({ ...args, isUpdateTask: false });
        assert('resolves with success',
            result && result.status === true);
        assert('no DB call (isUpdateTask=false)',
            stubs.mongoCalls.length === 0);
        assert('history WAS called',
            stubs.historyCalls.length === 1);
        assert('notification WAS called (name !== updatedTaskName)',
            stubs.notificationCalls.length === 1);
    }

    section('updatePriority — DB then side effects then resolve');
    {
        resetStubs();
        let sideEffectsAtResolve = null;
        const args = makePriorityArgs();
        const p = task.updatePriority({ ...args, isUpdateTask: true });
        p.then(() => {
            sideEffectsAtResolve = {
                history: stubs.historyCalls.length,
                notification: stubs.notificationCalls.length,
            };
        });
        await p;
        await new Promise((r) => setImmediate(r));
        assert('updatePriority: DB write happened',
            stubs.mongoCalls.length === 1);
        assert('updatePriority: history awaited before resolve',
            sideEffectsAtResolve && sideEffectsAtResolve.history >= 1);
        assert('updatePriority: notification awaited before resolve',
            sideEffectsAtResolve && sideEffectsAtResolve.notification >= 1);
    }

    section('updatePriority — isUpdateTask:false fires side effects');
    {
        resetStubs();
        const args = makePriorityArgs();
        const result = await task.updatePriority({ ...args, isUpdateTask: false });
        assert('updatePriority(false): resolves successfully',
            result && result.status === true);
        assert('updatePriority(false): no DB call', stubs.mongoCalls.length === 0);
        assert('updatePriority(false): history called', stubs.historyCalls.length === 1);
    }

    section('updateTaskName — DB then side effects then resolve');
    {
        resetStubs();
        let sideEffectsAtResolve = null;
        const args = makeTaskNameArgs();
        const p = task.updateTaskName(args);
        p.then(() => {
            sideEffectsAtResolve = {
                history: stubs.historyCalls.length,
                notification: stubs.notificationCalls.length,
            };
        });
        await p;
        await new Promise((r) => setImmediate(r));
        assert('updateTaskName: DB write happened',
            stubs.mongoCalls.length === 1);
        assert('updateTaskName: history awaited before resolve',
            sideEffectsAtResolve && sideEffectsAtResolve.history >= 1);
        assert('updateTaskName: notification awaited before resolve',
            sideEffectsAtResolve && sideEffectsAtResolve.notification >= 1);
    }

    section('updateTaskName — DB failure rejects, side effects skipped');
    {
        resetStubs();
        stubs.mongo = () => Promise.reject(new Error('mongo nope'));
        const args = makeTaskNameArgs();
        let threw = null;
        try { await task.updateTaskName(args); } catch (err) { threw = err; }
        assert('updateTaskName rejects on DB failure',
            threw && /mongo nope/.test(threw.message));
        assert('updateTaskName: history NOT called on DB failure',
            stubs.historyCalls.length === 0);
    }

    section('source — outer Promise resolves are inside Promise.allSettled awaits');
    const src = fs.readFileSync(path.join(projectRoot, 'Modules', 'tasks', 'helpers', 'task_class.js'), 'utf-8');
    const srcNoComments = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    assert('source uses Promise.allSettled',
        /Promise\.allSettled\s*\(/.test(srcNoComments));
    assert('source defines fireSideEffects helpers',
        (srcNoComments.match(/fireSideEffects\s*=\s*async/g) || []).length >= 3);
    assert('source does NOT resolve immediately inside Mongo .then before side effects',
        // After the fix, the first thing inside the .then(async () => …) is
        // `await fireSideEffects()`, NOT `resolve(`.
        !/MongoDbCrudOpration[^)]*\)\s*\.then\s*\(\s*\(\s*\)\s*=>\s*\{\s*resolve\s*\(/.test(srcNoComments));

    console.log(`\n========================================`);
    console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log('========================================');
    if (failed > 0) {
        console.log('Failed cases:');
        failures.forEach((f) => console.log(`  - ${f.name}${f.detail ? ': ' + f.detail : ''}`));
        process.exit(1);
    }
    process.exit(0);
})().catch((err) => {
    console.error('FATAL', err);
    process.exit(1);
});
