/* Task 046, MCP parity part 3: an outside agent reads the comments on a doc, comments, replies and assigns a
   thread through the doc comment routes' own handlers, as the person behind its token and no further. */
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
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleSingleNotification: jest.fn(async () => []) }));
jest.mock('../Modules/notification/docNotices', () => ({ ensureDocNoticeSection: jest.fn(async () => undefined) }));
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
jest.mock('../Modules/Agents/proposals', () => ({ create: jest.fn(async (companyId, proposal) => ({ _id: 'proposal-1', ...proposal })) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const { inverses, undoStateOf } = require('../Modules/Agents/undo');
const approval = require('../Modules/Mcp/approval');
const tools = require('../Modules/Mcp/tools');
const scopes = require('../Modules/Mcp/scopes');
const server = require('../Modules/Mcp/server');
const { handleSingleNotification } = require('../Modules/notification/prepare-notification-data/controllerV2');

const {
    CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL,
    MISSING, BEFORE, FLAGS, EVERYONE, ctx, narrowed, readOnly, outside, routeTable, asPerson, settle,
} = world;
const { seed, rows, stored, audits, rpcThrough, listedThrough, seedGrant, filedBy } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);
const web = asPerson(routeTable(require('../Modules/Pages/routes').init));

const NAMES = ['page.comments.list', 'page.comment.create', 'page.comment.reply', 'page.comment.assign'];
const PG_OPEN = '6f0000000000000000000701';
const PG_TWIN = '6f0000000000000000000702';
const PG_PRIVATE_PROJECT = '6f0000000000000000000703';
const PG_PERSONAL = '6f0000000000000000000704';
const PG_OWN = '6f0000000000000000000705';
const PG_COMPANY = '6f0000000000000000000706';
const PG_TRASHED = '6f0000000000000000000707';
const C_THREAD = '6f0000000000000000000801';
const C_REPLY = '6f0000000000000000000802';
const C_GONE = '6f0000000000000000000803';
const C_ELSEWHERE = '6f0000000000000000000804';
const NO_PAGE = 'not_visible: the page is not one the person behind this token can open';

const comments = (pageId) => rows(SCHEMA_TYPE.PAGE_COMMENTS).filter((row) => String(row.pageId) === pageId && row.isDeleted !== true);
const comment = (id) => stored(SCHEMA_TYPE.PAGE_COMMENTS, id);
const without = (doc, ...fields) => Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(doc))).filter(([field]) => !fields.includes(field)));
const asStored = (doc, ...also) => without(doc, '_id', 'pageId', 'createdAt', 'updatedAt', ...also);
const commentsNow = () => JSON.stringify(mockDb.store[SCHEMA_TYPE.PAGE_COMMENTS]);
const inProduct = (uid) => ({ kind: 'agent', userId: uid, agentName: 'Workspace agent' });
const mention = (name, id) => `@[${name}](${id})`;

