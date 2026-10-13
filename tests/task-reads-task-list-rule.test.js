const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Comments/controller', () => ({ searchComments: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { taskListRules } = require('./fixtures/taskListRules');
const { getTask, getTaskByQyery } = require('../Modules/Tasks/helpers/getTasksData');
const { getTabSyncTasks } = require('../Modules/Tasks/controller/getTabSyncTasks');
const { getQueryFun } = require('../Modules/Project/controller/getQueryFun');
const exportsCtrl = require('../Modules/ExportJobs/controller');
const dashboard = require('../Modules/UserDashboard/controller');
const { getAtRisk } = require('../Modules/UserDashboard/atRisk');
const { globalSearch } = require('../Modules/GlobalSearch/controller');
const { taskListProjectIds } = require('../Modules/Tasks/helpers/taskListProjects');
const calendar = require('../Modules/Calendar/controller');
const { visibleTask } = require('../Modules/AI/taskAccess');
const { commentThreadAccess } = require('../Modules/Comments/helpers/threadAccess');
const rooms = require('../socket/roomAccess');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const READER = '6f0000000000000000000004';
const NO_LIST = '6f0000000000000000000005';
const ROLES = { [OWNER]: 1, [MEMBER]: 3, [READER]: 4, [NO_LIST]: 5 };
const EVERYONE = [MEMBER, READER, NO_LIST];

const IN_COMPANY_RULES = 'task under the company rules';
const IN_OWN_RULES = 'task under its own rules';
const IN_PERSONAL = 'task on a personal list';

const oid = () => new mongoose.Types.ObjectId().toString();
const soon = () => new Date(Date.now() + 2 * 86400000);

const response = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    res.send = res.json;
    return res;
};

const request = (uid, extra = {}) => ({ uid, aud: C, headers: { companyid: C }, params: {}, query: {}, body: {}, ...extra });
const run = async (handlers, req) => {
    const res = response();
    for (const handler of [].concat(handlers)) {
        let advanced = false;
        await handler(req, res, () => { advanced = true; });
        if (!advanced) break;
    }
    return res;
};
const names = (rows) => (rows || []).map((row) => row.TaskName || row.taskName || row.title).sort();

let fx;

const seedProject = (ProjectName, over = {}) => {
    const project = mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName, isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0, statusType: 'active', isGlobalPermission: true, ...over });
    const sprint = mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: 'List', projectId: String(project._id), deletedStatusKey: 0 });
    return { id: String(project._id), sprint: String(sprint._id) };
};

const seedTask = (place, TaskName, over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: oid(),
    TaskName,
    TaskKey: TaskName.slice(0, 3),
    CompanyId: C,
    ProjectID: place.id,
    sprintId: place.sprint,
    AssigneeUserId: EVERYONE,
    isParentTask: true,
    deletedStatusKey: 0,
    statusType: 'active',
    DueDate: soon(),
    startDate: soon(),
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-02T00:00:00Z'),
    ...over,
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    myCache.flushAll();
    Object.entries(ROLES).forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    taskListRules({ 3: true, 4: false }).forEach((rule) => mockDb.seed(SCHEMA_TYPE.RULES, rule));

    const company = seedProject('Company rules');
    const own = seedProject('Own rules', { isGlobalPermission: false });
    const personal = seedProject('Personal', { isPrivateSpace: true, isPersonal: true, personalOwner: NO_LIST, AssigneeUserId: [NO_LIST] });
    taskListRules({ 4: true, 5: false }, { projectId: own.id }).forEach((rule) => mockDb.seed(SCHEMA_TYPE.PROJECT_RULES, rule));
    fx = {
        company,
        own,
        personal,
        tasks: {
            company: seedTask(company, IN_COMPANY_RULES),
            own: seedTask(own, IN_OWN_RULES),
            personal: seedTask(personal, IN_PERSONAL, { AssigneeUserId: [NO_LIST] }),
        },
    };
});

/* Who may list what: the member's role is unset in the project with its own rules, the reader is
 * read-only in the company rules, and the last role is unset in the company rules. */
const EXPECTED = [
    ['a role the project leaves unset', MEMBER, [IN_COMPANY_RULES]],
    ['a read-only role', READER, [IN_COMPANY_RULES, IN_OWN_RULES]],
    ['a role the company leaves unset', NO_LIST, [IN_PERSONAL, IN_OWN_RULES]],
    ['an owner', OWNER, [IN_COMPANY_RULES, IN_OWN_RULES]],
];

