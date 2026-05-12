/**
 * BUG-032 regression — soft-delete filter consistency.
 *
 * Three controller modules previously listed/counted soft-deleted documents:
 *   1. Modules/Comments/controller.js — getPaginatedMessages had no
 *      `isDeleted` filter (other endpoints did).
 *   2. Modules/Project/controller/getSprintFolder.js — the `count` branch
 *      counted all sprints/folders regardless of `deletedStatusKey`.
 *   3. Modules/tasks/controller/getTabSyncTasks.js — getTabSynctTaskWithTable
 *      used `{ $in: [0] }` which excluded legacy docs with the field unset.
 *
 * We can't stand up Mongo here, so we shim MongoDbCrudOpration with a spy
 * that captures every call. Each controller is invoked, then we hunt through
 * the captured calls for the relevant filter.
 */

const path = require('path');
const Module = require('module');

const calls = [];           // every (params, operation, type) captured here
let nextResponse = [];      // what the next MongoDbCrudOpration call returns

const fakeMongoQueries = {
    MongoDbCrudOpration: async function (companyId, params, op) {
        calls.push({
            type: params.type,
            op,
            params: JSON.parse(JSON.stringify(params))
        });
        return nextResponse;
    },
    validateObjectId: () => true
};

const fakeSchemaType = {
    SCHEMA_TYPE: {
        COMMENTS: 'comments',
        SPRINTS: 'sprints',
        FOLDERS: 'folders',
        TASKS: 'tasks',
        COMPANY_USERS: 'company_users',
        GOLBAL: 'global'
    }
};

const fakeLogger = { error: () => {}, info: () => {}, warn: () => {} };
const fakeStorage = { handleTaskAttachmentsDuplicateFunctionality: () => {} };
const fakeAuthHelper = { replaceObjectKey: x => x, relapceUndefinedvals: x => x };
const fakeSocket = { emit: () => {} };

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
    if (request.endsWith('mongo-handler/mongoQueries')) return 'fake-mongoQueries';
    if (request.endsWith('Config/schemaType') || request.endsWith('../../Config/schemaType') || request.endsWith('../../../Config/schemaType')) return 'fake-schemaType';
    if (request.endsWith('Config/loggerConfig')) return 'fake-logger';
    if (request.startsWith('../../common-storage') || request.startsWith('../../../common-storage')) return 'fake-storage';
    if (request.endsWith('Auth/helper')) return 'fake-auth-helper';
    if (request.endsWith('event/socketEventEmitter') || request.endsWith('../../event/socketEventEmitter')) return 'fake-socket';
    return originalResolve.call(this, request, parent, ...rest);
};

require.cache['fake-mongoQueries'] = { id: 'fake-mongoQueries', filename: 'fake-mongoQueries', loaded: true, exports: fakeMongoQueries };
require.cache['fake-schemaType'] = { id: 'fake-schemaType', filename: 'fake-schemaType', loaded: true, exports: fakeSchemaType };
require.cache['fake-logger'] = { id: 'fake-logger', filename: 'fake-logger', loaded: true, exports: fakeLogger };
require.cache['fake-storage'] = { id: 'fake-storage', filename: 'fake-storage', loaded: true, exports: fakeStorage };
require.cache['fake-auth-helper'] = { id: 'fake-auth-helper', filename: 'fake-auth-helper', loaded: true, exports: fakeAuthHelper };
require.cache['fake-socket'] = { id: 'fake-socket', filename: 'fake-socket', loaded: true, exports: fakeSocket };

function assert(cond, label) {
    if (!cond) {
        console.error('FAIL:', label);
        console.error('calls so far:');
        calls.forEach((c, i) => console.error(`  [${i}] ${c.type} (${c.op}):`, JSON.stringify(c.params).slice(0, 400)));
        process.exit(1);
    }
    console.log('PASS:', label);
}

function makeRes() {
    return {
        status() { return this; },
        json() { return this; }
    };
}