beforeEach(() => {
    seed();
    const page = (_id, title, extra = {}) => mockDb.seed(SCHEMA_TYPE.PAGES, { _id, title, visibility: 'project', createdBy: INSIDER, deletedStatusKey: 0, content: {}, ...extra });
    page(PG_OPEN, 'Release notes', { ProjectID: P_OPEN });
    page(PG_TWIN, 'Release notes, twin', { ProjectID: P_OPEN });
    page(PG_PRIVATE_PROJECT, 'Plans', { ProjectID: P_PRIVATE });
    page(PG_PERSONAL, 'Notes to self', { ProjectID: P_PERSONAL });
    page(PG_OWN, 'Draft', { ProjectID: P_OPEN, visibility: 'private' });
    page(PG_COMPANY, 'Handbook');
    page(PG_TRASHED, 'Gone', { ProjectID: P_OPEN, deletedStatusKey: 1 });
    const said = (_id, pageId, userId, message, extra = {}) => mockDb.seed(SCHEMA_TYPE.PAGE_COMMENTS, { _id, pageId, userId, message, blockId: '', mentionIds: [], createdAt: new Date('2026-09-01T00:00:00Z'), ...extra });
    said(C_THREAD, PG_OPEN, INSIDER, 'Is this the final list?');
    said(C_REPLY, PG_OPEN, OUTSIDER, 'Nearly.', { parentId: C_THREAD, createdAt: new Date('2026-09-02T00:00:00Z') });
    said(C_GONE, PG_OPEN, OUTSIDER, 'Withdrawn', { isDeleted: true, createdAt: new Date('2026-09-03T00:00:00Z') });
    said(C_ELSEWHERE, PG_PRIVATE_PROJECT, INSIDER, 'Private remark');
    proposals.create.mockClear();
    handleSingleNotification.mockClear();
});
afterEach(settle);
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('the flag decides whether the tools exist', () => {
    it('off, the tool list and the registry are what they were', async () => {
        delete process.env.MCP_TOOLS_WORK;
        expect(await listed(ctx(OWNER))).toEqual(BEFORE);
        NAMES.forEach((name) => { expect(registry.has(name)).toBe(false); expect(actions.rating(name)).toBeNull(); });
        expect((await rpc(ctx(OWNER), 'page.comment.create', { pageId: PG_OPEN, text: 'Hello' })).rpcError).toMatchObject({ code: -32601 });
    });

    it('on, each tool is a rated registry action with a plain scope and no grant, and none deletes or reacts', async () => {
        expect(await listed(ctx(OWNER))).toEqual(expect.arrayContaining(NAMES));
        NAMES.forEach((name) => expect(registry.permissionsFor(name)).toEqual([{ key: 'project.project_details', write: false }]));
        expect(NAMES.map((name) => scopes.scopeForTool(name))).toEqual(['docs:read', 'tasks:write', 'tasks:write', 'tasks:write']);
        NAMES.slice(1).forEach((name) => expect(actions.rating(name)).toEqual({ write: true, reversible: true, scope: 'project', money: false }));
        expect(tools.registered().filter((tool) => NAMES.includes(tool.name)).some((tool) => tool.grant)).toBe(false);
        expect(tools.names().filter((name) => /^page\.comment/.test(name)).sort()).toEqual([...NAMES].sort());
    });
});

describe('page.comments.list', () => {
    it.each(EVERYONE)('answers the live comments of an open doc for %s, oldest first, a reply naming its thread', async (label, uid) => {
        expect(await rpc(ctx(uid), 'page.comments.list', { pageId: PG_OPEN })).toEqual({
            pageId: PG_OPEN,
            comments: [
                { commentId: C_THREAD, text: 'Is this the final list?', authorId: INSIDER, threadId: '', blockId: '', assigneeId: '', resolved: false, file: '', createdAt: '2026-09-01T00:00:00.000Z', editedAt: null },
                { commentId: C_REPLY, text: 'Nearly.', authorId: OUTSIDER, threadId: C_THREAD, blockId: '', assigneeId: '', resolved: false, file: '', createdAt: '2026-09-02T00:00:00.000Z', editedAt: null },
            ],
        });
    });

    it('answers a doc the person cannot open as it answers a missing id', async () => {
        const missing = await rpc(ctx(OWNER), 'page.comments.list', { pageId: MISSING });
        expect(missing).toEqual({ error: 'page not found' });
        for (const uid of [OUTSIDER, GUEST]) expect(await rpc(ctx(uid), 'page.comments.list', { pageId: PG_PRIVATE_PROJECT })).toEqual(missing);
        for (const uid of [OWNER, ADMIN, OUTSIDER, GUEST]) {
            expect(await rpc(ctx(uid), 'page.comments.list', { pageId: PG_PERSONAL })).toEqual(missing);
            expect(await rpc(ctx(uid), 'page.comments.list', { pageId: PG_OWN })).toEqual(missing);
        }
        expect(await rpc(ctx(OWNER), 'page.comments.list', { pageId: PG_TRASHED })).toEqual(missing);
        expect((await rpc(ctx(INSIDER), 'page.comments.list', { pageId: PG_PRIVATE_PROJECT })).comments.map((row) => row.commentId)).toEqual([C_ELSEWHERE]);
        expect(await rpc(ctx(INSIDER), 'page.comments.list', { pageId: PG_OWN })).toEqual({ pageId: PG_OWN, comments: [] });
    });

    it('stays inside the projects a token was narrowed to, and off the workspace\'s own docs', async () => {
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'page.comments.list', { pageId: PG_PRIVATE_PROJECT })).toEqual({ error: 'page not found' });
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'page.comments.list', { pageId: PG_COMPANY })).toEqual({ error: 'page not found' });
        expect(await rpc(ctx(INSIDER), 'page.comments.list', { pageId: PG_COMPANY })).toEqual({ pageId: PG_COMPANY, comments: [] });
        expect((await rpc(narrowed(INSIDER, [P_OPEN]), 'page.comments.list', { pageId: PG_OPEN, limit: 1 })).comments).toHaveLength(1);
    });
});

