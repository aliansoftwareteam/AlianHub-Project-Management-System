/* Task 046 M2, slice E1: the pure builder behind POST /api/v2/tasks/everything. The client sends
   filter, group, sort and cursor as data; every stage that reaches MongoDB is built here. */
const q = require('../Modules/Tasks/helpers/everythingQuery');

const P1 = '6f0000000000000000000a01';
const P2 = '6f0000000000000000000a02';
const U1 = '6f0000000000000000000001';
const TASK = '6f0000000000000000000f01';
const KEY = Buffer.from('a key for the tests, long enough');

const refusal = (body) => {
    try {
        q.parseRequest(body);
    } catch (error) {
        if (error instanceof q.EverythingRefused) return error;
        throw error;
    }
    return null;
};
const NO_FILTER = { status: null, statusType: null, assignee: null, priority: null, dueDate: null, taskType: null, tags: null, search: null, projectIds: null };
const hexOf = (value) => JSON.parse(JSON.stringify(value));

describe('the request is data, checked at the boundary', () => {
    it('fills every default for an empty body', () => {
        const expected = {
            filter: NO_FILTER, group: 'none', sort: { by: 'updatedAt', dir: 'desc' }, cursor: null,
            limit: q.DEFAULT_LIMIT, includeSubtasks: false, includeClosedProjects: false, timezone: 'UTC',
        };
        expect(q.parseRequest({})).toEqual(expected);
        expect(q.parseRequest(undefined)).toEqual(expected);
    });

    it('sorts by due date soonest first unless told otherwise', () => {
        expect(q.parseRequest({ sort: { by: 'DueDate' } }).sort).toEqual({ by: 'DueDate', dir: 'asc' });
        expect(q.parseRequest({ sort: { by: 'DueDate', dir: 'desc' } }).sort).toEqual({ by: 'DueDate', dir: 'desc' });
        expect(q.parseRequest({ sort: { by: 'updatedAt', dir: 'asc' } }).sort).toEqual({ by: 'updatedAt', dir: 'asc' });
    });

    it('forces the page size to at most 100', () => {
        expect(q.MAX_LIMIT).toBe(100);
        expect(q.parseRequest({ limit: 5000 }).limit).toBe(100);
        expect(q.parseRequest({ limit: 7 }).limit).toBe(7);
    });

    it.each([0, -1, 1.5, '10', null, [10]])('refuses limit %p', (limit) => {
        expect(refusal({ limit })).toMatchObject({ field: 'limit' });
    });

    it.each([
        ['findQuery', { findQuery: [{ $match: {} }] }],
        ['pipeline', { pipeline: [] }],
        ['companyId', { companyId: P1 }],
        ['filter.$where', { filter: { $where: 'sleep(1000)' } }],
        ['filter.ProjectID', { filter: { ProjectID: { $exists: true } } }],
        ['filter.mainChat', { filter: { mainChat: true } }],
        ['filter.dueDate.$gte', { filter: { dueDate: { $gte: 0 } } }],
        ['sort.updatedAt', { sort: { updatedAt: -1 } }],
    ])('refuses the unknown key %s', (field, body) => {
        expect(refusal(body)).toMatchObject({ field });
    });

    it.each([
        ['body', []],
        ['body', 'filter'],
        ['filter', { filter: [] }],
        ['filter', { filter: 'status' }],
        ['group', { group: 'customField' }],
        ['group', { group: { $group: {} } }],
        ['sort', { sort: 'DueDate' }],
        ['sort.by', { sort: { by: 'TaskName' } }],
        ['sort.dir', { sort: { by: 'DueDate', dir: -1 } }],
        ['cursor', { cursor: 12 }],
        ['cursor', { cursor: 'x'.repeat(2000) }],
        ['includeSubtasks', { includeSubtasks: 'true' }],
        ['includeClosedProjects', { includeClosedProjects: 1 }],
        ['timezone', { timezone: 'Mars/Phobos' }],
        ['timezone', { timezone: 5 }],
        ['filter.status', { filter: { status: { $ne: null } } }],
        ['filter.status', { filter: { status: [{ $ne: null }] } }],
        ['filter.status', { filter: { status: ['x'.repeat(101)] } }],
        ['filter.status', { filter: { status: Array.from({ length: 101 }, (_, n) => n) } }],
        ['filter.status', { filter: { status: [1.5] } }],
        ['filter.statusType', { filter: { statusType: ['finished'] } }],
        ['filter.statusType', { filter: { statusType: 'active' } }],
        ['filter.statusType', { filter: { statusType: [{ $ne: 'close' }] } }],
        ['filter.assignee', { filter: { assignee: U1 } }],
        ['filter.assignee', { filter: { assignee: ['$where'] } }],
        ['filter.assignee', { filter: { assignee: [7] } }],
        ['filter.priority', { filter: { priority: [null] } }],
        ['filter.taskType', { filter: { taskType: [true] } }],
        ['filter.tags', { filter: { tags: [{ $in: [] }] } }],
        ['filter.search', { filter: { search: ['a'] } }],
        ['filter.search', { filter: { search: 'x'.repeat(201) } }],
        ['filter.projectIds', { filter: { projectIds: ['not-an-id'] } }],
        ['filter.projectIds', { filter: { projectIds: P1 } }],
        ['filter.projectIds', { filter: { projectIds: Array.from({ length: 501 }, () => P1) } }],
        ['filter.dueDate', { filter: { dueDate: '2026-10-01' } }],
        ['filter.dueDate.from', { filter: { dueDate: { from: 'yesterday' } } }],
        ['filter.dueDate.to', { filter: { dueDate: { to: {} } } }],
        ['filter.dueDate', { filter: { dueDate: { from: '2026-10-02T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' } } }],
        ['filter.dueDate.none', { filter: { dueDate: { none: 'yes' } } }],
        ['filter.dueDate', { filter: { dueDate: { none: true, from: 0 } } }],
    ])('refuses a bad %s', (field, body) => {
        expect(refusal(body)).toMatchObject({ field });
    });

    it('reads every filter into a fixed shape', () => {
        const { filter } = q.parseRequest({
            filter: {
                status: ['To Do', 2, 'To Do'],
                statusType: ['default_active', 'active', 'active'],
                assignee: ['unassigned', U1],
                priority: ['HIGH'],
                dueDate: { from: '2026-10-01T00:00:00.000Z', to: 1790812800000 },
                taskType: ['Bug', 3],
                tags: ['tag-1'],
                search: '  a.b  ',
                projectIds: [P1.toUpperCase(), P1],
            },
        });
        expect(filter).toEqual({
            status: { names: ['To Do'], keys: [2] },
            statusType: ['default_active', 'active'],
            assignee: { ids: [U1], unassigned: true },
            priority: ['HIGH'],
            dueDate: { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date(1790812800000), none: false },
            taskType: { names: ['Bug'], keys: [3] },
            tags: ['tag-1'],
            search: 'a.b',
            projectIds: [P1],
        });
    });

    it('reads an empty list or an empty search as no filter', () => {
        expect(q.parseRequest({ filter: { status: [], statusType: [], assignee: [], priority: [], taskType: [], tags: [], search: '   ', projectIds: [], dueDate: {} } }).filter).toEqual(NO_FILTER);
    });

    it('reads "no due date" and a timezone', () => {
        expect(q.parseRequest({ filter: { dueDate: { none: true } } }).filter.dueDate).toEqual({ from: null, to: null, none: true });
        expect(q.parseRequest({ timezone: 'Asia/Kolkata' }).timezone).toBe('Asia/Kolkata');
    });
});

