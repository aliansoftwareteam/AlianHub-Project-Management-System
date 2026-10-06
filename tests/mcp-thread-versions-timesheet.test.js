/* Task 047, benchmark jobs 14, 16 and 18: a connected agent replies in a task's comment thread, reads a doc's
   versions, and reads and asks to send the person's own timesheet week. Each holds the agent to its person's rights. */
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
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../utils/planHelper', () => ({ getCachedCompanyData: jest.fn(async () => ({ data: {} })) }));
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null), TRIGGER: { MENTION: 'mention', ASSIGN: 'assign' } }));
jest.mock('../Modules/Comments/helpers/threadNotices', () => ({ notifyReply: jest.fn(async () => []), notifyAssigned: jest.fn(async () => []), replyRecipients: jest.fn(async () => []) }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ recordWork: jest.fn(async () => null), forStatusChange: jest.fn(async () => null) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { DateTime } = require('luxon');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const memory = require('../Modules/Agents/memory');
const week = require('../Modules/Agents/timesheetWeek');
const { NOT_ON_TASK } = require('../Modules/Agents/commentReplies');
const { notifyReply } = require('../Modules/Comments/helpers/threadNotices');
const tools = require('../Modules/Mcp/tools');
const server = require('../Modules/Mcp/server');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_OPEN, L_SECRET, T_OPEN, T_SECRET, TOKEN, ctx, narrowed, outside } = world;
const { seed, rows, rpcThrough } = world.create(mockDb);
const rpc = rpcThrough(server);

const PEOPLE = [OWNER, ADMIN, INSIDER, OUTSIDER, GUEST];
const ROOT = '6f0000000000000000000f01';
const REPLY = '6f0000000000000000000f02';
const SECRET_ROOT = '6f0000000000000000000f03';
const PAGE = '6f0000000000000000000e11';
const PAGE_PRIVATE = '6f0000000000000000000e12';
const V_OLD = '6f0000000000000000000e21';
const V_NEW = '6f0000000000000000000e22';
const V_HIDDEN = '6f0000000000000000000e23';
const MONDAY = '2026-09-28';

const human = (userId) => ({ kind: 'human', userId });
const approve = (id, uid) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: [OWNER, ADMIN].includes(uid), ip: '' });
const tokenOf = (uid) => TOKEN.replace(/.$/, String(PEOPLE.indexOf(uid) + 1));
const as = (uid, over = {}) => {
    const base = ctx(uid, over);
    return { ...base, actor: { ...base.actor, tokenId: tokenOf(uid) }, token: { ...base.token, _id: tokenOf(uid) } };
};
const kept = (uid, projectIds) => ({ ...as(uid), projectIds: narrowed(uid, projectIds).projectIds });
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const comments = () => rows(SCHEMA_TYPE.COMMENTS);
const comment = (_id, taskId, sprintId, userId, extra = {}) => mockDb.seed(SCHEMA_TYPE.COMMENTS, {
    _id, projectId: P_OPEN, sprintId, taskId, userId, type: 'text', message: 'please review', project: false, isDeleted: false, ...extra,
});
const version = (_id, pageId, savedBy, at, text, extra = {}) => mockDb.seed(SCHEMA_TYPE.PAGE_VERSIONS, {
    _id, pageId, title: 'Launch notes', name: '', reason: 'interval', savedBy, savedAt: new Date(at), createdAt: new Date(at), visibility: 'project',
    content: { blocks: [{ type: 'paragraph', data: { text } }] }, rawText: text, ...extra,
});
const sheetRule = (permission) => {
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent && rule.key === 'sheet_settings')
        || mockDb.seed(SCHEMA_TYPE.RULES, { key: 'sheet_settings', name: 'Sheet', isParent: true, roles: [] });
    const rule = rows(SCHEMA_TYPE.RULES).find((row) => row.key === 'user_timesheet')
        || mockDb.seed(SCHEMA_TYPE.RULES, { key: 'user_timesheet', name: 'user_timesheet', isParent: false, parentId: String(parent._id), roles: [] });
    rule.roles = [{ key: 3, permission }, { key: 0, permission }];
};