describe('page.comment.create', () => {
    it('stores what the comment route stores for the same person, tells the people it names, and records it', async () => {
        const text = `Ready for review ${mention('Mia Member', OUTSIDER)} <b>today</b>`;
        expect((await web('POST /api/v2/pages/:id/comments', INSIDER, { params: { id: PG_TWIN }, body: { message: text } })).body).toMatchObject({ status: true });
        const told = handleSingleNotification.mock.calls.length;

        const out = await rpc(ctx(INSIDER), 'page.comment.create', { pageId: PG_OPEN, text, reason: 'Hand-off' });
        expect(out).toMatchObject({ ok: true, undoable: true, result: { pageId: PG_OPEN, mentioned: [OUTSIDER] } });
        const mine = comment(out.result.commentId);
        expect(asStored(mine)).toEqual(asStored(comments(PG_TWIN)[0]));
        expect(mine).toMatchObject({ userId: INSIDER, mentionIds: [OUTSIDER] });
        expect(mine.message).not.toMatch(/<b>/);
        expect(handleSingleNotification.mock.calls.length).toBe(told * 2);
        expect(audits('page.comment.create', 'applied')[0]).toMatchObject({
            entityType: 'page', entityId: PG_OPEN, entityName: 'Release notes',
            meta: { onBehalfOf: INSIDER, reason: 'Hand-off', undo: { kind: 'pageComment', pageId: PG_OPEN, commentId: out.result.commentId, projectId: P_OPEN } },
        });
    });

    it.each(EVERYONE)('lets %s comment on an open doc', async (label, uid) => {
        expect(await rpc(ctx(uid), 'page.comment.create', { pageId: PG_OPEN, text: 'Looks right.' })).toMatchObject({ ok: true });
        expect(comments(PG_OPEN).map((row) => row.userId)).toEqual([INSIDER, OUTSIDER, uid]);
    });

    it('answers a doc the person cannot open as a missing doc, for every write, and stores nothing', async () => {
        const missing = await rpc(ctx(OWNER), 'page.comment.create', { pageId: MISSING, text: 'x' });
        expect(missing).toMatchObject({ refused: true, reason: NO_PAGE });
        const before = commentsNow();
        const closed = [[OUTSIDER, PG_PRIVATE_PROJECT], [GUEST, PG_PRIVATE_PROJECT], [OWNER, PG_PERSONAL], [ADMIN, PG_PERSONAL], [OWNER, PG_OWN], [OUTSIDER, PG_OWN], [OWNER, PG_TRASHED]];
        for (const [uid, pageId] of closed) {
            expect(await rpc(ctx(uid), 'page.comment.create', { pageId, text: 'x' })).toMatchObject({ refused: true, reason: NO_PAGE });
            expect(await rpc(ctx(uid), 'page.comment.reply', { pageId, commentId: C_ELSEWHERE, text: 'x' })).toMatchObject({ refused: true, reason: NO_PAGE });
            expect(await rpc(ctx(uid), 'page.comment.assign', { pageId, commentId: C_ELSEWHERE, assigneeId: uid })).toMatchObject({ refused: true, reason: NO_PAGE });
        }
        expect(commentsNow()).toBe(before);
        expect(await rpc(ctx(INSIDER), 'page.comment.create', { pageId: PG_PRIVATE_PROJECT, text: 'Seen.' })).toMatchObject({ ok: true });
    });

    it('keeps a narrowed token inside its projects, and off the workspace\'s own docs', async () => {
        const before = commentsNow();
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'page.comment.create', { pageId: PG_PRIVATE_PROJECT, text: 'x' })).toMatchObject({ refused: true, reason: NO_PAGE });
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'page.comment.create', { pageId: PG_COMPANY, text: 'x' })).toMatchObject({ refused: true, reason: NO_PAGE });
        expect(commentsNow()).toBe(before);
        expect(await rpc(ctx(INSIDER), 'page.comment.create', { pageId: PG_COMPANY, text: 'For everyone.' })).toMatchObject({ ok: true });
    });

    it('takes text within the comment limit and no argument it does not publish', async () => {
        const before = commentsNow();
        expect((await rpc(ctx(OWNER), 'page.comment.create', { pageId: PG_OPEN, text: '' })).rpcError).toMatchObject({ code: -32602 });
        expect((await rpc(ctx(OWNER), 'page.comment.create', { pageId: PG_OPEN, text: 'x'.repeat(10001) })).rpcError).toMatchObject({ code: -32602 });
        expect((await rpc(ctx(OWNER), 'page.comment.create', { pageId: PG_OPEN, text: 'x', mediaURL: 'a/b' })).rpcError).toMatchObject({ code: -32602 });
        expect(await rpc(ctx(OWNER), 'page.comment.create', { pageId: PG_OPEN, text: '   ' })).toMatchObject({ isError: true });
        expect(commentsNow()).toBe(before);
    });

    it('is taken back by a person who can open the doc, with the replies it drew', async () => {
        const { result } = await rpc(ctx(INSIDER), 'page.comment.create', { pageId: PG_PRIVATE_PROJECT, text: 'Draft remark' });
        await rpc(ctx(INSIDER), 'page.comment.reply', { pageId: PG_PRIVATE_PROJECT, commentId: result.commentId, text: 'And a reply' });
        const [row] = audits('page.comment.create', 'applied');
        expect(await undoStateOf(CID, row, { userId: OUTSIDER }, { undoHours: 24, run: null })).toMatchObject({ undoable: false });
        expect(await undoStateOf(CID, row, { userId: OWNER }, { undoHours: 24, run: null })).toMatchObject({ undoable: true });
        await inverses.pageComment(CID, row.meta.undo, { userId: OWNER });
        expect(comments(PG_PRIVATE_PROJECT).map((entry) => String(entry._id))).toEqual([C_ELSEWHERE]);
        expect(comment(result.commentId)).toMatchObject({ isDeleted: true, deletedBy: OWNER });
    });
});

