/* Task 047, job 19: a connected agent moves a task's dates while other tasks wait on it. The Gantt moves the waiting
   tasks later by working days when a person drags the blocker later; the agent's date change does the same. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

/* Mongoose reads an update without operators as a $set, which the fake does not. */
const mockAsMongoose = (q, method) => {
    const update = method === 'findOneAndUpdate' && Array.isArray(q.data) ? q.data[1] : null;
    if (!update || Object.keys(update).some((key) => key.startsWith('$'))) return q;
    return { ...q, data: [q.data[0], { $set: update }, ...q.data.slice(2)] };
};
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, mockAsMongoose(q, method), method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => ({ getCompanyDataFun: jest.fn(async () => [{ workingDays: [1, 2, 3, 4, 5] }]) }));
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Knowledge/memory/publish', () => mockStub());
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null), TRIGGER: { MENTION: 'mention', ASSIGN: 'assign' } }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const undo = require('../Modules/Agents/undo');
const proposals = require('../Modules/Agents/proposals');
const intentPreview = require('../Modules/Agents/intentPreview');
const waitingTasks = require('../Modules/Agents/waitingTasks');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const server = require('../Modules/Mcp/server');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, MEMBER, TOKEN, P_OPEN, P_PRIVATE, P_DEST, S_OPEN, S_PRIVATE, S_DEST, ctx, settle } = world;
const { seed, stored, audits, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const DAY = 24 * 60 * 60 * 1000;

const at = (day) => new Date(`2026-10-${day}T00:00:00.000Z`);
const datesOf = (task) => {
    const row = stored(task._id);
    return [new Date(row.startDate).toISOString().slice(0, 10), new Date(row.DueDate).toISOString().slice(0, 10)];
};
const blocks = (taskId) => ({ taskId: String(taskId), type: 'blocks' });
const blockedBy = (taskId) => ({ taskId: String(taskId), type: 'blocked_by' });
const named = (title, projectId, sprintId, start, due) => {
    const copy = { ...stored(fx.bug._id), TaskKey: title, TaskName: title, ProjectID: projectId, sprintId, startDate: at(start), DueDate: at(due), relations: [] };
    delete copy._id;
    return mockDb.seed(SCHEMA_TYPE.TASKS, copy);
};
const link = (blocker, waiting) => {
    stored(blocker._id).relations.push(blocks(waiting._id));
    stored(waiting._id).relations.push(blockedBy(blocker._id));
};
const move = (task, startDate, dueDate, uid = OWNER, over = {}) => rpc(ctx(uid, over), 'task.update', { taskId: String(task._id), startDate, dueDate, reason: 'Design slips' });

let fx;
let design;
let build;
let ship;

beforeEach(() => {
    jest.clearAllMocks();
    fx = seed();
    mockDb.store[SCHEMA_TYPE.API_TOKENS] = [];
    mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: TOKEN, userId: OWNER, name: 'Claude', active: true, scopes: ['read', 'write'], grants: ['tasks:manage'], projectIds: [], expiresAt: new Date(Date.now() + DAY) });
    design = named('Design', P_OPEN, S_OPEN, '08', '09');
    build = named('Build', P_OPEN, S_OPEN, '12', '13');
    ship = named('Ship', P_OPEN, S_OPEN, '14', '15');
    link(design, build);
    link(build, ship);
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); waitingTasks.limits.chainMax = 500; });
afterAll(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2'].forEach((key) => { delete process.env[key]; }); });

describe('moving a blocker later', () => {
    it('moves every task waiting on it by working days, as the Gantt does, and says which', async () => {
        const out = await move(design, '2026-10-13', '2026-10-14');
        expect(out).toMatchObject({ ok: true });
        expect(datesOf(design)).toEqual(['2026-10-13', '2026-10-14']);
        expect(datesOf(build)).toEqual(['2026-10-14', '2026-10-15']);
        expect(datesOf(ship)).toEqual(['2026-10-15', '2026-10-16']);
        expect(out.result.waitingTasks.moved).toEqual([
            { taskId: String(build._id), title: 'Build', startDate: '2026-10-14T00:00:00.000Z', dueDate: '2026-10-15T00:00:00.000Z', workingDays: 2 },
            { taskId: String(ship._id), title: 'Ship', startDate: '2026-10-15T00:00:00.000Z', dueDate: '2026-10-16T00:00:00.000Z', workingDays: 1 },
        ]);
        expect(out.result.waitingTasks.startTooEarly).toEqual([]);
    });

    it('steps over the weekend', async () => {
        await move(design, '2026-10-15', '2026-10-16');
        expect(datesOf(build)).toEqual(['2026-10-16', '2026-10-17']);
    });

    it('is one change: one record, and one undo puts every task back', async () => {
        await move(design, '2026-10-13', '2026-10-14');
        const rows = audits('task.edit', 'applied');
        expect(rows).toHaveLength(1);
        const undone = await undo.undoAuditRow(CID, rows[0], { kind: 'human', userId: OWNER }, '');
        expect(undone).toMatchObject({ ok: true });
        expect(datesOf(design)).toEqual(['2026-10-08', '2026-10-09']);
        expect(datesOf(build)).toEqual(['2026-10-12', '2026-10-13']);
        expect(datesOf(ship)).toEqual(['2026-10-14', '2026-10-15']);
    });

    it('leaves alone, and does not name, a waiting task the person cannot open', async () => {
        const hidden = named('Hidden', P_PRIVATE, S_PRIVATE, '12', '13');
        link(design, hidden);
        mockDb.store[SCHEMA_TYPE.API_TOKENS][0].userId = MEMBER;
        const out = await move(design, '2026-10-13', '2026-10-14', MEMBER);
        expect(out).toMatchObject({ ok: true });
        expect(datesOf(build)).toEqual(['2026-10-14', '2026-10-15']);
        expect(datesOf(hidden)).toEqual(['2026-10-12', '2026-10-13']);
        expect(JSON.stringify(out)).not.toMatch(/Hidden/);
        expect(JSON.stringify(out)).not.toContain(String(hidden._id));
    });
});

describe('moving a blocker earlier, or a task nothing waits on', () => {
    it('moves nothing else', async () => {
        const out = await move(build, '2026-10-09', '2026-10-12');
        expect(datesOf(ship)).toEqual(['2026-10-14', '2026-10-15']);
        expect(out.result.waitingTasks).toBeUndefined();
        await move(ship, '2026-10-20', '2026-10-21');
        expect(datesOf(ship)).toEqual(['2026-10-20', '2026-10-21']);
    });
});

describe('what the agent is told', () => {
    it('task.update says that moving a task later moves the tasks waiting on it', async () => {
        const listed = (await server.handleRpc(ctx(OWNER), { jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.find((tool) => tool.name === 'task.update');
        expect(listed.description).toMatch(/wait on it[\s\S]*working days/);
    });
});

describe('each waiting task is held to what a change of its own would be', () => {
    const project = (id) => mockDb.store[SCHEMA_TYPE.PROJECTS].find((row) => String(row._id) === id);
    let elsewhere;
    let second;

    beforeEach(() => {
        elsewhere = named('Elsewhere', P_DEST, S_DEST, '12', '13');
        second = named('Elsewhere too', P_DEST, S_DEST, '12', '13');
        link(design, elsewhere);
        link(design, second);
    });

    const stays = (out, task, why) => {
        expect(datesOf(task)).toEqual(['2026-10-12', '2026-10-13']);
        expect(out.result.waitingTasks.startTooEarly).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: String(task._id), title: task.TaskName, why: expect.stringMatching(why) })]));
    };

    it('stays put and is named in a project where agents are paused', async () => {
        project(P_DEST).agentLimits = { paused: true };
        const out = await move(design, '2026-10-13', '2026-10-14');
        expect(datesOf(build)).toEqual(['2026-10-14', '2026-10-15']);
        stays(out, elsewhere, /paused/);
        stays(out, second, /paused/);
    });

    it('stays put and is named in a project where a connected agent asks before every change', async () => {
        project(P_DEST).agentPolicy = { connected: 'propose_all' };
        const out = await move(design, '2026-10-13', '2026-10-14');
        expect(datesOf(build)).toEqual(['2026-10-14', '2026-10-15']);
        stays(out, elsewhere, /ask a person/);
    });

    it('stays put and is named past the count of tasks an agent may change at once in its project', async () => {
        project(P_DEST).agentLimits = { directTasks: 1 };
        const out = await move(design, '2026-10-13', '2026-10-14');
        const movedThere = [elsewhere, second].filter((task) => datesOf(task)[0] === '2026-10-14');
        expect(movedThere).toHaveLength(1);
        const left = [elsewhere, second].find((task) => !movedThere.includes(task));
        stays(out, left, /already changed 1 task/);
    });

    it('stays outside the projects the token is held to', async () => {
        mockDb.store[SCHEMA_TYPE.API_TOKENS][0].projectIds = [P_OPEN];
        const out = await move(design, '2026-10-13', '2026-10-14', OWNER, { projectIds: [P_OPEN] });
        expect(out).toMatchObject({ ok: true });
        expect(datesOf(build)).toEqual(['2026-10-14', '2026-10-15']);
        expect(datesOf(elsewhere)).toEqual(['2026-10-12', '2026-10-13']);
        expect(JSON.stringify(out)).not.toContain(String(elsewhere._id));
    });
});