describe('the projects a request reads', () => {
    it('are the ones the caller can open, and a named project only narrows them', () => {
        expect(q.scopedProjectIds([P1, P2], null)).toEqual([P1, P2]);
        expect(q.scopedProjectIds([P1, P2], [P2])).toEqual([P2]);
        expect(q.scopedProjectIds([P1], [P2])).toEqual([]);
        expect(q.scopedProjectIds([P1], [P2, P1])).toEqual([P1]);
    });

    it('leave out trashed, archived, restricted and closed projects and other people\'s personal lists', () => {
        const filter = q.projectMatch([P1, P2], U1, false);
        expect(hexOf(filter)).toEqual({
            _id: { $in: [P1, P2] },
            deletedStatusKey: { $nin: [1, 2] },
            isRestrict: { $ne: true },
            statusType: { $ne: 'close' },
            $or: [{ isPersonal: { $ne: true } }, { personalOwner: U1 }],
        });
        expect(filter._id.$in[0]._bsontype).toBe('ObjectId');
    });

    it('keep closed projects when asked, and still no archived or trashed one', () => {
        const filter = q.projectMatch([P1], U1, true);
        expect(filter.statusType).toBeUndefined();
        expect(filter.deletedStatusKey).toEqual({ $nin: [1, 2] });
        expect(filter.isRestrict).toEqual({ $ne: true });
        expect(filter.$or).toEqual([{ isPersonal: { $ne: true } }, { personalOwner: U1 }]);
    });
});