beforeEach(() => {
    seed();
    process.env.MCP_TOOLS_DATA = 'on';
    PEOPLE.forEach((userId) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: tokenOf(userId), userId, active: true, scopes: ['read', 'write'], projectIds: [], expiresAt: new Date(Date.now() + 86400000) }));
    comment(ROOT, T_OPEN, L_OPEN, OUTSIDER);
    comment(REPLY, T_OPEN, L_OPEN, OWNER, { parentId: ROOT, message: 'on it' });
    comment(SECRET_ROOT, T_SECRET, L_SECRET, INSIDER, { message: 'kept to the private list' });
    mockDb.seed(SCHEMA_TYPE.PAGES, { _id: PAGE, title: 'Launch notes', ProjectID: P_OPEN, visibility: 'project', createdBy: INSIDER, deletedStatusKey: 0, content: { html: '<p>Second draft</p>' } });
    mockDb.seed(SCHEMA_TYPE.PAGES, { _id: PAGE_PRIVATE, title: 'Private plan', ProjectID: P_PRIVATE, visibility: 'project', createdBy: INSIDER, deletedStatusKey: 0, content: { html: '<p>Plan</p>' } });
    version(V_OLD, PAGE, INSIDER, '2026-09-01T10:00:00Z', 'First draft', { name: 'Kick-off' });
    version(V_NEW, PAGE, OUTSIDER, '2026-09-02T10:00:00Z', 'Between drafts');
    version(V_HIDDEN, PAGE, INSIDER, '2026-09-03T10:00:00Z', 'Written while the doc was private', { visibility: 'private' });
    sheetRule(true);
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
});
afterEach(async () => { await world.settle(); jest.restoreAllMocks(); });
afterAll(() => { world.FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('replying in a task\'s comment thread', () => {
    it('writes the reply into the thread of the comment it answers, and tells the thread', async () => {
        const out = await rpc(as(INSIDER), 'comment.create', { taskId: T_OPEN, text: 'Done', replyTo: ROOT });
        expect(out).toMatchObject({ ok: true, result: { threadOf: ROOT } });
        const saved = comments().find((row) => String(row._id) === out.result.commentId);
        expect(saved).toMatchObject({ message: 'Done', userId: INSIDER, actorType: 'agent' });
        expect([String(saved.parentId), String(saved.taskId), String(saved.projectId), String(saved.sprintId)]).toEqual([ROOT, T_OPEN, P_OPEN, L_OPEN]);
        expect(notifyReply).toHaveBeenCalledWith(CID, expect.objectContaining({ message: 'Done' }), expect.objectContaining({ userId: OUTSIDER }), []);
    });

    it('puts a reply to a reply under the first comment of the thread', async () => {
        const out = await rpc(as(OUTSIDER), 'comment.create', { taskId: T_OPEN, text: 'Thanks', replyTo: REPLY });
        expect(String(comments().find((row) => String(row._id) === out.result.commentId).parentId)).toBe(ROOT);
    });

    it('takes the reply through both comment tools of a connection that manages tasks', async () => {
        process.env.MCP_TOOLS_MANAGE = 'on';
        const managing = as(INSIDER, { token: { _id: tokenOf(INSIDER), userId: INSIDER, scopes: ['read', 'write'], grants: ['tasks:manage'], active: true } });
        for (const [name, args] of [['task.comment', { body: 'Done' }], ['comment.create', { text: 'Done' }]]) {
            const out = await rpc(managing, name, { taskId: T_OPEN, replyTo: ROOT, ...args });
            expect([name, String(comments().find((row) => String(row._id) === out.result.commentId).parentId)]).toEqual([name, ROOT]);
        }
        const listed = await rpc(as(INSIDER), 'comments.list', { taskId: T_OPEN });
        expect(listed.comments.find((row) => row.commentId === REPLY)).toMatchObject({ replyTo: ROOT });
    });

    it('refuses a reply to a comment of another task, even one the person can read, and writes nothing', async () => {
        const before = comments().length;
        expect(await rpc(as(INSIDER), 'comment.create', { taskId: T_OPEN, text: 'Done', replyTo: SECRET_ROOT })).toMatchObject({ error: NOT_ON_TASK });
        expect(await rpc(as(INSIDER), 'comment.create', { taskId: T_OPEN, text: 'Done', replyTo: world.MISSING })).toMatchObject({ error: NOT_ON_TASK });
        expect(comments()).toHaveLength(before);
    });

    it('refuses a reply in a thread on a task the person cannot open, as reading it is refused', async () => {
        expect(await rpc(as(OUTSIDER), 'comments.list', { taskId: T_SECRET })).toMatchObject({ error: expect.stringMatching(/not found/) });
        expect(await rpc(as(OUTSIDER), 'comment.create', { taskId: T_SECRET, text: 'Done', replyTo: SECRET_ROOT })).toMatchObject({ refused: true, reason: expect.stringMatching(/cannot open/) });
        expect(comments().filter((row) => String(row.parentId || '') === SECRET_ROOT)).toHaveLength(0);
    });

    it('refuses a connection kept to other projects', async () => {
        expect(await rpc(kept(INSIDER, [P_PRIVATE]), 'comment.create', { taskId: T_OPEN, text: 'Done', replyTo: ROOT })).toMatchObject({ refused: true });
        expect(comments().filter((row) => String(row.parentId || '') === ROOT)).toHaveLength(1);
    });

    it('is undone like any comment', async () => {
        const out = await actions.perform({ companyId: CID, actor: as(INSIDER).actor, action: 'task.comment', params: { taskId: T_OPEN, body: 'Done', replyTo: ROOT }, reason: 'test' });
        expect(out.undo).toMatchObject({ kind: 'comment', commentId: out.result.commentId });
    });
});

describe('reading a doc\'s versions', () => {
    it('lists the versions the person may see, newest first, with who saved each and when', async () => {
        const out = await rpc(as(OUTSIDER), 'page.versions.list', { pageId: PAGE });
        expect(out.versions.map((row) => row.versionId)).toEqual([V_NEW, V_OLD]);
        expect(out.versions[1]).toMatchObject({ name: 'Kick-off', savedBy: { id: INSIDER, name: 'Ian Insider' }, savedAt: '2026-09-01T10:00:00.000Z' });
        expect(JSON.stringify(out)).not.toMatch(/First draft|Between drafts/);
    });

    it('shows a version kept while the doc was private to its author alone', async () => {
        expect((await rpc(as(INSIDER), 'page.versions.list', { pageId: PAGE })).versions.map((row) => row.versionId)).toEqual([V_HIDDEN, V_NEW, V_OLD]);
        expect(await rpc(as(OUTSIDER), 'page.version.get', { pageId: PAGE, versionId: V_HIDDEN })).toMatchObject({ error: expect.stringMatching(/not found/) });
    });

    it('reads one version\'s text as it was then', async () => {
        expect(await rpc(as(OUTSIDER), 'page.version.get', { pageId: PAGE, versionId: V_OLD })).toMatchObject({ pageId: PAGE, versionId: V_OLD, text: 'First draft' });
    });

    it('answers a doc the person cannot open as one that is not there', async () => {
        for (const name of ['page.versions.list', 'page.version.get']) {
            expect(await rpc(as(OUTSIDER), name, { pageId: PAGE_PRIVATE, versionId: V_OLD })).toMatchObject({ error: expect.stringMatching(/not found/) });
        }
        expect(await rpc(as(OUTSIDER), 'page.version.get', { pageId: PAGE_PRIVATE, versionId: V_OLD })).not.toHaveProperty('text');
    });

    it('answers a doc outside a connection\'s projects as one that is not there', async () => {
        expect(await rpc(kept(INSIDER, [P_PRIVATE]), 'page.versions.list', { pageId: PAGE })).toMatchObject({ error: expect.stringMatching(/not found/) });
        expect(await rpc(kept(INSIDER, [P_PRIVATE]), 'page.version.get', { pageId: PAGE, versionId: V_OLD })).not.toHaveProperty('text');
    });

    it('has no tool that puts a version back', () => {
        expect(tools.names().filter((name) => /restore|version\.(save|set|rename)/.test(name))).toEqual([]);
        expect(registry.get('page.version.get')).toMatchObject({ write: false });
    });
});

describe('the person\'s timesheet week', () => {
    const seedWeek = (userId, status, extra = {}) => mockDb.seed(SCHEMA_TYPE.TIMESHEET_APPROVAL, {
        userId, periodType: 'week', periodStart: new Date(`${MONDAY}T00:00:00`), periodEnd: new Date('2026-10-04T00:00:00'), status,
        totalMinutes: 600, entryCount: 4, deletedStatusKey: 0, history: [], ...extra,
    });
    const submitted = () => rows(SCHEMA_TYPE.TIMESHEET_APPROVAL).filter((row) => row.status === 'submitted');

    it('reads a week that was never sent, any day of it naming it', async () => {
        expect(await rpc(as(INSIDER), 'timesheet.week', { weekOf: '2026-10-01' })).toEqual({ periodStart: MONDAY, periodEnd: '2026-10-04', status: 'not_submitted' });
    });

    it('reads where a sent week stands, and a reopened one as reopened', async () => {
        seedWeek(INSIDER, 'rejected', { rejectionReason: 'Missing Friday', reviewerName: 'Olive Owner' });
        expect(await rpc(as(INSIDER), 'timesheet.week', { weekOf: MONDAY })).toMatchObject({ status: 'rejected', sentBackBecause: 'Missing Friday', totalMinutes: 600 });
        rows(SCHEMA_TYPE.TIMESHEET_APPROVAL)[0].status = 'submitted';
        rows(SCHEMA_TYPE.TIMESHEET_APPROVAL)[0].history = [{ action: 'approve' }, { action: 'reopen' }];
        expect(await rpc(as(INSIDER), 'timesheet.week', { weekOf: MONDAY })).toMatchObject({ status: 'reopened' });
    });

    it('reads only the person\'s own week, whoever else has one', async () => {
        seedWeek(OUTSIDER, 'approved');
        expect(await rpc(as(INSIDER), 'timesheet.week', { weekOf: MONDAY })).toMatchObject({ status: 'not_submitted' });
        expect((await rpc(as(OWNER), 'timesheet.week', { weekOf: MONDAY, userId: OUTSIDER })).rpcError).toMatchObject({ code: -32602 });
    });

    it('defaults to this week in the person\'s own zone', async () => {
        const out = await rpc(as(INSIDER), 'timesheet.week', {});
        expect(out.periodStart).toBe(DateTime.utc().startOf('week').toISODate());
    });

    it('tells a connection kept to some projects nothing of the week', async () => {
        seedWeek(INSIDER, 'approved');
        const out = await rpc(kept(INSIDER, [P_OPEN]), 'timesheet.week', { weekOf: MONDAY });
        expect(out).toMatchObject({ error: expect.stringMatching(/limited to some projects/) });
        expect(JSON.stringify(out)).not.toMatch(/approved/);
    });

    it('lets a person whose role only reads the timesheet read the week, and refuses one who has no timesheet', async () => {
        sheetRule(false);
        expect(await rpc(as(OUTSIDER), 'timesheet.week', { weekOf: MONDAY })).toMatchObject({ status: 'not_submitted' });
        expect(await rpc(as(OUTSIDER), 'timesheet.week.submit', { weekOf: MONDAY })).toMatchObject({ refused: true });
        sheetRule(null);
        expect(await rpc(as(OUTSIDER), 'timesheet.week', { weekOf: MONDAY })).toMatchObject({ refused: true });
        expect(await rpc(as(OUTSIDER), 'timesheet.week.submit', { weekOf: MONDAY })).toMatchObject({ refused: true });
        expect(waiting()).toHaveLength(0);
    });

    it('files the send as a proposal for the person, and sends nothing', async () => {
        const out = await rpc(as(INSIDER), 'timesheet.week.submit', { weekOf: '2026-10-02', note: 'All in' });
        expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
        expect(rows(SCHEMA_TYPE.TIMESHEET_APPROVAL)).toHaveLength(0);
        expect(waiting()[0]).toMatchObject({ requestedBy: INSIDER, source: 'mcp' });
        expect(waiting()[0].changes[0]).toMatchObject({ action: week.SUBMIT, params: { userId: INSIDER, periodStart: MONDAY, periodEnd: '2026-10-04', note: 'All in' } });
        await expect(actions.perform({ companyId: CID, actor: as(INSIDER).actor, action: week.SUBMIT, params: waiting()[0].changes[0].params, reason: 'direct' })).rejects.toThrow(/has to be sent as a proposal/);
    });

    it('is approved by the person whose week it is and by nobody else, then sent as the Submit week button sends it', async () => {
        const id = (await rpc(as(INSIDER), 'timesheet.week.submit', { weekOf: MONDAY })).proposalId;
        for (const uid of [OWNER, ADMIN, OUTSIDER]) expect(await approve(id, uid)).toMatchObject({ error: week.NOT_THEIRS, status: 403 });
        expect(rows(SCHEMA_TYPE.TIMESHEET_APPROVAL)).toHaveLength(0);
        const out = await approve(id, INSIDER);
        expect(out.applied[0]).toMatchObject({ ok: true, result: { periodStart: MONDAY, status: 'submitted' } });
        expect(submitted()).toHaveLength(1);
        expect(submitted()[0]).toMatchObject({ userId: INSIDER, submittedBy: INSIDER, periodType: 'week' });
    });

    it('shows the card to the person whose week it is, and to nobody else', async () => {
        await rpc(as(INSIDER), 'timesheet.week.submit', { weekOf: MONDAY, note: 'All in' });
        const [change] = waiting()[0].changes;
        expect(await week.preview(change, { uid: INSIDER })).toEqual({
            kind: 'timesheetWeek', title: `${MONDAY} – 2026-10-04`, lines: [{ kind: 'timesheetWeek', from: MONDAY, to: '2026-10-04' }, { kind: 'timesheetNote', text: 'All in' }],
        });
        expect(await week.preview(change, { uid: OWNER })).toBeNull();
    });

    it('answers at once for a week already waiting or approved, and files nothing', async () => {
        seedWeek(INSIDER, 'approved');
        expect(await rpc(as(INSIDER), 'timesheet.week.submit', { weekOf: MONDAY })).toMatchObject({ ok: false, error: expect.stringMatching(/already approved/) });
        rows(SCHEMA_TYPE.TIMESHEET_APPROVAL)[0].status = 'submitted';
        expect(await rpc(as(INSIDER), 'timesheet.week.submit', { weekOf: MONDAY })).toMatchObject({ ok: false, error: expect.stringMatching(/already waiting/) });
        expect(waiting()).toHaveLength(0);
    });

    it('refuses a connection kept to some projects, and an outside client without the manage scope', async () => {
        expect(await rpc(kept(INSIDER, [P_OPEN]), 'timesheet.week.submit', { weekOf: MONDAY })).toMatchObject({ refused: true, reason: expect.stringMatching(/limited to some projects/) });
        expect(await rpc(outside(INSIDER, ['time:write']), 'timesheet.week.submit', { weekOf: MONDAY })).toMatchObject({ refused: true });
        expect(waiting()).toHaveLength(0);
    });

    it('has no tool or action that approves, sends back or reopens a week', () => {
        expect(tools.names().filter((name) => /timesheet/.test(name)).sort()).toEqual(['timesheet.read', 'timesheet.week', 'timesheet.week.submit']);
        expect(registry.keys().filter((key) => /timesheet\.(review|approve|reject|reopen)/.test(key))).toEqual([]);
    });
});
