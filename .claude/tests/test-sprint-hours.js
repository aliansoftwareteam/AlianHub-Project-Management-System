/**
 * Sprint hours endpoint test (Modules/Sprints/hours.js).
 *
 * The sprint header shows Planned / Logged / Overdue for a whole sprint, on the same
 * definitions the Tasks Summary by Status card uses:
 *
 *   projected = SUM logged (finished) + SUM max(planned, logged) (open)
 *   overdue   = projected - SUM planned, when positive
 *
 * Stubs `mongoC.MongoDbCrudOpration` so the handler runs without Mongo, and verifies:
 *   - the sprint is matched by a real ObjectId (tasks.sprintId is an ObjectId)
 *   - the hour reads are scoped by task id as STRINGS (both collections store it so)
 *   - no date window is applied anywhere — this is the sprint entire
 *   - the overdue arithmetic, finished vs open
 *   - a sprint with no tasks answers zeroes without reading the hour collections
 *   - a bad sprintId is rejected
 *
 * Run from project root: `node .claude/tests/test-sprint-hours.js`
 */
'use strict';

const path = require('path');
const mongoose = require('mongoose');
const projectRoot = path.resolve(__dirname, '..', '..');
require.main.filename = path.join(projectRoot, 'server.js');

const mongoC = require(path.join(projectRoot, 'utils', 'mongo-handler', 'mongoQueries'));
const { SCHEMA_TYPE } = require(path.join(projectRoot, 'Config', 'schemaType'));