describe('the task match', () => {
    const scope = { projectIds: [P1, P2], hiddenSprintIds: [] };
    const matchOf = (body, over = {}) => q.buildMatch(q.parseRequest(body), { ...scope, ...over });

    it('always carries the scope, whatever the request says', () => {
        expect(matchOf({})).toEqual({ ProjectID: { $in: [P1, P2] }, deletedStatusKey: 0, mainChat: { $ne: true }, isParentTask: true });
    });

    it('shows subtasks only when asked', () => {
        expect(matchOf({ includeSubtasks: true })).toEqual({ ProjectID: { $in: [P1, P2] }, deletedStatusKey: 0, mainChat: { $ne: true } });
    });

    it('reads the tasks a closed project holds only when closed projects are asked for', () => {
        expect(matchOf({ includeClosedProjects: true }).deletedStatusKey).toEqual({ $in: [0, 8] });
    });

    it('leaves out the sprints the caller is not on', () => {
        expect(matchOf({}, { hiddenSprintIds: ['s1', 's2'] }).sprintId).toEqual({ $nin: ['s1', 's2'] });
        expect(matchOf({})).not.toHaveProperty('sprintId');
    });

    it('adds each filter as its own clause, so none can replace the scope', () => {
        const match = matchOf({
            filter: {
                status: ['To Do', 2],
                statusType: ['default_active', 'active'],
                assignee: ['unassigned', U1],
                priority: ['HIGH', 'LOW'],
                dueDate: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T00:00:00.000Z' },
                taskType: ['Bug'],
                tags: ['tag-1'],
                search: 'a.b*(c)',
                projectIds: [P1],
            },
        });
        expect(match.ProjectID).toEqual({ $in: [P1, P2] });
        expect(match.$and).toEqual([
            { $or: [{ 'status.text': { $in: ['To Do'] } }, { statusKey: { $in: [2] } }] },
            { statusType: { $in: ['default_active', 'active'] } },
            { $or: [{ AssigneeUserId: { $in: [U1] } }, { AssigneeUserId: { $size: 0 } }, { AssigneeUserId: null }] },
            { Task_Priority: { $in: ['HIGH', 'LOW'] } },
            { DueDate: { $gte: new Date('2026-10-01T00:00:00.000Z'), $lte: new Date('2026-10-31T00:00:00.000Z') } },
            { TaskType: { $in: ['Bug'] } },
            { tagsArray: { $in: ['tag-1'] } },
            { TaskName: { $regex: 'a\\.b\\*\\(c\\)', $options: 'i' } },
        ]);
    });

    it('keeps a one-sided filter plain', () => {
        expect(matchOf({ filter: { status: [3], assignee: [U1], taskType: [4], dueDate: { to: '2026-10-31T00:00:00.000Z' } } }).$and).toEqual([
            { statusKey: { $in: [3] } },
            { AssigneeUserId: { $in: [U1] } },
            { DueDate: { $lte: new Date('2026-10-31T00:00:00.000Z') } },
            { TaskTypeKey: { $in: [4] } },
        ]);
        expect(matchOf({ filter: { dueDate: { none: true }, assignee: ['unassigned'] } }).$and).toEqual([
            { $or: [{ AssigneeUserId: { $size: 0 } }, { AssigneeUserId: null }] },
            { DueDate: null },
        ]);
    });
});

