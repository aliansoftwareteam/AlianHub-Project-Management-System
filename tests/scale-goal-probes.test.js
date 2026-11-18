/* The scale measurement's goal timings: what they send, without a server. */
const { GOAL_NAME, MAX_SOURCE_LISTS, goalProbes } = require('../scripts/scale/lib/goalProbes');
const rules = require('../Modules/Goals/helpers/goalRules');

const listId = (i) => `6f00000000000000000b${String(i).padStart(4, '0')}`;
const lists = (n) => Array.from({ length: n }, (_, i) => ({ _id: listId(i), name: `List ${i}` }));
const goal = (over = {}) => ({ _id: 'g1', name: GOAL_NAME, targets: [{ id: 't1', kind: 'tasks', counted: { done: 4, total: 10 } }], ...over });

const server = ({ stored = [], counted = { done: 2500, total: 10000 } } = {}) => {
    const sent = [];
    const call = jest.fn(async (method, path, body) => {
        sent.push([method, path, body]);
        if (method === 'GET') return { ms: 1, bytes: 10, json: { data: stored } };
        if (method === 'POST') return { ms: 1, bytes: 10, json: { data: goal({ _id: 'made' }) } };
        return { ms: 7, bytes: 20, json: { data: goal({ targets: [{ id: 't1', kind: 'tasks', counted }] }) } };
    });
    return { call, sent };
};

describe('the goal timings', () => {
    it('make the goal once, over every list of the project, and find it again on a later run', async () => {
        const first = server();
        await goalProbes({ call: first.call, lists: lists(3) });
        expect(first.sent).toEqual([
            ['GET', '/api/v2/goals', undefined],
            ['POST', '/api/v2/goals', { name: GOAL_NAME, targets: [{ name: 'Every list of the project', kind: 'tasks', sources: { sprintIds: [listId(0), listId(1), listId(2)], taskIds: [] } }] }],
        ]);

        const later = server({ stored: [{ _id: 'other', name: 'Another goal', targets: [] }, goal()] });
        await goalProbes({ call: later.call, lists: lists(3) });
        expect(later.sent).toEqual([['GET', '/api/v2/goals', undefined]]);
    });

    it('time a count through the request that always makes one, and report how many tasks it counted', async () => {
        const { call, sent } = server({ stored: [goal()] });
        const [recount, list] = await goalProbes({ call, lists: lists(2) });
        expect([recount.key, list.key]).toEqual(['api.goalRecount', 'api.goalsList']);
        sent.length = 0;
        expect(await recount.run()).toMatchObject({ ms: 7, bytes: 20, rows: 10000 });
        expect(sent).toEqual([['PATCH', '/api/v2/goals/g1/targets/t1', { sources: { sprintIds: [listId(0), listId(1)], taskIds: [] } }]]);
        await list.run();
        expect(sent[1]).toEqual(['GET', '/api/v2/goals', undefined]);
    });

    it('link no more lists than a target may hold', async () => {
        expect(MAX_SOURCE_LISTS).toBe(rules.MAX_SOURCE_LISTS);
        const { call, sent } = server();
        await goalProbes({ call, lists: lists(MAX_SOURCE_LISTS + 5) });
        expect(sent[1][2].targets[0].sources.sprintIds).toHaveLength(MAX_SOURCE_LISTS);
        expect(() => rules.parseNewTarget(sent[1][2].targets[0])).not.toThrow(rules.GoalRefused);
    });

    it('are left out, with the reason, on a server that has no goals or a goal with nothing to count', async () => {
        const log = jest.fn();
        const down = jest.fn(async () => { throw new Error('GET /api/v2/goals answered 404.'); });
        expect(await goalProbes({ call: down, lists: lists(2), log })).toEqual([]);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('answered 404'));

        const { call } = server({ stored: [goal({ targets: [] })] });
        expect(await goalProbes({ call, lists: lists(2), log })).toEqual([]);
        expect(log).toHaveBeenCalledTimes(2);
    });
});
