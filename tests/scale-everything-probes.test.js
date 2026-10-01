/* Task 046, slice E4: the parts of the Everything measurement that need no server. The probes send what the page
   sends, so each request is built by the page's own builder and has to be one the endpoint accepts. */
const { everythingCases, largestGroup, detailOf, measureEverything, ENDPOINT } = require('../scripts/scale/lib/everythingProbes');
const { summarisePlan, planText } = require('../scripts/scale/lib/explain');
const { budgetOf, verdict, budgetText } = require('../scripts/scale/lib/report');
const { parseRequest, EverythingRefused } = require('../Modules/Tasks/helpers/everythingQuery');
const page = require('../frontend/src/views/Everything/everythingRequest');

const VIEWER = { now: new Date('2026-10-01T06:30:00.000Z'), timeZone: 'Asia/Kolkata' };
const ASSIGNEE = '6f0000000000000000000002';
const cases = everythingCases({ assignee: ASSIGNEE, viewer: VIEWER });
const byKey = Object.fromEntries(cases.map((probe) => [probe.key, probe]));

describe('the cases measured', () => {
    it('cover the first page, each grouping, the filters, both sorts and subtasks', () => {
        expect(cases.map((probe) => probe.key)).toEqual([
            'api.everythingFirstPage', 'api.everythingGroupStatus', 'api.everythingGroupAssignee', 'api.everythingGroupProject', 'api.everythingGroupDueDate',
            'api.everythingFilterAssignee', 'api.everythingHideDone', 'api.everythingSearch', 'api.everythingSortDue', 'api.everythingSubtasks',
        ]);
        expect(new Set(cases.map((probe) => probe.label)).size).toBe(cases.length);
    });

    it.each(cases.map((probe) => [probe.key, probe.request]))('%s is a request the endpoint accepts', (_key, request) => {
        let refusal = null;
        try { parseRequest(request); } catch (error) { if (!(error instanceof EverythingRefused)) throw error; refusal = `${error.field}: ${error.message}`; }
        expect(refusal).toBeNull();
    });

    it('are what the page sends: a first page of rows with the total, or the counts alone for a grouping', () => {
        expect(byKey['api.everythingFirstPage'].request).toEqual(page.firstRequest({ ...page.DEFAULT_SETTINGS, hideDone: false }, VIEWER));
        expect(byKey['api.everythingFirstPage'].request).toMatchObject({ limit: page.PAGE_SIZE, filter: {}, sort: { by: 'updatedAt', dir: 'desc' }, includeSubtasks: false });
        expect(byKey['api.everythingFirstPage'].request).not.toHaveProperty('group');
        ['status', 'assignee', 'project', 'dueDate'].forEach((kind) => {
            const key = `api.everythingGroup${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
            expect(byKey[key].request).toMatchObject({ group: kind, limit: 1, filter: {} });
        });
    });

    it('show done work everywhere except in the case that is about hiding it', () => {
        cases.filter((probe) => probe.key !== 'api.everythingHideDone').forEach((probe) => expect(probe.request.filter).not.toHaveProperty('statusType'));
        expect(byKey['api.everythingHideDone'].request.filter).toEqual({ statusType: page.OPEN_STATUS_TYPES });
    });

    it('filter by one assignee, search by a word, sort by due date and show subtasks, one thing at a time', () => {
        expect(byKey['api.everythingFilterAssignee'].request.filter).toEqual({ assignee: [ASSIGNEE] });
        expect(byKey['api.everythingSearch'].request.filter).toEqual({ search: 'login' });
        expect(byKey['api.everythingSortDue'].request.sort).toEqual({ by: 'DueDate', dir: 'asc' });
        expect(byKey['api.everythingSubtasks'].request.includeSubtasks).toBe(true);
    });
});

describe('the group a paging run walks', () => {
    it('is the largest status group, asked for the way the page asks for a group\'s rows', () => {
        const walk = largestGroup([{ key: 'Doing', count: 30 }, { key: 'To Do', count: 250 }, { key: 'Done', count: 0 }], VIEWER);
        expect(walk.group).toEqual({ id: 'status:To Do', key: 'To Do', count: 250, filter: { status: ['To Do'] } });
        const request = page.groupRequest(walk.base, walk.group.filter, { cursor: 'abc.def' });
        expect(request).toMatchObject({ filter: { status: ['To Do'] }, cursor: 'abc.def', limit: page.PAGE_SIZE });
        expect(() => parseRequest(request)).not.toThrow();
        expect(largestGroup([], VIEWER)).toBeNull();
    });
});

describe('budgets', () => {
    it('give every Everything request the task query\'s first-page budget, and the page the List\'s', () => {
        cases.forEach((probe) => expect(budgetOf(probe.key)).toEqual({ limit: 300, unit: 'ms' }));
        expect(budgetOf('api.everythingPageThrough')).toEqual({ limit: 300, unit: 'ms' });
        expect(budgetOf('everything.firstRows')).toEqual({ limit: 1500, unit: 'ms' });
        expect(budgetOf('everything.domNodes')).toBeNull();
        expect(budgetOf('api.search')).toBeNull();
    });

    it('are judged like the others: on the median, at 10,000 tasks', () => {
        expect(verdict({ key: 'api.everythingGroupAssignee', median: 412.4 }, 10000)).toBe('missed by 112.4 ms');
        expect(verdict({ key: 'api.everythingFirstPage', median: 20 }, 10000)).toBe('met');
        expect(budgetText({ key: 'everything.firstRows', median: 900 }, 10000)).toBe('< 1500 ms');
        expect(verdict({ key: 'api.everythingFirstPage', median: 20 }, 50000)).toBe('measured, no budget yet');
    });
});

describe('reading a query plan', () => {
    const scan = (indexName) => ({ stage: 'IXSCAN', indexName });
    const stats = (keys, docs, returned) => ({ nReturned: returned, totalKeysExamined: keys, totalDocsExamined: docs, executionTimeMillis: 3 });
    const fromIndex = {
        queryPlanner: { winningPlan: { stage: 'LIMIT', inputStage: { stage: 'PROJECTION_DEFAULT', inputStage: { stage: 'FETCH', inputStage: scan('ProjectID_1_deletedStatusKey_1_updatedAt_-1__id_1') } } } },
        executionStats: stats(51, 51, 51),
    };
    const sortedInMemory = {
        stages: [
            { $cursor: { queryPlanner: { winningPlan: { stage: 'SORT', inputStage: { stage: 'FETCH', inputStage: scan('ProjectID_1_sprintId_1_deletedStatusKey_1') } } }, executionStats: stats(12076, 12076, 51) } },
        ],
    };
    const merged = {
        queryPlanner: {
            winningPlan: {
                queryPlan: { stage: 'LIMIT', inputStage: { stage: 'FETCH', inputStage: { stage: 'SORT_MERGE', inputStages: [scan('ProjectID_1_deletedStatusKey_1_DueDate_1__id_1'), scan('ProjectID_1_deletedStatusKey_1_DueDate_1__id_1')] } } },
                slotBasedPlan: { stages: 'not read' },
            },
        },
        executionStats: stats(102, 51, 51),
    };
    const counted = {
        stages: [
            { $cursor: { queryPlanner: { winningPlan: { stage: 'FETCH', inputStage: scan('ProjectID_1_sprintId_1_deletedStatusKey_1') } }, executionStats: stats(12076, 12076, 10000) } },
            { $group: { _id: '$status.text', count: { $sum: 1 } } },
            { $sort: { sortKey: { _id: 1 } } },
        ],
    };

    it('says when the order comes from the index and how little was read', () => {
        expect(summarisePlan(fromIndex)).toEqual({
            stages: ['LIMIT', 'PROJECTION_DEFAULT', 'FETCH', 'IXSCAN'], indexes: ['ProjectID_1_deletedStatusKey_1_updatedAt_-1__id_1'],
            sortInMemory: false, collectionScan: false, pipelineStages: [], keysExamined: 51, docsExamined: 51, returned: 51, millis: 3,
        });
        expect(planText(summarisePlan(fromIndex))).toBe('index ProjectID_1_deletedStatusKey_1_updatedAt_-1__id_1, order from the index; 51 keys and 51 docs read for 51 returned');
    });

    it('says when every match was read and sorted in memory to return one page', () => {
        const summary = summarisePlan(sortedInMemory);
        expect(summary).toMatchObject({ sortInMemory: true, indexes: ['ProjectID_1_sprintId_1_deletedStatusKey_1'], docsExamined: 12076, returned: 51 });
        expect(planText(summary)).toBe('index ProjectID_1_sprintId_1_deletedStatusKey_1, sorted in memory; 12076 keys and 12076 docs read for 51 returned');
    });

    it('reads a merge of several index ranges as order from the index, under the slot-based engine too', () => {
        const summary = summarisePlan(merged);
        expect(summary).toMatchObject({ stages: ['LIMIT', 'FETCH', 'SORT_MERGE', 'IXSCAN'], indexes: ['ProjectID_1_deletedStatusKey_1_DueDate_1__id_1'], sortInMemory: false, keysExamined: 102 });
    });

    it('names what the server still does after the cursor, and does not call a sort of a few groups a sort of the rows', () => {
        const summary = summarisePlan(counted);
        expect(summary).toMatchObject({ pipelineStages: ['$group', '$sort'], sortInMemory: false, docsExamined: 12076, returned: 10000 });
        expect(planText(summary, { sorted: false })).toBe('index ProjectID_1_sprintId_1_deletedStatusKey_1; 12076 keys and 12076 docs read for 10000 returned');
    });

    it('names a collection scan, and reads nothing into an answer it does not understand', () => {
        expect(summarisePlan({ queryPlanner: { winningPlan: { stage: 'COLLSCAN' } }, executionStats: stats(0, 12076, 3) })).toMatchObject({ collectionScan: true, indexes: [] });
        expect(planText(summarisePlan({ queryPlanner: { winningPlan: { stage: 'COLLSCAN' } }, executionStats: stats(0, 12076, 3) }))).toContain('collection scan');
        expect(summarisePlan(null)).toEqual({
            stages: [], indexes: [], sortInMemory: false, collectionScan: false, pipelineStages: [], keysExamined: null, docsExamined: null, returned: null, millis: null,
        });
        expect(planText(summarisePlan({}))).toBe('no index named, order from the index; ? keys and ? docs read for ? returned');
    });
});

describe('the detail of a measured request', () => {
    it('gives rows, counts, size and both plans', () => {
        const plan = { indexes: ['i'], sortInMemory: false, collectionScan: false, keysExamined: 51, docsExamined: 51, returned: 51 };
        expect(detailOf({ rows: 50, bytes: 20480, groups: [{ key: null, count: 10000 }] }, null)).toBe('50 rows, 1 count, 20 kB');
        expect(detailOf({ rows: 1, bytes: 1024, groups: null }, { rows: plan, counts: null })).toBe('1 row, 1 kB; rows: index i, order from the index; 51 keys and 51 docs read for 51 returned');
        expect(detailOf({ rows: 1, bytes: 1024, groups: [1, 2] }, { rows: plan, counts: { ...plan, returned: 10000 } })).toContain('counts: index i; 51 keys and 51 docs read for 10000 returned');
    });
});

describe('a measuring run', () => {
    /* A stand-in for the endpoint: 130 tasks in two statuses, paged by a cursor that is the next offset. */
    const TASKS = Array.from({ length: 130 }, (_, n) => ({ _id: `t${n}`, TaskName: `Task ${n}`, AssigneeUserId: n % 2 ? [ASSIGNEE] : [], status: { text: n < 110 ? 'To Do' : 'Doing' }, updatedAt: '2026-10-01T00:00:00.000Z' }));
    const serverLike = () => {
        const calls = [];
        let inFlight = 0;
        let overlapped = false;
        const call = async (method, path, body) => {
            calls.push({ method, path, body });
            inFlight += 1;
            if (inFlight > 1) overlapped = true;
            await Promise.resolve();
            const names = body.filter.status;
            const matching = TASKS.filter((task) => !names || names.includes(task.status.text));
            const from = body.cursor ? Number(body.cursor) : 0;
            const rows = matching.slice(from, from + body.limit);
            const groups = body.cursor ? null : (body.group === 'status'
                ? ['Doing', 'To Do'].map((key) => ({ key, count: TASKS.filter((task) => task.status.text === key).length }))
                : [{ key: null, count: matching.length }]);
            inFlight -= 1;
            return { ms: 10 + calls.length, bytes: 2048, json: { status: true, data: { rows, groups, nextCursor: from + body.limit < matching.length ? String(from + body.limit) : null, projects: {} } } };
        };
        return { call, calls, overlapped: () => overlapped };
    };
    const run = async (over = {}) => {
        const server = serverLike();
        const pause = jest.fn(async () => {});
        const room = jest.fn(async () => 0);
        const session = { userId: 'owner', companyId: 'c1', project: { _id: '6f0000000000000000000a01' } };
        const result = await measureEverything({ base: 'http://localhost:4000', session, runs: 3, room, call: server.call, pause, viewer: VIEWER, ...over });
        return { ...result, server, pause, room };
    };

    it('posts only to the Everything endpoint, one request at a time, with a pause after each', async () => {
        const { server, pause } = await run();
        expect(server.calls.every((entry) => entry.method === 'POST' && entry.path === ENDPOINT)).toBe(true);
        expect(server.overlapped()).toBe(false);
        expect(pause).toHaveBeenCalledTimes(server.calls.length);
    });

    it('times each case over the runs asked for, after two warm-up calls that are not counted', async () => {
        const { metrics, room } = await run();
        const first = metrics.find((metric) => metric.key === 'api.everythingFirstPage');
        expect(first).toMatchObject({ runs: 3, unit: 'ms', rows: 50, bytes: 2048, detail: '50 rows, 1 count, 2 kB' });
        expect(metrics.slice(0, 10).map((metric) => metric.runs)).toEqual(Array(10).fill(3));
        expect(room).toHaveBeenCalledWith(5);
    });

    it('filters by an assignee it found on the first page', async () => {
        const { server } = await run();
        expect(server.calls.some((entry) => JSON.stringify(entry.body.filter) === JSON.stringify({ assignee: [ASSIGNEE] }))).toBe(true);
    });

    it('walks the largest group to its end by cursor and says whether each row came once', async () => {
        const { metrics, server } = await run();
        const walk = metrics.find((metric) => metric.key === 'api.everythingPageThrough');
        expect(walk).toMatchObject({ runs: 3, rows: 110 });
        expect(walk.detail).toContain('3 pages, 110 rows of 110 in "To Do", each row once');
        const pages = server.calls.filter((entry) => JSON.stringify(entry.body.filter.status) === JSON.stringify(['To Do']) && entry.body.limit === page.PAGE_SIZE);
        expect(pages.map((entry) => entry.body.cursor)).toEqual([undefined, '50', '100']);
    });

    it('reports how much it measured over: the big project, everything the person sees, and the subtasks', async () => {
        const { size } = await run();
        expect(size).toEqual({ tasks: 130, everythingTasks: 130, everythingSubtasks: 0, projects: null });
    });

    it('adds the query plans when it is given a way to read them', async () => {
        const plan = { stages: ['IXSCAN'], indexes: ['i'], sortInMemory: false, collectionScan: false, pipelineStages: [], keysExamined: 51, docsExamined: 51, returned: 51, millis: 1 };
        const explain = jest.fn(async (body, lastRow) => ({ rows: plan, counts: lastRow ? null : plan }));
        explain.projects = async () => 301;
        const { metrics, size } = await run({ explain });
        expect(metrics[0].detail).toContain('rows: index i, order from the index');
        expect(metrics[0].plans.counts).toEqual(plan);
        expect(metrics.find((metric) => metric.key === 'api.everythingPageThrough').detail).toContain('last page index i');
        expect(explain.mock.calls.at(-1)[1]).toMatchObject({ _id: 't99' });
        expect(size.projects).toBe(301);
    });

    it('says the build is too old when the server has no such endpoint', async () => {
        const call = async () => { throw new Error(`POST ${ENDPOINT} answered 404.`); };
        await expect(run({ call })).rejects.toThrow(/older than the Everything view/);
    });
});