describe('one page of rows', () => {
    const match = { ProjectID: { $in: [P1] }, deletedStatusKey: 0, mainChat: { $ne: true }, isParentTask: true, $and: [{ Task_Priority: { $in: ['HIGH'] } }] };
    const NEWEST = { by: 'updatedAt', dir: 'desc' };
    const SOONEST = { by: 'DueDate', dir: 'asc' };
    const at = new Date('2026-10-01T10:00:00.000Z');

    it('reads dated rows in the order of the index, with a fixed projection and a limit', () => {
        expect(q.pagePipeline(match, NEWEST, { segment: 'dated', after: null, limit: 51 })).toEqual([
            { $match: { ...match, $and: [{ Task_Priority: { $in: ['HIGH'] } }, { updatedAt: { $type: 'date' } }] } },
            { $sort: { updatedAt: -1, _id: 1 } },
            { $limit: 51 },
            { $project: q.ROW_FIELDS },
        ]);
    });

    it.each([
        [NEWEST, { updatedAt: -1, _id: 1 }],
        [{ by: 'updatedAt', dir: 'asc' }, { updatedAt: 1, _id: -1 }],
        [SOONEST, { DueDate: 1, _id: 1 }],
        [{ by: 'DueDate', dir: 'desc' }, { DueDate: -1, _id: -1 }],
    ])('sorts %j as the index or its mirror image', (sort, expected) => {
        expect(q.pagePipeline(match, sort, { segment: 'dated', after: null, limit: 10 })[1]).toEqual({ $sort: expected });
    });

    it('continues after the last row by sort key, then by _id', () => {
        const [stage] = q.pagePipeline(match, NEWEST, { segment: 'dated', after: { value: at.getTime(), id: TASK }, limit: 10 });
        expect(hexOf(stage.$match.$and)).toEqual(hexOf([
            { Task_Priority: { $in: ['HIGH'] } },
            { updatedAt: { $lte: at }, $or: [{ updatedAt: { $lt: at } }, { updatedAt: at, _id: { $gt: TASK } }] },
        ]));
        const [soonest] = q.pagePipeline(match, SOONEST, { segment: 'dated', after: { value: at.getTime(), id: TASK }, limit: 10 });
        expect(hexOf(soonest.$match.$and[1])).toEqual(hexOf({ DueDate: { $gte: at }, $or: [{ DueDate: { $gt: at } }, { DueDate: at, _id: { $gt: TASK } }] }));
        expect(soonest.$match.$and[1].$or[1]._id.$gt._bsontype).toBe('ObjectId');
    });

    it('reads the rows with no date last, by _id', () => {
        expect(q.pagePipeline(match, SOONEST, { segment: 'undated', after: null, limit: 10 }).slice(0, 2)).toEqual([
            { $match: { ...match, $and: [{ Task_Priority: { $in: ['HIGH'] } }, { DueDate: null }] } },
            { $sort: { _id: 1 } },
        ]);
        const [stage, sort] = q.pagePipeline(match, { by: 'DueDate', dir: 'desc' }, { segment: 'undated', after: { value: null, id: TASK }, limit: 10 });
        expect(hexOf(stage.$match.$and)).toEqual([{ Task_Priority: { $in: ['HIGH'] } }, { DueDate: null }, { _id: { $lt: TASK } }]);
        expect(sort).toEqual({ $sort: { _id: -1 } });
    });

    it('does not change the match it was given', () => {
        const before = JSON.stringify(match);
        q.pagePipeline(match, NEWEST, { segment: 'dated', after: { value: at.getTime(), id: TASK }, limit: 10 });
        expect(JSON.stringify(match)).toBe(before);
    });

    it('returns what a List row needs and nothing heavier', () => {
        ['TaskName', 'TaskKey', 'status', 'statusKey', 'statusType', 'Task_Priority', 'AssigneeUserId', 'DueDate', 'startDate', 'ProjectID', 'sprintId', 'TaskType', 'TaskTypeKey', 'tagsArray', 'subTasks', 'ancestors', 'ParentTaskId', 'isParentTask', 'updatedAt']
            .forEach((field) => expect(q.ROW_FIELDS[field]).toBe(1));
        ['description', 'rawDescription', 'descriptionBlock', 'customField', 'watchers', 'attachments', 'checklistArray', 'CompanyId', 'updateToken']
            .forEach((field) => expect(q.ROW_FIELDS).not.toHaveProperty(field));
    });

    it('names where a row sits for the next page', () => {
        expect(q.positionOf({ _id: TASK, updatedAt: at }, NEWEST)).toEqual({ value: at.getTime(), id: TASK });
        expect(q.positionOf({ _id: TASK }, SOONEST)).toEqual({ value: null, id: TASK });
    });
});