describe('a date change that waits for approval', () => {
    const human = (userId) => ({ kind: 'human', userId });
    let elsewhere;

    beforeEach(() => {
        elsewhere = named('Elsewhere', P_DEST, S_DEST, '12', '13');
        link(design, elsewhere);
        mockDb.store[SCHEMA_TYPE.PROJECTS].find((row) => String(row._id) === P_OPEN).agentPolicy = { connected: 'propose_all' };
        mockDb.store[SCHEMA_TYPE.API_TOKENS][0].projectIds = [P_OPEN];
    });

    it('shows the waiting tasks it will move on its card, and on approval moves none outside the token\'s projects', async () => {
        const filed = await move(design, '2026-10-13', '2026-10-14', OWNER, { projectIds: [P_OPEN] });
        expect(filed).toMatchObject({ pending: true });
        expect(datesOf(build)).toEqual(['2026-10-12', '2026-10-13']);
        const row = mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS].find((entry) => String(entry._id) === filed.proposalId);
        const card = (await intentPreview.forBatches(CID, OWNER, [{ ...row, id: String(row._id) }], { bareChanges: true })).get(String(row._id));
        expect(card.lines).toEqual(expect.arrayContaining([
            { kind: 'batchItem', task: 'Build', what: 'start', value: '2026-10-14T00:00:00.000Z' },
            { kind: 'batchItem', task: 'Ship', what: 'due', value: '2026-10-16T00:00:00.000Z' },
        ]));
        expect(JSON.stringify(card)).not.toMatch(/Elsewhere/);

        const approved = await proposals.approve(CID, filed.proposalId, { decider: human(OWNER), isPrivileged: true, ip: '' });
        await settle();
        expect(approved.error).toBeUndefined();
        expect(datesOf(design)).toEqual(['2026-10-13', '2026-10-14']);
        expect(datesOf(build)).toEqual(['2026-10-14', '2026-10-15']);
        expect(datesOf(ship)).toEqual(['2026-10-15', '2026-10-16']);
        expect(datesOf(elsewhere)).toEqual(['2026-10-12', '2026-10-13']);
    });
});

