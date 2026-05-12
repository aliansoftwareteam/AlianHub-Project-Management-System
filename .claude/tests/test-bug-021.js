/**
 * BUG-021 regression test: the audit found that `utils/mongo-handler/
 * createSchema.js` declared exactly one index (the `sessions` TTL) and
 * left every other collection un-indexed. Every multi-field filter
 * (tasks by project/sprint, history by task, users by email, etc.)
 * was a collection scan.
 *
 * The fix adds compound + single-field indexes for the hottest filter
 * paths. This test loads the schema module and asserts each expected
 * index is registered on its schema. Indexes are stored in Mongoose's
 * `_indexes` array as `[fieldsObject, optionsObject]` tuples.
 *
 * Run from project root: `node .claude/tests/test-bug-021.js`
 */
'use strict';

const path = require('path');
const projectRoot = path.resolve(__dirname, '..', '..');
require.main.filename = path.join(projectRoot, 'server.js');

const schemas = require(path.join(projectRoot, 'utils', 'mongo-handler', 'createSchema.js'));

let passed = 0;
let failed = 0;
const failures = [];
function assert(name, cond, detail) {
    if (cond) { passed++; console.log(`  PASS  ${name}`); }
    else { failed++; failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

function hasIndex(schema, fields) {
    if (!schema || typeof schema.indexes !== 'function') return false;
    const want = JSON.stringify(fields);
    return schema.indexes().some(([f]) => JSON.stringify(f) === want);
}

section('Per-company collections');

assert('tasks: { ProjectID, sprintId, deletedStatusKey }',
    hasIndex(schemas.taskSchema, { ProjectID: 1, sprintId: 1, deletedStatusKey: 1 }));
assert('tasks: { sprintId, deletedStatusKey }',
    hasIndex(schemas.taskSchema, { sprintId: 1, deletedStatusKey: 1 }));
assert('tasks: { AssigneeUserId }',
    hasIndex(schemas.taskSchema, { AssigneeUserId: 1 }));
assert('tasks: { ParentTaskId }',
    hasIndex(schemas.taskSchema, { ParentTaskId: 1 }));
assert('tasks: { TaskKey }',
    hasIndex(schemas.taskSchema, { TaskKey: 1 }));

assert('comments: { "objId.taskId", deletedStatusKey }',
    hasIndex(schemas.commentSchema, { 'objId.taskId': 1, deletedStatusKey: 1 }));
assert('comments: { "objId.sprintId" }',
    hasIndex(schemas.commentSchema, { 'objId.sprintId': 1 }));
assert('comments: { "objId.projectId" }',
    hasIndex(schemas.commentSchema, { 'objId.projectId': 1 }));

assert('history: { TaskId, createdAt: -1 }',
    hasIndex(schemas.historySchema, { TaskId: 1, createdAt: -1 }));
assert('history: { ProjectId, createdAt: -1 }',
    hasIndex(schemas.historySchema, { ProjectId: 1, createdAt: -1 }));

assert('timesheet: { TicketID }',
    hasIndex(schemas.timeSheetSchema, { TicketID: 1 }));
assert('timesheet: { userId, ProjectId }',
    hasIndex(schemas.timeSheetSchema, { userId: 1, ProjectId: 1 }));

assert('userId: { userId }',
    hasIndex(schemas.userIdSchema, { userId: 1 }));

assert('sprints: { ProjectID, deletedStatusKey }',
    hasIndex(schemas.sprints, { ProjectID: 1, deletedStatusKey: 1 }));
assert('folders: { ProjectID }',
    hasIndex(schemas.folders, { ProjectID: 1 }));
assert('projects: { deletedStatusKey }',
    hasIndex(schemas.projectsSchema, { deletedStatusKey: 1 }));

section('Global DB collections');

assert('users: { Employee_Email }',
    hasIndex(schemas.usersSchema, { Employee_Email: 1 }));
assert('users: { AssignCompany }  (used by BUG-013 membership re-check)',
    hasIndex(schemas.usersSchema, { AssignCompany: 1 }));
assert('userAuth: { email }',
    hasIndex(schemas.userAuthSchema, { email: 1 }));
assert('companyUsers: { userId }',
    hasIndex(schemas.companyUserSchema, { userId: 1 }));
assert('sessions: { refreshToken }',
    hasIndex(schemas.sessionsSchema, { refreshToken: 1 }));
assert('sessions: { userId }',
    hasIndex(schemas.sessionsSchema, { userId: 1 }));
assert('sessions: { createdAt }  (pre-existing TTL, still there)',
    hasIndex(schemas.sessionsSchema, { createdAt: 1 }));
assert('resetAttempt: { ip }',
    hasIndex(schemas.resetAttemptSchema, { ip: 1 }));

console.log(`\n========================================`);
console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log('========================================');
if (failed > 0) {
    console.log('Failed cases:');
    failures.forEach((f) => console.log(`  - ${f.name}${f.detail ? ': ' + f.detail : ''}`));
    process.exit(1);
}
process.exit(0);