describe('page.comment.reply', () => {
    it('stores what the comment route stores for a reply, and a reply to a reply joins the same thread', async () => {
        const twin = (await web('POST /api/v2/pages/:id/comments', OUTSIDER, { params: { id: PG_TWIN }, body: { message: 'Thread' } })).body.data;
        expect((await web('POST /api/v2/pages/:id/comments', INSIDER, { params: { id: PG_TWIN }, body: { message: 'Agreed.', parentId: String(twin._id) } })).body).toMatchObject({ status: true });

        const out = await rpc(ctx(INSIDER), 'page.comment.reply', { pageId: PG_OPEN, commentId: C_REPLY, text: 'Agreed.' });
        expect(out).toMatchObject({ ok: true, result: { pageId: PG_OPEN, threadId: C_THREAD } });
        expect(asStored(comment(out.result.commentId), 'parentId')).toEqual(asStored(comments(PG_TWIN)[1], 'parentId'));
        expect([String(comment(out.result.commentId).parentId), String(comments(PG_TWIN)[1].parentId)]).toEqual([C_THREAD, String(twin._id)]);
    });

    it('answers a comment of another doc, a deleted one and a missing one alike, and stores nothing', async () => {
        const before = commentsNow();
        for (const commentId of [C_ELSEWHERE, C_GONE, MISSING]) {
            expect(await rpc(ctx(INSIDER), 'page.comment.reply', { pageId: PG_OPEN, commentId, text: 'x' })).toMatchObject({ isError: true, error: 'Comment not found.' });
        }
        expect(commentsNow()).toBe(before);
    });
});