describe('a long chain', () => {
    it('says the chain was cut at its cap, and how many waiting tasks were read', async () => {
        waitingTasks.limits.chainMax = 2;
        const out = await move(design, '2026-10-13', '2026-10-14');
        expect(out.result.waitingTasks).toMatchObject({ truncated: true, considered: 1 });
        expect(datesOf(ship)).toEqual(['2026-10-14', '2026-10-15']);
    });
});

describe('when moving the waiting tasks fails', () => {
    it('keeps the change to the task itself undoable and says the waiting tasks did not move', async () => {
        jest.spyOn(taskMongo, 'bulkUpdateDates').mockRejectedValue(new Error('write failed'));
        const out = await move(design, '2026-10-13', '2026-10-14');
        expect(out).toMatchObject({ ok: true, undoable: true });
        expect(out.result.waitingTasks).toMatchObject({ moved: [], error: expect.stringMatching(/not moved/) });
        expect(datesOf(build)).toEqual(['2026-10-12', '2026-10-13']);
        const [row] = audits('task.edit', 'applied');
        expect(row.meta.undo.shifted).toBeUndefined();
        expect(await undo.undoAuditRow(CID, row, { kind: 'human', userId: OWNER }, '')).toMatchObject({ ok: true });
        expect(datesOf(design)).toEqual(['2026-10-08', '2026-10-09']);
    });
});

describe('undo', () => {
    it('leaves a waiting task a person moved since, says so, and names only what it put back', async () => {
        await move(design, '2026-10-13', '2026-10-14');
        stored(ship._id).startDate = at('20');
        stored(ship._id).DueDate = at('21');
        const [row] = audits('task.edit', 'applied');
        const out = await undo.undoAuditRow(CID, row, { kind: 'human', userId: OWNER }, '');
        expect(out.result).toMatchObject({ movedBack: [String(build._id)], leftAlone: [String(ship._id)] });
        expect(datesOf(build)).toEqual(['2026-10-12', '2026-10-13']);
        expect(datesOf(ship)).toEqual(['2026-10-20', '2026-10-21']);
    });
});
