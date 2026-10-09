require('./fixtures/mcpFlagsOff');
/* Task 048: tasks.search narrows by tag, priority and a custom field's value (equals; before and after for a date
   field). Each filter only narrows what the person can already open, and the answer keeps its shape. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
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
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ recordWork: jest.fn(async () => null), forStatusChange: jest.fn(async () => null) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const tools = require('../Modules/Mcp/tools');
const server = require('../Modules/Mcp/server');

const { OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, T_OPEN_2, T_TWIN, FLAGS, ctx, narrowed } = world;
const { seed, stored, rows, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);

const F_STAGE = '6f0000000000000000000f11';
const F_LAUNCH = '6f0000000000000000000f12';
const F_SCORE = '6f0000000000000000000f13';
const F_SIGNED = '6f0000000000000000000f14';
const F_CLIENT = '6f0000000000000000000f15';
const F_PEOPLE = '6f0000000000000000000f16';
const F_HIDDEN = '6f0000000000000000000f17';
const F_OFF = '6f0000000000000000000f18';
const F_MINE = '6f0000000000000000000f19';

const search = async (caller, args) => rpc(caller, 'tasks.search', args);
const idsOf = (out) => (out.tasks || []).map((task) => task.taskId).sort();
const field = (_id, fieldTitle, fieldType, extra = {}) => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id, fieldTitle, fieldType, type: 'task', isDelete: true, global: false, projectId: [P_OPEN], ...extra });
const valueOn = (taskId, fieldId, fieldValue) => { stored(SCHEMA_TYPE.TASKS, taskId).customField[fieldId] = { _id: fieldId, fieldValue }; };

beforeEach(() => {
    seed();
    field(F_STAGE, 'Stage', 'dropdown', { fieldOptions: [{ id: 1, label: 'Draft' }, { id: 2, label: 'Final' }] });
    field(F_LAUNCH, 'Launch', 'date');
    field(F_SCORE, 'Score', 'number');
    field(F_SIGNED, 'Signed', 'checkbox');
    field(F_CLIENT, 'Client', 'text');
    field(F_PEOPLE, 'Reviewers', 'people');
    field(F_HIDDEN, 'Secret score', 'number', { projectId: [P_PRIVATE] });
    field(F_OFF, 'Old field', 'number', { isDelete: false });

    stored(SCHEMA_TYPE.TASKS, T_OPEN).tagsArray = ['tag_bug'];
    stored(SCHEMA_TYPE.TASKS, T_SECRET).tagsArray = ['tag_bug', 'tag_api'];
    stored(SCHEMA_TYPE.TASKS, T_OPEN_2).tagsArray = ['tag_api'];
    stored(SCHEMA_TYPE.TASKS, T_PRIVATE).tagsArray = ['tag_secret'];
    stored(SCHEMA_TYPE.TASKS, T_OPEN).Task_Priority = 'HIGH';
    stored(SCHEMA_TYPE.TASKS, T_SECRET).Task_Priority = 'HIGH';
    stored(SCHEMA_TYPE.TASKS, T_OPEN_2).Task_Priority = 'LOW';

    valueOn(T_OPEN, F_STAGE, ['1']);
    valueOn(T_OPEN_2, F_STAGE, [2]);
    valueOn(T_OPEN, F_LAUNCH, new Date('2026-10-05T00:00:00.000Z'));
    valueOn(T_OPEN_2, F_LAUNCH, '2026-10-10T00:00:00.000Z');
    valueOn(T_TWIN, F_LAUNCH, '2026-10-20T00:00:00.000Z');
    valueOn(T_OPEN, F_SCORE, '5');
    valueOn(T_OPEN_2, F_SCORE, 5);
    valueOn(T_TWIN, F_SCORE, '7');
    valueOn(T_OPEN, F_SIGNED, true);
    valueOn(T_OPEN, F_CLIENT, 'Acme Ltd');
    valueOn(T_TWIN, F_CLIENT, 'Acme');
    valueOn(T_PRIVATE, F_HIDDEN, '9');
});
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('the filters exist only with the flag on', () => {
    it('off, tasks.search takes and describes what it did before', async () => {
        process.env.MCP_TOOLS_WORK = 'off';
        const tool = tools.manifest(ctx(OWNER)).find((entry) => entry.name === 'tasks.search');
        expect(Object.keys(tool.inputSchema.properties)).toEqual(['query', 'projectId', 'status', 'limit']);
        expect(idsOf(await search(ctx(OWNER), { priority: 'LOW' }))).toHaveLength(5);
    });

    it('on, it offers tag, priority and field and says so', () => {
        const tool = tools.manifest(ctx(OWNER)).find((entry) => entry.name === 'tasks.search');
        expect(tool.inputSchema.properties).toEqual(expect.objectContaining({ tag: expect.any(Object), priority: expect.any(Object), field: expect.any(Object) }));
        expect(tool.description).toMatch(/tag, priority or a custom field's value/);
    });

    it('describes the planning form with the filters too', () => {
        process.env.MCP_TOOLS_MANAGE = 'on';
        const caller = ctx(OWNER, { token: { ...ctx(OWNER).token, grants: ['tasks:manage'] } });
        const tool = tools.manifest(caller).find((entry) => entry.name === 'tasks.search');
        expect(tool.description).toMatch(/assignee, due date, tag, priority or a custom field's value/);
        expect(tool.inputSchema.properties).toEqual(expect.objectContaining({ assigneeId: expect.any(Object), tag: expect.any(Object) }));
    });
});

describe('tag', () => {
    it('finds the tasks with a tag, by name in any case or by id, and keeps the answer\'s shape', async () => {
        const byName = await search(ctx(OWNER), { tag: ' bug ' });
        expect(idsOf(byName)).toEqual([T_OPEN, T_SECRET].sort());
        expect(Object.keys(byName)).toEqual(['tasks']);
        expect(Object.keys(byName.tasks[0]).sort()).toEqual(['dueDate', 'estimateHours', 'key', 'priority', 'projectId', 'sprintId', 'status', 'statusType', 'taskId', 'title']);
        expect(idsOf(await search(ctx(OWNER), { tag: 'tag_api' }))).toEqual([T_OPEN_2, T_SECRET].sort());
    });

    it('never answers a task the person cannot open', async () => {
        expect(idsOf(await search(ctx(OUTSIDER), { tag: 'Bug' }))).toEqual([T_OPEN]);
        expect(idsOf(await search(ctx(INSIDER), { tag: 'Bug' }))).toEqual([T_OPEN, T_SECRET].sort());
    });

    it('answers a tag only a project the person cannot open has as it answers a tag that does not exist', async () => {
        const none = await search(ctx(OUTSIDER), { tag: 'Nothing' });
        expect(none).toEqual({ error: 'No tag by that id or name in the projects the person can open. Check tags.list.' });
        expect(await search(ctx(OUTSIDER), { tag: 'Secret' })).toEqual(none);
        expect(await search(narrowed(INSIDER, [P_OPEN]), { tag: 'Secret' })).toEqual(none);
        expect(idsOf(await search(ctx(INSIDER), { tag: 'Secret' }))).toEqual([T_PRIVATE]);
    });

    it('finds a tag the person can open however many projects they cannot open share its name', async () => {
        const projects = mockDb.store[SCHEMA_TYPE.PROJECTS];
        for (let i = 0; i < 520; i += 1) {
            mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: `6e${i.toString(16).padStart(22, '0')}`, ProjectName: `Someone's ${i}`, isPersonal: true, personalOwner: GUEST, deletedStatusKey: 0, tagsArray: [{ uid: `tag_p${i}`, tagName: 'Bug' }] });
        }
        projects.push(projects.splice(projects.findIndex((row) => String(row._id) === P_OPEN), 1)[0]);
        expect(idsOf(await search(ctx(OWNER), { tag: 'Bug' }))).toEqual([T_OPEN, T_SECRET].sort());
    });

    it('narrows to one project with projectId', async () => {
        expect(idsOf(await search(ctx(INSIDER), { tag: 'Secret', projectId: P_OPEN }))).toEqual([]);
        expect((await search(ctx(INSIDER), { tag: 'Secret', projectId: P_OPEN })).error).toMatch(/No tag/);
    });
});

describe('priority', () => {
    it('finds the tasks of a priority, in any case', async () => {
        expect(idsOf(await search(ctx(OWNER), { priority: 'high' }))).toEqual([T_OPEN, T_SECRET].sort());
        expect(idsOf(await search(ctx(OUTSIDER), { priority: 'HIGH' }))).toEqual([T_OPEN]);
        expect(await search(ctx(OWNER), { priority: 'soon' })).toEqual({ error: 'priority must be one of URGENT, HIGH, MEDIUM, LOW.' });
    });

    it('combines with a tag and with the text', async () => {
        expect(idsOf(await search(ctx(OWNER), { priority: 'LOW', tag: 'API' }))).toEqual([T_OPEN_2]);
        expect(idsOf(await search(ctx(OWNER), { priority: 'HIGH', query: 'secret' }))).toEqual([T_SECRET]);
    });
});

describe('a custom field', () => {
    it('matches a dropdown option by label or id, stored as text or a number', async () => {
        expect(idsOf(await search(ctx(OWNER), { field: { fieldId: F_STAGE, equals: 'draft' } }))).toEqual([T_OPEN]);
        expect(idsOf(await search(ctx(OWNER), { field: { fieldId: F_STAGE, equals: 2 } }))).toEqual([T_OPEN_2]);
        expect(await search(ctx(OWNER), { field: { fieldId: F_STAGE, equals: 'Gone' } })).toEqual({ error: 'Stage has no option Gone. Its options: Draft, Final.' });
    });

    it('matches a number, a checkbox and text in any case', async () => {
        expect(idsOf(await search(ctx(OWNER), { field: { fieldId: F_SCORE, equals: 5 } }))).toEqual([T_OPEN, T_OPEN_2].sort());
        expect(idsOf(await search(ctx(OWNER), { field: { fieldId: F_SCORE, equals: '7' } }))).toEqual([T_TWIN]);
        expect(idsOf(await search(ctx(OWNER), { field: { fieldId: F_SIGNED, equals: true } }))).toEqual([T_OPEN]);
        expect(idsOf(await search(ctx(OWNER), { field: { fieldId: F_SIGNED, equals: false } }))).not.toContain(T_OPEN);
        expect(idsOf(await search(ctx(OWNER), { field: { fieldId: F_CLIENT, equals: 'acme' } }))).toEqual([T_TWIN]);
        expect(idsOf(await search(ctx(OWNER), { field: { fieldId: F_CLIENT, equals: 'Acme.*' } }))).toEqual([]);
    });

    it('finds a date field on, before or after a day, stored as a date or as text', async () => {
        expect(idsOf(await search(ctx(OWNER), { field: { fieldId: F_LAUNCH, before: '2026-10-10' } }))).toEqual([T_OPEN]);
        expect(idsOf(await search(ctx(OWNER), { field: { fieldId: F_LAUNCH, after: '2026-10-05' } }))).toEqual([T_OPEN_2, T_TWIN].sort());
        expect(idsOf(await search(ctx(OWNER), { field: { fieldId: F_LAUNCH, after: '2026-10-04', before: '2026-10-20' } }))).toEqual([T_OPEN, T_OPEN_2].sort());
        expect(idsOf(await search(ctx(OWNER), { field: { fieldId: F_LAUNCH, equals: '2026-10-10' } }))).toEqual([T_OPEN_2]);
    });

    it('reads the days as the person\'s own', async () => {
        rows(SCHEMA_TYPE.USERS).find((user) => String(user._id) === OWNER).Time_Zone = 'America/New_York';
        expect(idsOf(await search(ctx(OWNER), { field: { fieldId: F_LAUNCH, equals: '2026-10-09' } }))).toEqual([T_OPEN_2]);
        expect(idsOf(await search(ctx(OWNER), { field: { fieldId: F_LAUNCH, equals: '2026-10-10' } }))).toEqual([]);
    });

    it('says what is wrong with a request', async () => {
        const cases = [
            [{ fieldId: F_LAUNCH, before: 'tomorrow' }, 'Launch takes days written YYYY-MM-DD.'],
            [{ fieldId: F_SCORE, before: '2026-10-10' }, 'before and after are for a date field, and Score is a number field.'],
            [{ fieldId: F_SCORE, equals: 'many' }, 'Score is a number field: give a number.'],
            [{ fieldId: F_SIGNED, equals: 'maybe' }, 'Signed is a checkbox: give true or false.'],
            [{ fieldId: F_PEOPLE, equals: 'x' }, 'Reviewers is a people field, which search cannot filter by yet.'],
            [{ fieldId: F_LAUNCH, equals: '2026-10-10', after: '2026-10-01' }, 'field takes equals, or before and after, not both.'],
            [{ fieldId: F_SCORE }, 'field needs equals, or before or after for a date field.'],
            [{ fieldId: F_SCORE, equals: 5, near: 1 }, 'field takes fieldId with equals, or for a date field before and after.'],
        ];
        for (const [asked, error] of cases) expect(await search(ctx(OWNER), { field: asked })).toEqual({ error });
    });

    it('answers a field of a project the person cannot open, a switched-off field and a missing one alike', async () => {
        const missing = await search(ctx(OUTSIDER), { field: { fieldId: '6f0000000000000000000fff', equals: 1 } });
        expect(missing).toEqual({ error: 'That custom field was not found in the projects the person can open. Check the field id.' });
        expect(await search(ctx(OUTSIDER), { field: { fieldId: F_HIDDEN, equals: 9 } })).toEqual(missing);
        expect(await search(ctx(GUEST), { field: { fieldId: F_HIDDEN, equals: 9 } })).toEqual(missing);
        expect(await search(ctx(OWNER), { field: { fieldId: F_OFF, equals: 1 } })).toEqual(missing);
        expect(idsOf(await search(ctx(INSIDER), { field: { fieldId: F_HIDDEN, equals: 9 } }))).toEqual([T_PRIVATE]);
    });

    it('answers a field of someone else\'s personal list or of a trashed project as a missing one, and names none of its options', async () => {
        field(F_MINE, 'Mine', 'dropdown', { projectId: [P_PERSONAL], fieldOptions: [{ id: 1, label: 'Hush' }] });
        valueOn(T_PERSONAL, F_MINE, ['1']);
        const missing = { error: 'That custom field was not found in the projects the person can open. Check the field id.' };
        for (const uid of [OWNER, OUTSIDER]) {
            expect(await search(ctx(uid), { field: { fieldId: F_MINE, equals: 'nope' } })).toEqual(missing);
        }
        expect(await search(ctx(INSIDER), { field: { fieldId: F_MINE, equals: 'nope' } })).toEqual({ error: 'Mine has no option nope. Its options: Hush.' });
        expect(idsOf(await search(ctx(INSIDER), { field: { fieldId: F_MINE, equals: 'hush' } }))).toEqual([T_PERSONAL]);
        stored(SCHEMA_TYPE.PROJECTS, P_PRIVATE).deletedStatusKey = 1;
        expect(await search(ctx(INSIDER), { field: { fieldId: F_HIDDEN, equals: 9 } })).toEqual(missing);
    });

    it('never answers a task the person cannot open', async () => {
        valueOn(T_SECRET, F_SCORE, '5');
        expect(idsOf(await search(ctx(OUTSIDER), { field: { fieldId: F_SCORE, equals: 5 } }))).toEqual([T_OPEN, T_OPEN_2].sort());
        expect(idsOf(await search(ctx(INSIDER), { field: { fieldId: F_SCORE, equals: 5 } }))).toEqual([T_OPEN, T_OPEN_2, T_SECRET].sort());
    });
});