describe('page.comment.assign', () => {
    it('stores what the assign route stores for the same person, and puts back who held it on undo', async () => {
        const twin = (await web('POST /api/v2/pages/:id/comments', INSIDER, { params: { id: PG_TWIN }, body: { message: 'Is this the final list?' } })).body.data;
        expect((await web('PUT /api/v2/pages/:id/comments/:commentId/assign', INSIDER, { params: { id: PG_TWIN, commentId: String(twin._id) }, body: { assigneeId: OUTSIDER } })).body).toMatchObject({ status: true });

        expect(await rpc(ctx(INSIDER), 'page.comment.assign', { pageId: PG_OPEN, commentId: C_THREAD, assigneeId: OUTSIDER })).toMatchObject({ ok: true, undoable: true, result: { assigneeId: OUTSIDER } });
        expect(asStored(comment(C_THREAD), 'assignedAt')).toEqual(asStored(comment(String(twin._id)), 'assignedAt'));
        expect(comment(C_THREAD)).toMatchObject({ assigneeId: OUTSIDER, assignedBy: INSIDER, resolved: false });

        const [row] = audits('page.comment.assign', 'applied');
        expect(row.meta.undo).toEqual({ kind: 'pageCommentAssign', pageId: PG_OPEN, commentId: C_THREAD, previous: '', projectId: P_OPEN });
        await inverses.pageCommentAssign(CID, row.meta.undo, { userId: INSIDER });
        expect(comment(C_THREAD).assigneeId).toBeUndefined();
    });

    it('keeps the rules of the assign route: who may change it, who may hold it, and only a thread', async () => {
        await rpc(ctx(INSIDER), 'page.comment.assign', { pageId: PG_OPEN, commentId: C_THREAD, assigneeId: OUTSIDER });
        const before = commentsNow();
        expect(await rpc(ctx(GUEST), 'page.comment.assign', { pageId: PG_OPEN, commentId: C_THREAD, assigneeId: GUEST })).toMatchObject({ isError: true, error: expect.stringMatching(/Only the people on this comment or an admin/) });
        expect(await rpc(ctx(INSIDER), 'page.comment.assign', { pageId: PG_OPEN, commentId: C_REPLY, assigneeId: OUTSIDER })).toMatchObject({ isError: true, error: expect.stringMatching(/not a reply/) });
        expect(await rpc(ctx(INSIDER), 'page.comment.assign', { pageId: PG_PRIVATE_PROJECT, commentId: C_ELSEWHERE, assigneeId: OUTSIDER })).toMatchObject({ isError: true, error: expect.stringMatching(/who can read this doc/) });
        expect(await rpc(ctx(INSIDER), 'page.comment.assign', { pageId: PG_OPEN, commentId: C_ELSEWHERE, assigneeId: OUTSIDER })).toMatchObject({ isError: true, error: 'Comment not found.' });
        expect(commentsNow()).toBe(before);
        expect(await rpc(ctx(OUTSIDER), 'page.comment.assign', { pageId: PG_OPEN, commentId: C_THREAD, assigneeId: null })).toMatchObject({ ok: true, result: { assigneeId: '' } });
        expect(comment(C_THREAD).assigneeId).toBeUndefined();
    });
});