describe('group counts', () => {
    const match = { ProjectID: { $in: [P1] }, deletedStatusKey: 0 };
    const stagesFor = (group, timezone = 'UTC') => q.groupPipeline(match, { group, timezone });

    it.each([
        ['none', null],
        ['status', '$status.text'],
        ['project', '$ProjectID'],
        ['priority', '$Task_Priority'],
    ])('counts by %s over the same match', (group, id) => {
        expect(stagesFor(group)).toEqual([{ $match: match }, { $group: { _id: id, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
    });

    it('counts a task once under each of its assignees, and under nobody when it has none', () => {
        expect(stagesFor('assignee')).toEqual([
            { $match: match },
            { $unwind: { path: '$AssigneeUserId', preserveNullAndEmptyArrays: true } },
            { $group: { _id: '$AssigneeUserId', count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
        ]);
    });

    it('counts due dates by calendar day in the caller\'s timezone', () => {
        expect(stagesFor('dueDate', 'Asia/Kolkata')[1]).toEqual({
            $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$DueDate', timezone: 'Asia/Kolkata' } }, count: { $sum: 1 } },
        });
    });

    it('shapes the counts, with ids as strings and "none" as null', () => {
        expect(q.shapeGroups([{ _id: null, count: 2 }, { _id: 'Doing', count: 1 }], 'status')).toEqual([{ key: null, count: 2 }, { key: 'Doing', count: 1 }]);
        expect(q.shapeGroups([{ _id: { toString: () => P1 }, count: 3 }], 'project')).toEqual([{ key: P1, count: 3 }]);
        expect(q.shapeGroups([], 'none')).toEqual([{ key: null, count: 0 }]);
        expect(q.shapeGroups([], 'status')).toEqual([]);
    });
});

describe('the cursor', () => {
    const request = q.parseRequest({ filter: { priority: ['HIGH'] }, sort: { by: 'DueDate' } });
    const binding = q.queryBinding({ companyId: 'c1', uid: U1 }, request);
    const position = { value: 1790812800000, id: TASK };

    it('round-trips a position', () => {
        const cursor = q.encodeCursor(position, binding, KEY);
        expect(cursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
        expect(q.decodeCursor(cursor, binding, KEY)).toEqual(position);
        expect(q.decodeCursor(q.encodeCursor({ value: null, id: TASK }, binding, KEY), binding, KEY)).toEqual({ value: null, id: TASK });
    });

    const refused = (cursor, withBinding = binding, key = KEY) => {
        try {
            q.decodeCursor(cursor, withBinding, key);
        } catch (error) {
            return error instanceof q.EverythingRefused ? error.field : `threw ${error.message}`;
        }
        return 'accepted';
    };

    it('refuses a cursor that was changed, re-signed by someone else or made up', () => {
        const cursor = q.encodeCursor(position, binding, KEY);
        const [body, mac] = cursor.split('.');
        const forged = Buffer.from(JSON.stringify({ v: 0, i: TASK, q: binding })).toString('base64url');
        expect(refused(`${forged}.${mac}`)).toBe('cursor');
        expect(refused(`${body}.${mac.slice(0, -2)}xx`)).toBe('cursor');
        expect(refused(body)).toBe('cursor');
        expect(refused(`${body}.${mac}.${mac}`)).toBe('cursor');
        expect(refused('not a cursor')).toBe('cursor');
        expect(refused(cursor, binding, Buffer.from('another key, just as long as it'))).toBe('cursor');
        expect(refused(cursor)).toBe('accepted');
    });

    it('is good only for the query, the company and the person it was issued to', () => {
        const cursor = q.encodeCursor(position, binding, KEY);
        const other = (ctx, body) => q.queryBinding(ctx, q.parseRequest(body));
        const same = { filter: { priority: ['HIGH'] }, sort: { by: 'DueDate' } };
        expect(refused(cursor, other({ companyId: 'c1', uid: U1 }, same))).toBe('accepted');
        expect(refused(cursor, other({ companyId: 'c1', uid: U1 }, { ...same, limit: 10, group: 'status', timezone: 'Asia/Kolkata' }))).toBe('accepted');
        expect(refused(cursor, other({ companyId: 'c2', uid: U1 }, same))).toBe('cursor');
        expect(refused(cursor, other({ companyId: 'c1', uid: P1 }, same))).toBe('cursor');
        expect(refused(cursor, other({ companyId: 'c1', uid: U1 }, { ...same, filter: { priority: ['LOW'] } }))).toBe('cursor');
        expect(refused(cursor, other({ companyId: 'c1', uid: U1 }, { ...same, sort: { by: 'DueDate', dir: 'desc' } }))).toBe('cursor');
        expect(refused(cursor, other({ companyId: 'c1', uid: U1 }, { ...same, filter: { priority: ['HIGH'], statusType: ['active'] } }))).toBe('cursor');
        expect(refused(cursor, other({ companyId: 'c1', uid: U1 }, { ...same, includeSubtasks: true }))).toBe('cursor');
        expect(refused(cursor, other({ companyId: 'c1', uid: U1 }, { ...same, includeClosedProjects: true }))).toBe('cursor');
    });

    it('refuses a signed cursor whose position is not one', () => {
        const signed = (claims) => {
            const body = Buffer.from(JSON.stringify({ ...claims, q: binding })).toString('base64url');
            return `${body}.${require('crypto').createHmac('sha256', KEY).update(body).digest('base64url')}`;
        };
        expect(refused(signed({ v: 1, i: TASK }))).toBe('accepted');
        expect(refused(signed({ v: 'now', i: TASK }))).toBe('cursor');
        expect(refused(signed({ v: 1, i: { $gt: '' } }))).toBe('cursor');
        expect(refused(signed({ v: 1 }))).toBe('cursor');
    });
});

describe('status types', () => {
    it('are the four a project status can have, and the legacy closed one', () => {
        expect(q.STATUS_TYPES).toEqual(['default_active', 'active', 'done', 'close', 'default_close']);
        expect(q.parseRequest({ filter: { statusType: q.STATUS_TYPES } }).filter.statusType).toEqual(q.STATUS_TYPES);
    });
});

describe('a role that is denied the task list', () => {
    const MEMBER_ROLE = 3;
    const rules = (permission, projectId) => {
        const parent = { _id: `task-${projectId || 'company'}`, key: 'task', isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }], ...(projectId ? { projectId } : {}) };
        return [parent, { _id: `list-${projectId || 'company'}`, key: 'task_list', isParent: false, parentId: parent._id, roles: [{ key: MEMBER_ROLE, permission }], ...(projectId ? { projectId } : {}) }];
    };
    const projects = [
        { _id: P1 },
        { _id: P2, isGlobalPermission: false },
        { _id: U1, isGlobalPermission: true },
        { _id: TASK, isPersonal: true, isGlobalPermission: false },
    ];
    const idsFor = (companyPermission, projectPermission) => q.taskListProjectIds(projects, MEMBER_ROLE, rules(companyPermission), rules(projectPermission, P2));

    it('reads a project by its own rules when it has them, and by the company rules otherwise', () => {
        expect(idsFor(true, true)).toEqual([P1, P2, U1, TASK]);
        expect(idsFor(true, null)).toEqual([P1, U1, TASK]);
        expect(idsFor(null, true)).toEqual([P2, TASK]);
        expect(idsFor(null, null)).toEqual([TASK]);
    });

    it('keeps a role that may only look', () => {
        expect(idsFor(false, false)).toEqual([P1, P2, U1, TASK]);
    });

    it('drops every project whose rules cannot be read, and keeps the caller\'s own personal list', () => {
        expect(q.taskListProjectIds(projects, MEMBER_ROLE, [], [])).toEqual([TASK]);
        expect(q.taskListProjectIds(projects, 7, rules(true), rules(true, P2))).toEqual([TASK]);
    });
});