const READS = {
    'the task query': async (uid) => names((await run(getTaskByQyery, request(uid, { body: { findQuery: [{ $match: {} }] } }))).body),
    'the single task read': async (uid) => {
        const readable = [];
        for (const task of Object.values(fx.tasks)) {
            const res = await run(getTask, request(uid, { params: { id: String(task._id) } }));
            if (res.statusCode === 200) readable.push(res.body);
        }
        return names(readable);
    },
    'the tab refresh': async (uid) => {
        const found = [];
        for (const place of [fx.company, fx.own, fx.personal]) {
            const body = { pid: place.id, sprintId: place.sprint, istableTask: false, tabLeaveTime: 0, userId: uid, item: { indexName: 'createdAt' } };
            const res = await new Promise((resolve) => {
                const answer = response();
                const json = answer.json;
                answer.json = (payload) => { json(payload); resolve(answer); return answer; };
                getTabSyncTasks(request(uid, { body }), answer);
            });
            if (res.statusCode === 200) found.push(...((res.body[0] && res.body[0].result) || []));
        }
        return names(found);
    },
    'the table tab refresh': async (uid) => {
        const found = [];
        for (const place of [fx.company, fx.own, fx.personal]) {
            const body = { pid: place.id, sprintId: place.sprint, istableTask: true, tabLeaveTime: 0, userId: uid, item: { indexName: 'createdAt' } };
            const res = await new Promise((resolve) => {
                const answer = response();
                const json = answer.json;
                answer.json = (payload) => { json(payload); resolve(answer); return answer; };
                getTabSyncTasks(request(uid, { body }), answer);
            });
            if (res.statusCode === 200) found.push(...(res.body || []));
        }
        return names(found);
    },
    'the task panel read': async (uid) => {
        const opened = [];
        for (const task of Object.values(fx.tasks)) {
            const res = await run(getQueryFun, request(uid, { query: { taskId: String(task._id), projectId: String(task.ProjectID), subTaskLimit: '5' } }));
            if (res.statusCode !== 404) opened.push(task);
        }
        return names(opened);
    },
    'the advanced search': async (uid) => {
        const table = {};
        const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
        require('../Modules/AdvancedGlobalFilter/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), delete: register('DELETE') });
        const body = { searchText: '', pids: [fx.company.id, fx.own.id, fx.personal.id], batchSize: 50 };
        return names((await run(table['POST /api/v1/advance/filter/search/tasks'], request(uid, { body }))).body.data);
    },
    'the global search': async (uid) => {
        const res = await run(globalSearch, request(uid, { body: { query: 'task' } }));
        return names(((res.body && res.body.data && res.body.data.tasks) || []));
    },
    'the export': async (uid) => {
        const started = [];
        const immediate = jest.spyOn(global, 'setImmediate').mockImplementation(() => {});
        for (const [key, place] of [['company', fx.company], ['own', fx.own], ['personal', fx.personal]]) {
            const res = await run(exportsCtrl.createExport, request(uid, { body: { format: 'csv', projectId: place.id, projectName: 'x' } }));
            if (res.body && res.body.status === true) started.push(fx.tasks[key]);
        }
        immediate.mockRestore();
        return names(started);
    },
    'the calendar feed': async (uid) => {
        const feed = (await run(calendar.createFeed, request(uid, { body: { scope: 'my' }, protocol: 'https', get: () => 'hub.test' }))).body.data;
        const res = response();
        res.setHeader = () => {};
        await calendar.getIcs(request(undefined, { params: { token: feed.token } }), res);
        return Object.values(fx.tasks).filter((task) => String(res.body).includes(task.TaskName)).map((task) => task.TaskName).sort();
    },
    'the assistant\'s task read': async (uid) => {
        const found = [];
        for (const task of Object.values(fx.tasks)) {
            const seen = await visibleTask({ companyId: C, uid, taskId: String(task._id), projection: { TaskName: 1 } });
            if (seen) found.push(seen);
        }
        return names(found);
    },
    'the comment thread of a task': async (uid) => {
        const opened = [];
        for (const task of Object.values(fx.tasks)) {
            const access = await commentThreadAccess(C, uid, { projectId: String(task.ProjectID), sprintId: String(task.sprintId), taskId: String(task._id) });
            if (access.allowed) opened.push(task);
        }
        return names(opened);
    },
    'the live task room': async (uid) => {
        const joined = [];
        for (const task of Object.values(fx.tasks)) {
            if (await rooms.canOpenTask({ companyId: C, uid }, String(task._id))) joined.push(task);
        }
        return names(joined);
    },
    'the live list room': async (uid) => {
        const joined = [];
        for (const [key, place] of [['company', fx.company], ['own', fx.own], ['personal', fx.personal]]) {
            if (await rooms.canOpenSprintBoard({ companyId: C, uid }, place.id, place.sprint)) joined.push(fx.tasks[key]);
        }
        return names(joined);
    },
    'the next tasks card': async (uid) => names((await run(dashboard.getMyNextTasks, request(uid))).body.data.tasks),
    'the due soon card': async (uid) => names((await run(dashboard.getMyDueSoon, request(uid, { body: { days: 7 } }))).body.data.tasks),
    'the at risk card': async (uid) => {
        mockDb.store[SCHEMA_TYPE.TASKS].forEach((task) => { task.DueDate = new Date(Date.now() - 3 * 86400000); });
        return names((await run(getAtRisk, request(uid))).body.data.tasks);
    },
};

/* The card reads a member's own work, so an owner is not asked about tasks assigned to others. */
const OWN_WORK_READS = ['the next tasks card', 'the due soon card'];

describe('the calendar feed of a project', () => {
    it('leaves out a list the feed owner is not on', async () => {
        const hidden = mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), name: 'Closed list', projectId: fx.company.id, private: true, AssigneeUserId: [OWNER], deletedStatusKey: 0 });
        seedTask({ id: fx.company.id, sprint: String(hidden._id) }, 'task on a closed list');
        const feed = (await run(calendar.createFeed, request(READER, { body: { scope: 'project', projectId: fx.company.id }, protocol: 'https', get: () => 'hub.test' }))).body.data;
        const res = response();
        res.setHeader = () => {};

        await calendar.getIcs(request(undefined, { params: { token: feed.token } }), res);

        expect(String(res.body)).toContain(IN_COMPANY_RULES);
        expect(String(res.body)).not.toContain('task on a closed list');
    });
});