(async function main() {
    const validId = '507f1f77bcf86cd799439011';

    // ---- 1. Comments.getPaginatedMessages now filters isDeleted ----
    const commentsCtrl = require(path.resolve(__dirname, '../../Modules/Comments/controller.js'));
    calls.length = 0;
    nextResponse = [];
    await commentsCtrl.getPaginatedMessages(
        {
            query: { projectId: validId, taskId: validId, isDefault: 'true' },
            headers: { companyid: 'co1' }
        },
        makeRes()
    );
    const paginatedCall = calls.find(c => c.type === 'comments' && c.op === 'aggregate');
    assert(!!paginatedCall, 'Comments.getPaginatedMessages issued an aggregate');
    const pipeline = paginatedCall.params.data[0];
    const matchAnd = pipeline[0].$match.$and;
    const hasIsDeletedFilter = matchAnd.some(c => c.isDeleted && c.isDeleted.$ne === true);
    assert(hasIsDeletedFilter, 'Comments.getPaginatedMessages includes `{ isDeleted: { $ne: true } }`');

    // ---- 2. Comments.searchMessageFromMainChat uses $ne: true (not bare false) ----
    calls.length = 0;
    nextResponse = [];
    await commentsCtrl.searchMessageFromMainChat(
        {
            query: { projectId: validId, sprintId: validId, taskId: validId, searchText: 'x' },
            headers: { companyid: 'co1' }
        },
        makeRes()
    );
    const searchCall = calls.find(c => c.type === 'comments' && c.op === 'find');
    assert(!!searchCall, 'Comments.searchMessageFromMainChat issued a find');
    const filter = searchCall.params.data[0];
    assert(filter.isDeleted && filter.isDeleted.$ne === true, 'Comments.searchMessageFromMainChat uses `$ne: true` (keeps legacy docs)');

    // ---- 3. getSprintFolder count branch filters out deleted sprints ----
    const sprintFolderCtrl = require(path.resolve(__dirname, '../../Modules/Project/controller/getSprintFolder.js'));
    calls.length = 0;
    nextResponse = null; // company_users findOne returns null → roleType undefined
    await sprintFolderCtrl.getSprintFolder(
        {
            params: { id: validId },
            headers: { companyid: 'co1' },
            uid: 'u1',
            query: { collection: 'sprints', count: '1' }
        },
        makeRes()
    );
    const sprintsAggregate = calls.find(c => c.type === 'sprints' && c.op === 'aggregate');
    assert(!!sprintsAggregate, 'getSprintFolder count branch issued a sprints aggregate');
    const sprintMatch = sprintsAggregate.params.data[0][0].$match;
    assert(
        sprintMatch.deletedStatusKey && Array.isArray(sprintMatch.deletedStatusKey.$nin) && sprintMatch.deletedStatusKey.$nin.includes(1),
        'getSprintFolder count branch filters `deletedStatusKey: { $nin: [1] }`'
    );

    // ---- 4. getTabSynctTaskWithTable accepts undefined deletedStatusKey ----
    const tabSync = require(path.resolve(__dirname, '../../Modules/tasks/controller/getTabSyncTasks.js'));
    calls.length = 0;
    nextResponse = [];
    await tabSync.getTabSynctTaskWithTable('co1', {
        body: {
            pid: validId,
            sprintId: validId,
            tabLeaveTime: '0',
            item: {},
            userId: 'u1',
            showAllTasks: true
        }
    });
    const taskCall = calls.find(c => c.type === 'tasks' && c.op === 'aggregate');
    assert(!!taskCall, 'getTabSynctTaskWithTable issued a tasks aggregate');
    const taskPipeline = taskCall.params.data[0];
    const andClauses = taskPipeline[0].$match.$and[0].$and;
    const deletedClause = andClauses.find(c => 'deletedStatusKey' in c);
    assert(!!deletedClause, 'getTabSynctTaskWithTable still has a deletedStatusKey filter');
    // JSON.stringify drops `undefined` from arrays — convert to null sentinel for comparison.
    // The original captured array has length 2 with [0, null] after JSON round-trip.
    const arr = deletedClause.deletedStatusKey.$in;
    assert(
        Array.isArray(arr) && arr.includes(0) && arr.length >= 2,
        'getTabSynctTaskWithTable now allows `deletedStatusKey: { $in: [0, undefined] }` (length >= 2 incl. 0)'
    );

    console.log('\nAll BUG-032 assertions passed.');
})().catch(err => {
    console.error('TEST ERROR:', err);
    process.exit(1);
});
