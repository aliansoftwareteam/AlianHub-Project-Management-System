/**
 * TaskStatusSummaryCard window test.
 *
 * The card's period used to select tasks by DUE DATE. It now selects them the way the
 * Workload Timesheet does: a task is in the window when somebody PLANNED it
 * (estimated_time.Date) or LOGGED time on it (timesheets.LogStartTime) inside the period.
 *
 * Stubs `mongoC.MongoDbCrudOpration` so getTasksByStatus can be exercised without Mongo,
 * and verifies:
 *   - the window is the UNION of planned and logged task ids
 *   - due date no longer appears in the task query at all
 *   - the ids reaching the task query are real ObjectId instances, not strings
 *     (a $match inside an aggregation does no schema casting — strings match nothing)
 *   - duplicate ids across the two sources are collapsed
 *   - a non-ObjectId task id is dropped rather than thrown
 *   - an empty window short-circuits: no task query is issued at all
 *   - the period reads estimated_time by Date and timesheets by Unix seconds
 *
 * Run from project root: `node .claude/tests/test-task-status-window.js`
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

const OID = (h) => new mongoose.Types.ObjectId(h);
const T1 = '507f1f77bcf86cd799431001';   // planned only
const T2 = '507f1f77bcf86cd799431002';   // logged only
const T3 = '507f1f77bcf86cd799431003';   // both -> must appear once
const BAD = 'not-an-object-id';          // must be dropped

const CALLER = '507f1f77bcf86cd799439011';
const U_ASSIGNEE = '507f1f77bcf86cd799439021';
const U_PLANNER = '507f1f77bcf86cd799439022';

// ── Stub Mongo ──────────────────────────────────────────────────────────────
// The controller makes several reads against the same two collections, told apart by
// their pipeline shape — the same way a reader tells them apart.
let calls = [];
let plannedTaskIds = [];       // window read: estimated_time -> distinct TaskId
let loggedTaskIds = [];        // window read: timesheets -> distinct TicketID
let plannedByUser = [];        // planned read: [{ _id: userId, m: minutes }]
let loggedByUser = [];         // logged read:  [{ _id: userId, m: minutes }]
let survivingTaskIds = [];     // tasks that pass baseFilter
let matrixGroups = [];         // [{ _id: { u, s }, n }]
let callerRoleType = 1;        // 1 = Owner, 3 = member

const groupKey = (obj) => {
    const pipeline = obj.data[0];
    const g = pipeline && pipeline.find((s) => s && s.$group);
    return g ? JSON.stringify(g.$group._id) : '';
};

mongoC.MongoDbCrudOpration = async (db, obj, op) => {
    calls.push({ type: obj.type, op, data: obj.data });

    if (obj.type === SCHEMA_TYPE.ESTIMATES_TIME) {
        if (op !== 'aggregate') return [];                       // drill's per-task find
        const key = groupKey(obj);
        if (key === '"$TaskId"') return plannedTaskIds.map((id) => ({ _id: id }));
        if (key === '"$UserId"') return plannedByUser;
        return [];
    }
    if (obj.type === SCHEMA_TYPE.TIMESHEET) {
        if (op !== 'aggregate') return [];                       // drill's per-task find
        const key = groupKey(obj);
        if (key === '"$TicketID"') return loggedTaskIds.map((id) => ({ _id: id }));
        if (key === '"$Loggeduser"') return loggedByUser;
        return [];
    }
    if (obj.type === SCHEMA_TYPE.COMPANY_USERS) return { roleType: callerRoleType };

    if (obj.type === SCHEMA_TYPE.TASKS) {
        if (op === 'aggregate') {
            const key = groupKey(obj);
            if (key === '"$statusKey"') return [];                // counters
            return matrixGroups;                                  // per-user matrix
        }
        // find: the surviving-id read projects only _id; the drill passes options too.
        if (obj.data.length === 2) return survivingTaskIds.map((id) => ({ _id: OID(id) }));
        return [];
    }
    return [];
};

const controller = require(path.join(projectRoot, 'Modules', 'UserDashboard', 'controller.js'));
const { myCache } = require(path.join(projectRoot, 'Config', 'config.js'));

function makeRes() {
    const res = { statusCode: 0, payload: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (p) => { res.payload = p; return res; };
    return res;
}

async function run(body) {
    calls = [];
    myCache.flushAll();   // roleType is cached per caller; each case sets its own
    const req = { headers: { companyid: 'test-co' }, uid: CALLER, body };
    const res = makeRes();
    await controller.getTasksByStatus(req, res);
    return res;
}

const taskQueries = () => calls.filter((c) => c.type === SCHEMA_TYPE.TASKS);
// The counts aggregation is the first task read; its $match IS the base filter.
const baseMatch = () => {
    const agg = taskQueries().find((c) => c.op === 'aggregate');
    if (!agg) return null;
    const pipeline = agg.data[0];
    return pipeline && pipeline[0] && pipeline[0].$match;
};
// The hour reads are the aggregations that group by person rather than by task.
const plannedMatch = () => {
    const c = calls.find((x) => x.type === SCHEMA_TYPE.ESTIMATES_TIME && x.op === 'aggregate'
        && groupKey({ data: x.data }) === '"$UserId"');
    return c ? c.data[0][0].$match : null;
};
const loggedMatch = () => {
    const c = calls.find((x) => x.type === SCHEMA_TYPE.TIMESHEET && x.op === 'aggregate'
        && groupKey({ data: x.data }) === '"$Loggeduser"');
    return c ? c.data[0][0].$match : null;
};
const userRow = (payload, id) => (payload.data.users || []).find((u) => u.userId === id);

(async () => {
    const BODY = { dateFrom: '2026-08-10T00:00:00.000Z', dateTo: '2026-08-16T23:59:59.999Z' };

    section('window = union of planned and logged');
    plannedTaskIds = [T1, T3];
    loggedTaskIds = [T2, T3];
    let res = await run(BODY);

    const m = baseMatch();
    assert('a task query was issued', !!m);
    const inList = m && m._id && m._id.$in;
    assert('base filter selects tasks by _id $in', Array.isArray(inList), JSON.stringify(m && m._id));
    assert('union holds exactly 3 ids (T3 deduped)', inList && inList.length === 3,
        'got ' + (inList ? inList.length : 'none'));
    const asHex = (inList || []).map(String);
    assert('planned-only task is in the window', asHex.includes(T1));
    assert('logged-only task is in the window', asHex.includes(T2));
    assert('task in both sources appears once', asHex.filter((x) => x === T3).length === 1);

    section('ids are cast for aggregation ($match does not cast)');
    assert('every id is an ObjectId instance, not a string',
        (inList || []).every((v) => v instanceof mongoose.Types.ObjectId),
        'types: ' + (inList || []).map((v) => typeof v).join(','));

    section('due date is gone from the window');
    assert('no DueDate clause in the base filter', !m || m.DueDate === undefined,
        JSON.stringify(m && m.DueDate));

    section('the two source reads use the right date types');
    const estCall = calls.find((c) => c.type === SCHEMA_TYPE.ESTIMATES_TIME);
    const tsCall = calls.find((c) => c.type === SCHEMA_TYPE.TIMESHEET);
    const estMatch = estCall && estCall.data[0][0].$match;
    const tsMatch = tsCall && tsCall.data[0][0].$match;
    assert('estimated_time filtered by Date as a real Date',
        estMatch && estMatch.Date && estMatch.Date.$gte instanceof Date,
        JSON.stringify(estMatch));
    assert('timesheets filtered by LogStartTime as Unix seconds',
        tsMatch && tsMatch.LogStartTime && typeof tsMatch.LogStartTime.$gte === 'number',
        JSON.stringify(tsMatch));
    assert('the two windows describe the same instant',
        estMatch && tsMatch
            && Math.floor(estMatch.Date.$gte.getTime() / 1000) === tsMatch.LogStartTime.$gte,
        'date=' + (estMatch && estMatch.Date.$gte) + ' sec=' + (tsMatch && tsMatch.LogStartTime.$gte));

    section('a malformed task id is dropped, not thrown');
    plannedTaskIds = [T1, BAD];
    loggedTaskIds = [];
    res = await run(BODY);
    const m2 = baseMatch();
    assert('request still succeeds', res.statusCode === 200, 'status ' + res.statusCode);
    assert('only the valid id survives', m2 && m2._id.$in.length === 1,
        'got ' + (m2 && m2._id.$in.length));

    section('empty window short-circuits');
    plannedTaskIds = [];
    loggedTaskIds = [];
    res = await run(BODY);
    assert('responds 200', res.statusCode === 200);
    assert('no task query is issued at all', taskQueries().length === 0,
        taskQueries().length + ' task read(s)');
    const d = res.payload && res.payload.data;
    assert('payload is empty but well-formed',
        d && Array.isArray(d.statuses) && d.total === 0 && Array.isArray(d.users) && Array.isArray(d.rows),
        JSON.stringify(d));
    assert('period is still reported', d && d.period && !!d.period.from, JSON.stringify(d && d.period));
    assert('scope is reported', d && (d.scope === 'company' || d.scope === 'self'), d && d.scope);

    // ── Planned Hours ───────────────────────────────────────────────────────────
    section('hours are credited to the PLANNER / LOGGER, not the assignee');
    plannedTaskIds = [T1];
    loggedTaskIds = [];
    survivingTaskIds = [T1];
    matrixGroups = [{ _id: { u: U_ASSIGNEE, s: 1 }, n: 2 }];
    plannedByUser = [{ _id: U_PLANNER, m: 1080 }];   // 18h, as in the timesheet
    loggedByUser = [{ _id: U_PLANNER, m: 337 }];     // 05:37, as in the timesheet
    callerRoleType = 1;
    res = await run(BODY);

    const planner = userRow(res.payload, U_PLANNER);
    const assignee = userRow(res.payload, U_ASSIGNEE);
    assert('the planner gets the planned hours', planner && planner.plannedMinutes === 1080,
        JSON.stringify(planner));
    assert('the logger gets the logged hours', planner && planner.loggedMinutes === 337,
        JSON.stringify(planner));
    assert('the assignee does NOT get the planner\'s hours',
        assignee && !assignee.plannedMinutes && !assignee.loggedMinutes, JSON.stringify(assignee));
    assert('the assignee keeps their status counts', assignee && assignee.total === 2);
    assert('a planner with no assigned task still gets a row', !!planner);
    assert('that row carries no phantom counts', planner && planner.total === 0);
    assert('planned and logged are independent figures',
        planner && planner.plannedMinutes !== planner.loggedMinutes);

    section('planned counts only the tasks inside the card\'s scope');
    const pm = plannedMatch();
    assert('planned read is scoped to the surviving task ids',
        pm && pm.TaskId && Array.isArray(pm.TaskId.$in) && pm.TaskId.$in.length === 1,
        JSON.stringify(pm && pm.TaskId));
    assert('those ids are STRINGS here (estimated_time.TaskId is a string field)',
        pm && pm.TaskId.$in.every((v) => typeof v === 'string'),
        'types: ' + (pm ? pm.TaskId.$in.map((v) => typeof v).join(',') : ''));
    assert('planned read carries the same date window',
        pm && pm.Date && pm.Date.$gte instanceof Date, JSON.stringify(pm && pm.Date));

    section('logged read mirrors planned, in its own field names and units');
    const lm = loggedMatch();
    assert('logged is scoped to the same surviving task ids (TicketID, strings)',
        lm && lm.TicketID && Array.isArray(lm.TicketID.$in)
            && lm.TicketID.$in.every((v) => typeof v === 'string'),
        JSON.stringify(lm && lm.TicketID));
    assert('logged uses LogStartTime in Unix seconds, not a Date',
        lm && lm.LogStartTime && typeof lm.LogStartTime.$gte === 'number',
        JSON.stringify(lm && lm.LogStartTime));
    assert('planned and logged cover the same instant',
        pm && lm && Math.floor(pm.Date.$gte.getTime() / 1000) === lm.LogStartTime.$gte);

    section('a member cannot see a colleague\'s hours through these columns');
    callerRoleType = 3;                                  // plain member
    res = await run(BODY);
    const pm2 = plannedMatch();
    const lm2 = loggedMatch();
    assert('planned read is pinned to the caller\'s own UserId', pm2 && pm2.UserId === CALLER,
        JSON.stringify(pm2 && pm2.UserId));
    assert('logged read is pinned to the caller\'s own Loggeduser', lm2 && lm2.Loggeduser === CALLER,
        JSON.stringify(lm2 && lm2.Loggeduser));

    section('owner/admin sees everyone\'s hours');
    callerRoleType = 1;
    res = await run(BODY);
    const pm3 = plannedMatch();
    const lm3 = loggedMatch();
    assert('no UserId clause for management', pm3 && pm3.UserId === undefined,
        JSON.stringify(pm3 && pm3.UserId));
    assert('no Loggeduser clause for management', lm3 && lm3.Loggeduser === undefined,
        JSON.stringify(lm3 && lm3.Loggeduser));

    // ── Option A: the status selection must not hide planned hours ──────────────
    // A task parked in a status nobody ticked still had hours planned against it, and
    // the timesheet counts them. Scoping Planned by statusKey made them vanish.
    section('planned ignores the status selection; the counters still honour it');
    res = await run({ ...BODY, statusKeys: [1, 2] });

    const counts = baseMatch();
    assert('the COUNTERS are still restricted to the ticked statuses',
        counts && counts.statusKey && Array.isArray(counts.statusKey.$in)
            && counts.statusKey.$in.join() === '1,2',
        JSON.stringify(counts && counts.statusKey));

    const survivingRead = taskQueries().find((c) => c.op === 'find' && c.data.length === 2);
    assert('the PLANNED task read carries no status clause at all',
        survivingRead && survivingRead.data[0].statusKey === undefined,
        JSON.stringify(survivingRead && survivingRead.data[0].statusKey));
    assert('planned still keeps the window', survivingRead && !!survivingRead.data[0]._id);
    assert('planned still keeps the member/company scope',
        survivingRead && Object.prototype.hasOwnProperty.call(survivingRead.data[0], 'deletedStatusKey'));

    section('the two filters are independent objects');
    // applyTaskMatch mutates what it is handed, so a shared object would let the status
    // clause leak from one query into the other.
    res = await run({ ...BODY, statusKeys: [1, 2], taskMatch: { $and: [{ Priority: 'High' }] } });
    const counts2 = baseMatch();
    const surviving2 = taskQueries().find((c) => c.op === 'find' && c.data.length === 2);
    assert('counters still status-filtered with an advanced filter present',
        counts2 && counts2.statusKey && counts2.statusKey.$in.join() === '1,2');
    assert('planned still has no status clause', surviving2 && surviving2.data[0].statusKey === undefined,
        JSON.stringify(surviving2 && surviving2.data[0].statusKey));
    assert('the advanced "Add filter" reaches BOTH queries',
        counts2 && Array.isArray(counts2.$and) && counts2.$and.length === 1
            && surviving2 && Array.isArray(surviving2.data[0].$and) && surviving2.data[0].$and.length === 1,
        'counts=' + JSON.stringify(counts2 && counts2.$and) + ' planned=' + JSON.stringify(surviving2 && surviving2.data[0].$and));

    // ── The "Other" bucket ──────────────────────────────────────────────────────
    // Hours count every status, so the tasks behind them must be reachable even when
    // their status has no column. They are gathered under one key the card calls Other.
    section('tasks outside the selection land in the Other bucket');
    plannedTaskIds = [T1, T2, T3];
    loggedTaskIds = [];
    survivingTaskIds = [T1, T2, T3];
    plannedByUser = [];
    loggedByUser = [];
    callerRoleType = 1;
    matrixGroups = [
        { _id: { u: U_ASSIGNEE, s: 1 }, n: 3 },     // shown
        { _id: { u: U_ASSIGNEE, s: 2 }, n: 1 },     // shown
        { _id: { u: U_ASSIGNEE, s: 9 }, n: 2 },     // NOT ticked -> Other
        { _id: { u: U_ASSIGNEE, s: 7 }, n: 4 },     // NOT ticked -> Other
    ];
    res = await run({ ...BODY, statusKeys: [1, 2] });

    const row = userRow(res.payload, U_ASSIGNEE);
    assert('shown statuses keep their own counts',
        row && row.counts[1] === 3 && row.counts[2] === 1, JSON.stringify(row && row.counts));
    assert('unshown statuses are summed into "other"', row && row.counts.other === 6,
        JSON.stringify(row && row.counts));
    assert('no column is invented for an unshown status',
        row && row.counts[9] === undefined && row.counts[7] === undefined,
        JSON.stringify(row && row.counts));
    assert('the row total counts everything it holds', row && row.total === 10, row && row.total);

    section('the matrix reads every status, not just the shown ones');
    const matrixAgg = calls.find((c) => c.type === SCHEMA_TYPE.TASKS && c.op === 'aggregate'
        && groupKey({ data: c.data }) !== '"$statusKey"');
    assert('matrix query carries no status clause',
        matrixAgg && matrixAgg.data[0][0].$match.statusKey === undefined,
        JSON.stringify(matrixAgg && matrixAgg.data[0][0].$match.statusKey));

    section('with every status shown there is nothing left over');
    res = await run(BODY);                         // no statusKeys -> all statuses shown
    const rowAll = userRow(res.payload, U_ASSIGNEE);
    assert('no other bucket when nothing is filtered out',
        rowAll && rowAll.counts.other === undefined, JSON.stringify(rowAll && rowAll.counts));

    section('opening Other lists exactly the unshown statuses');
    res = await run({ ...BODY, statusKeys: [1, 2], otherStatuses: true, userId: U_ASSIGNEE });
    const drillRead = taskQueries().find((c) => c.op === 'find' && c.data.length === 3);
    assert('the drill runs a $nin on the shown statuses',
        drillRead && drillRead.data[0].statusKey
            && Array.isArray(drillRead.data[0].statusKey.$nin)
            && drillRead.data[0].statusKey.$nin.join() === '1,2',
        JSON.stringify(drillRead && drillRead.data[0].statusKey));
    assert('it is scoped to the person whose cell was opened',
        drillRead && drillRead.data[0].AssigneeUserId === U_ASSIGNEE,
        JSON.stringify(drillRead && drillRead.data[0].AssigneeUserId));
    assert('the drill projects statusKey so each row can name its status',
        drillRead && drillRead.data[1].statusKey === 1,
        JSON.stringify(drillRead && drillRead.data[1]));

    section('Other is ignored when the card shows every status');
    res = await run({ ...BODY, otherStatuses: true, userId: U_ASSIGNEE });
    assert('no drill is run for an empty selection',
        !taskQueries().some((c) => c.op === 'find' && c.data.length === 3),
        'a drill query was issued');

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) {
        failures.forEach((f) => console.log(`  - ${f.name}${f.detail ? ': ' + f.detail : ''}`));
        process.exit(1);
    }
    myCache.flushAll();
    process.exit(0);
})();