describe.each(Object.entries(READS))('%s', (label, read) => {
    it.each(EXPECTED.filter(([, uid]) => uid !== OWNER || ![...OWN_WORK_READS, 'the calendar feed'].includes(label)))('gives %s the tasks of the projects whose task list it holds', async (who, uid, expected) => {
        expect(await read(uid)).toEqual([...expected].sort());
    });
});

describe('the on-leave board', () => {
    const board = async (uid, projectIds) => {
        const body = { projectIds, dateFrom: new Date(Date.now() - 30 * 86400000).toISOString(), dateTo: new Date(Date.now() + 30 * 86400000).toISOString() };
        return names((await run(dashboard.getOnLeaveBoard, request(uid, { body }))).body.data.rows);
    };

    it('reads the named projects whose tasks the caller may list', async () => {
        expect(await board(MEMBER, [fx.company.id, fx.own.id, fx.personal.id])).toEqual([IN_COMPANY_RULES]);
        expect(await board(READER, [fx.company.id, fx.own.id, fx.personal.id])).toEqual([IN_COMPANY_RULES, IN_OWN_RULES].sort());
    });

    it('reads every named project for an owner but another person\'s personal list', async () => {
        expect(await board(OWNER, [fx.company.id, fx.own.id, fx.personal.id])).toEqual([IN_COMPANY_RULES, IN_OWN_RULES].sort());
    });
});

describe('the tab refresh conditions', () => {
    const refresh = (uid, place, item) => new Promise((resolve) => {
        const answer = response();
        const json = answer.json;
        answer.json = (payload) => { json(payload); resolve(answer); return answer; };
        getTabSyncTasks(request(uid, { body: { pid: place.id, sprintId: place.sprint, istableTask: false, tabLeaveTime: 0, userId: uid, item } }), answer);
    });

    it('keep to the named list whatever the conditions name', async () => {
        const res = await refresh(READER, fx.company, { indexName: 'createdAt', mongoConditions: [{ ProjectID: { $exists: true }, sprintId: { $exists: true } }] });

        expect(names(res.body[0].result)).toEqual([IN_COMPANY_RULES]);
    });

    it('refuse an operator outside the task query allowlist', async () => {
        const res = await refresh(READER, fx.company, { indexName: 'createdAt', mongoConditions: [{ $where: 'true' }] });

        expect(res.statusCode).toBe(400);
    });
});

describe('the projects a caller may list tasks in', () => {
    it('reads the rules of every project in one query', async () => {
        const before = mockDb.crud.mock.calls.length;

        await taskListProjectIds(C, MEMBER);

        const ruleReads = mockDb.crud.mock.calls.slice(before).filter(([, query]) => query.type === SCHEMA_TYPE.PROJECT_RULES);
        expect(ruleReads).toHaveLength(1);
    });

    it('holds nothing back while the emergency switch is on', async () => {
        process.env.DISABLE_PERMISSION_ENFORCEMENT = 'true';
        try {
            expect(await READS['the task query'](MEMBER)).toEqual([IN_COMPANY_RULES, IN_OWN_RULES].sort());
        } finally {
            delete process.env.DISABLE_PERMISSION_ENFORCEMENT;
        }
    });
});