describe('the actions, reached without an MCP token', () => {
    it('keep the comment routes\' own guard, and store nothing', async () => {
        const before = commentsNow();
        const perform = (uid, action, params) => actions.perform({ companyId: CID, actor: inProduct(uid), action, params });
        await expect(perform(OUTSIDER, 'page.comment.create', { pageId: PG_PRIVATE_PROJECT, text: 'x' })).rejects.toThrow('Page not found.');
        await expect(perform(OWNER, 'page.comment.create', { pageId: PG_OWN, text: 'x' })).rejects.toThrow('Page not found.');
        await expect(perform(OUTSIDER, 'page.comment.reply', { pageId: PG_PRIVATE_PROJECT, commentId: C_ELSEWHERE, text: 'x' })).rejects.toThrow('Page not found.');
        await expect(perform(OUTSIDER, 'page.comment.assign', { pageId: PG_PRIVATE_PROJECT, commentId: C_ELSEWHERE, assigneeId: OUTSIDER })).rejects.toThrow('Page not found.');
        expect(commentsNow()).toBe(before);
    });
});

describe('scopes and outside clients', () => {
    const decided = (proposal, decider = OWNER) => approval.refusalFor(CID, proposal, { decider: { userId: decider }, isPrivileged: true });
    const say = { pageId: PG_OPEN, text: 'From outside' };

    it('needs the write scope for a write and the docs scope for the read', async () => {
        const before = commentsNow();
        expect(await rpc(readOnly(OWNER), 'page.comment.create', say)).toMatchObject({ isError: true, error: 'This token is read-only.' });
        expect(await rpc(outside(OWNER, ['docs:read']), 'page.comment.create', say)).toMatchObject({ isError: true, error: 'This token lacks the tasks:write scope.' });
        expect(await rpc(outside(OWNER, ['tasks:write']), 'page.comments.list', { pageId: PG_OPEN })).toMatchObject({ isError: true, error: 'This token lacks the docs:read scope.' });
        expect(commentsNow()).toBe(before);
        expect(await rpc(outside(OUTSIDER, ['tasks:write']), 'page.comment.create', say)).toMatchObject({ ok: true });
        expect((await rpc(readOnly(OUTSIDER), 'page.comments.list', { pageId: PG_OPEN })).comments).toHaveLength(3);
    });

    it('under taint routing is refused a doc comment, or files it for a person when the connection holds the docs manage scope', async () => {
        process.env.AGENT_TAINT_ROUTING = 'on';
        const before = commentsNow();
        expect(await rpc(outside(OWNER, ['tasks:write', 'tasks:manage']), 'page.comment.create', say)).toMatchObject({ refused: true, reason: expect.stringMatching(/outside client/) });
        expect(await rpc(outside(OWNER, ['tasks:write']), 'page.comment.reply', { ...say, commentId: C_THREAD })).toMatchObject({ refused: true });
        expect(proposals.create).not.toHaveBeenCalled();
        expect(await rpc(outside(OWNER, ['tasks:write', 'docs:manage']), 'page.comment.create', say)).toMatchObject({ ok: false, pending: true });
        expect(proposals.create).toHaveBeenCalledWith(CID, expect.objectContaining({ requestedBy: OWNER, changes: [expect.objectContaining({ action: 'page.comment.create', params: say })] }));
        expect(commentsNow()).toBe(before);

        seedGrant(INSIDER, ['tasks:write', 'docs:manage']);
        expect(await decided(filedBy(INSIDER, 'page.comment.create', { pageId: PG_PRIVATE_PROJECT, text: 'x' }))).toBeNull();
        expect(await decided(filedBy(INSIDER, 'page.comment.create', { pageId: PG_PRIVATE_PROJECT, text: 'x' }), OUTSIDER)).toMatchObject({ status: 403, error: expect.stringMatching(/approver cannot open/) });
        mockDb.store[SCHEMA_TYPE.OAUTH_GRANTS][0].scopes = ['tasks:write', 'tasks:manage'];
        expect(await decided(filedBy(INSIDER, 'page.comment.create', say))).toMatchObject({ status: 403 });
    });
});