let passed = 0;
let failed = 0;
const failures = [];
function assert(name, cond, detail) {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

const SPRINT = '507f1f77bcf86cd799432001';
const T1 = '507f1f77bcf86cd799431001';
const T2 = '507f1f77bcf86cd799431002';

let calls = [];
let sprintTasks = [];      // [{ id, finished }]
let plannedByTask = [];    // [[taskId, minutes]]
let loggedByTask = [];     // [[taskId, minutes]]

mongoC.MongoDbCrudOpration = async (db, obj, op) => {
    calls.push({ type: obj.type, op, data: obj.data });
    if (obj.type === SCHEMA_TYPE.TASKS) {
        return sprintTasks.map((t) => ({
            _id: new mongoose.Types.ObjectId(t.id),
            statusType: t.finished ? 'close' : 'default_active',
        }));
    }
    if (obj.type === SCHEMA_TYPE.ESTIMATES_TIME) return plannedByTask.map(([t, m]) => ({ _id: t, m }));
    if (obj.type === SCHEMA_TYPE.TIMESHEET) return loggedByTask.map(([t, m]) => ({ _id: t, m }));
    return [];
};

const hours = require(path.join(projectRoot, 'Modules', 'Sprints', 'hours.js'));

function makeRes() {
    const res = { statusCode: 0, payload: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (p) => { res.payload = p; return res; };
    return res;
}

async function run(sprintId = SPRINT) {
    calls = [];
    const res = makeRes();
    await hours.getSprintHours({ headers: { companyid: 'test-co' }, body: { sprintId } }, res);
    return res;
}

const data = (res) => (res.payload && res.payload.data) || {};
const taskFilter = () => {
    const c = calls.find((x) => x.type === SCHEMA_TYPE.TASKS);
    return c ? c.data[0] : null;
};
const hourMatch = (type) => {
    const c = calls.find((x) => x.type === type);
    return c ? c.data[0][0].$match : null;
};

const setUp = (tasks, planned, logged) => {
    sprintTasks = tasks; plannedByTask = planned; loggedByTask = logged;
    return run();
};

(async () => {
    section('the sprint is matched by ObjectId, tasks are scoped correctly');
    let res = await setUp([{ id: T1, finished: false }], [[T1, 180]], [[T1, 60]]);
    const tf = taskFilter();
    assert('sprintId is a real ObjectId, not a string',
        tf && tf.sprintId instanceof mongoose.Types.ObjectId, JSON.stringify(tf && tf.sprintId));
    assert('deleted tasks are excluded', tf && tf.deletedStatusKey === 0);
    assert('chat threads are excluded', tf && tf.mainChat && tf.mainChat.$ne === true);
    assert('no isParentTask clause — subtasks are counted', tf && tf.isParentTask === undefined);

    section('hour reads use string task ids and no date window');
    const pm = hourMatch(SCHEMA_TYPE.ESTIMATES_TIME);
    const lm = hourMatch(SCHEMA_TYPE.TIMESHEET);
    assert('planned scoped by TaskId as strings',
        pm && pm.TaskId && pm.TaskId.$in.every((v) => typeof v === 'string'), JSON.stringify(pm));
    assert('logged scoped by TicketID as strings',
        lm && lm.TicketID && lm.TicketID.$in.every((v) => typeof v === 'string'), JSON.stringify(lm));
    assert('planned has NO date filter', pm && pm.Date === undefined, JSON.stringify(pm && pm.Date));
    assert('logged has NO date filter', lm && lm.LogStartTime === undefined,
        JSON.stringify(lm && lm.LogStartTime));

    section('totals');
    assert('planned totals across tasks', data(res).plannedMinutes === 180, data(res).plannedMinutes);
    assert('logged totals across tasks', data(res).loggedMinutes === 60, data(res).loggedMinutes);
    assert('open task inside its plan is not overdue', data(res).overdueMinutes === 0,
        data(res).overdueMinutes);

    section('a finished task that overran counts what it cost');
    res = await setUp([{ id: T1, finished: true }], [[T1, 180]], [[T1, 300]]);
    assert('3h planned, 5h logged, closed -> 2h over', data(res).overdueMinutes === 120,
        data(res).overdueMinutes);

    section('a finished task brought in early gives the time back');
    res = await setUp([{ id: T1, finished: true }], [[T1, 180]], [[T1, 120]]);
    assert('3h planned, 2h logged, closed -> not overdue', data(res).overdueMinutes === 0,
        data(res).overdueMinutes);

    section('an open task past its plan shows now, not when it closes');
    res = await setUp([{ id: T1, finished: false }], [[T1, 180]], [[T1, 480]]);
    assert('3h planned, 8h logged, open -> 5h over', data(res).overdueMinutes === 300,
        data(res).overdueMinutes);

    section('the sprint nets across tasks');
    res = await setUp(
        [{ id: T1, finished: true }, { id: T2, finished: true }],
        [[T1, 180], [T2, 180]], [[T1, 300], [T2, 120]],
    );
    assert('+2h and -1h net to 1h over', data(res).overdueMinutes === 60, data(res).overdueMinutes);
    assert('planned still totals both tasks', data(res).plannedMinutes === 360, data(res).plannedMinutes);

    section('an underrun cannot drive the sprint negative');
    res = await setUp([{ id: T1, finished: true }], [[T1, 600]], [[T1, 60]]);
    assert('10h planned, 1h logged -> 0, not -9h', data(res).overdueMinutes === 0,
        data(res).overdueMinutes);

    section('an empty sprint answers zeroes without reading the hour collections');
    res = await setUp([], [], []);
    assert('responds 200', res.statusCode === 200);
    assert('all three are zero',
        data(res).plannedMinutes === 0 && data(res).loggedMinutes === 0 && data(res).overdueMinutes === 0,
        JSON.stringify(data(res)));
    assert('no estimated_time read was issued',
        !calls.some((c) => c.type === SCHEMA_TYPE.ESTIMATES_TIME));
    assert('no timesheet read was issued',
        !calls.some((c) => c.type === SCHEMA_TYPE.TIMESHEET));

    section('a bad sprintId is rejected before any read');
    res = await run('not-an-object-id');
    assert('responds 400', res.statusCode === 400, 'status ' + res.statusCode);
    assert('no collection was touched', calls.length === 0, calls.length + ' call(s)');

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) {
        failures.forEach((f) => console.log(`  - ${f.name}${f.detail !== undefined ? ': ' + f.detail : ''}`));
        process.exit(1);
    }
    process.exit(0);
})();
