/* The List asks the server how many tasks each group holds, in one request. The query is built
   in the frontend and judged by the server's task query guard, so both ends are checked here. */
const Q = require('../frontend/src/store/ProjectData/taskQueries');
const { validatePipeline } = require('../Modules/Tasks/helpers/taskQueryGuard');
const { replaceObjectKey } = require('../Modules/Auth/helper');

const PID = '6aa3b13ed1b2a9fd26131a1e';
const SPRINT = '6aa3b13ed1b2a9fd26131a2f';

const status = (key) => ({ searchKey: 'statusKey', searchValue: key, conditions: [{ statusKey: { $eq: key } }] });
const assignee = (id) => ({ searchKey: 'AssigneeUserId', searchValue: [id], conditions: [{ AssigneeUserId: { $in: [id] } }] });
const overdue = { searchKey: 'DueDate', searchValue: 1790000000, mongoConditions: [{ DueDate: { dbDate: { $lte: new Date('2026-10-01T00:00:00.000Z') } } }] };
const everything = { searchKey: 'customField.f1', searchValue: '' };

const build = (items, extra = {}) => Q.groupCountsQuery({ pid: PID, sprintId: SPRINT, items, ...extra });

describe('the group counts query', () => {
    test('counts every group in one pipeline, over the tasks a page would bring', () => {
        const [match, facet] = build([status(1), status(2)]);
        expect(match).toEqual({ $match: { objId: { sprintId: SPRINT, ProjectID: PID }, deletedStatusKey: 0, isParentTask: true } });
        expect(facet).toEqual({
            $facet: {
                g0: [{ $match: { statusKey: { $eq: 1 } } }, { $count: 'count' }],
                g1: [{ $match: { statusKey: { $eq: 2 } } }, { $count: 'count' }],
            },
        });
    });

    test('keeps the restriction of someone who only sees their own tasks', () => {
        const [match] = build([status(1)], { showAllTasks: false, userId: 'u1' });
        expect(match.$match.AssigneeUserId).toEqual({ $in: ['u1'] });
        expect(build([status(1)], { showAllTasks: 2, userId: 'u1' })[0].$match.AssigneeUserId).toBeUndefined();
    });

    test.each([
        ['status', [status(1), status(2)]],
        ['assignee', [assignee('u1'), assignee('u2')]],
        ['due date', [overdue]],
        ['a group with no condition', [everything]],
    ])('passes the task query guard when grouped by %s', (label, items) => {
        expect(() => validatePipeline(build(items))).not.toThrow();
    });

    test('has its ids and dates converted inside the facets as well', () => {
        const converted = replaceObjectKey(validatePipeline(build([overdue])), ['objId', 'dbDate']);
        expect(String(converted[0].$match.ProjectID)).toBe(PID);
        expect(converted[1].$facet.g0[0].$match.DueDate.$lte).toBeInstanceOf(Date);
    });

    test('reads the answer back under the keys the List counts by, with 0 for an empty group', () => {
        const items = [status(1), status(2), assignee('u1')];
        expect(Q.readGroupCounts(items, { g0: [{ count: 99 }], g1: [], g2: [{ count: 4 }] }))
            .toEqual({ statusKey_1: 99, statusKey_2: 0, AssigneeUserId_u1: 4 });
        expect(Q.readGroupCounts(items, undefined)).toEqual({ statusKey_1: 0, statusKey_2: 0, AssigneeUserId_u1: 0 });
    });
});

describe('the count of the tasks archived lists hold', () => {
    const OTHER = '6aa3b13ed1b2a9fd26131a30';
    const counts = (extra = {}) => Q.listTaskCountsQuery({ pid: PID, sprintIds: [SPRINT, OTHER], ...extra });

    test('is one group per list over every task of it that is not in the trash', () => {
        expect(counts()).toEqual([
            { $match: { objId: { ProjectID: PID }, sprintId: { objId: { $in: [SPRINT, OTHER] } }, deletedStatusKey: { $ne: 1 } } },
            { $group: { _id: '$sprintId', count: { $sum: 1 } } },
        ]);
    });

    test('keeps the restriction of someone who only sees their own tasks', () => {
        expect(counts({ showAllTasks: false, userId: 'u1' })[0].$match.AssigneeUserId).toEqual({ $in: ['u1'] });
        expect(counts({ showAllTasks: null, userId: 'u1' })[0].$match.AssigneeUserId).toEqual({ $in: ['u1'] });
        expect(counts({ showAllTasks: true, userId: 'u1' })[0].$match.AssigneeUserId).toBeUndefined();
    });

    test('passes the task query guard and has its ids converted', () => {
        const converted = replaceObjectKey(validatePipeline(counts()), ['objId', 'dbDate']);
        expect(String(converted[0].$match.ProjectID)).toBe(PID);
        expect(converted[0].$match.sprintId.$in.map(String)).toEqual([SPRINT, OTHER]);
        expect(converted[0].$match.sprintId.$in[0]._bsontype).toBe('ObjectId');
    });

    test('reads the answer back by list, with 0 for a list the answer does not name', () => {
        expect(Q.readListTaskCounts([SPRINT, OTHER], [{ _id: OTHER, count: 2 }])).toEqual({ [SPRINT]: 0, [OTHER]: 2 });
        expect(Q.readListTaskCounts([SPRINT], undefined)).toEqual({ [SPRINT]: 0 });
    });
});
