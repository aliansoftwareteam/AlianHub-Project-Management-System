const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    ...jest.requireActual('../utils/mongo-handler/mongoQueries'),
    MongoDbCrudOpration: (...a) => mockDb.crud(...a),
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleSingleNotification: jest.fn(async () => []) }));
jest.mock('../Modules/notification/docNotices', () => ({ ensureDocNoticeSection: jest.fn(async () => undefined) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/contentAccess', () => ({
    projectAccess: jest.fn(async (companyId, uid, projectId) => {
        const visible = String(companyId) === mockIds.company && (mockProjectReaders[String(projectId)] || []).includes(String(uid));
        return { visible, canEdit: visible, statusCode: visible ? 200 : 404 };
    }),
    isCompanyMember: jest.fn(async (companyId, uid) => String(companyId) === mockIds.company && mockMembers.includes(String(uid))),
    isCompanyAdmin: jest.fn(async (companyId, uid) => String(companyId) === mockIds.company && String(uid) === mockIds.admin),
    visibleProjectIds: jest.fn(async () => []),
}));

const mockIds = {
    company: '6f0000000000000000000c01',
    otherCompany: '6f0000000000000000000c02',
    project: '6f0000000000000000000701',
    page: '6f0000000000000000000e01',
    privatePage: '6f0000000000000000000e02',
    companyPage: '6f0000000000000000000e03',
    trashedPage: '6f0000000000000000000e04',
    author: '6f0000000000000000000a01',
    member: '6f0000000000000000000a02',
    replier: '6f0000000000000000000a03',
    outsider: '6f0000000000000000000a04',
    admin: '6f0000000000000000000a05',
    departed: '6f0000000000000000000a06',
    agent: '6f0000000000000000000a07',
};
const mockProjectReaders = {};
const mockMembers = [];

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { Notification_key, COMMENT_NOTICE_ITEMS, DOC_NOTICE_SECTION } = require('../Config/notificationKey');
const socketEmitter = require('../event/socketEventEmitter');
const { handleSingleNotification } = require('../Modules/notification/prepare-notification-data/controllerV2');
const { schema } = require('../utils/mongo-handler/schema');
const createSchema = require('../utils/mongo-handler/createSchema');
const { checkType, tableType } = require('../utils/mongo-handler/mongoQueries');
const { buildContext, listMigrations } = require('../migrations');
const comments = require('../Modules/Pages/comments');
const { canOpenComments } = require('../socket/roomAccess');
const { relayPageComment } = require('../socket/controller/commentSocket');
const { upsertRoom, removeRoom } = require('../socket/helper');

const C = mockIds.company;
const oid = (id) => new mongoose.Types.ObjectId(id);
const settle = () => new Promise((resolve) => setImmediate(resolve));

const res = () => {
    const r = { body: null };
    r.status = () => r;
    r.json = (body) => { r.body = body; return r; };
    r.send = r.json;
    return r;
};
const call = async (handler, uid, { params = {}, body = {}, companyId = C } = {}) => {
    const r = res();
    await handler({ headers: { companyid: companyId }, aud: C, uid, params: { id: mockIds.page, ...params }, body, query: {} }, r);
    await settle();
    return r;
};

const stored = () => mockDb.store[SCHEMA_TYPE.PAGE_COMMENTS] || [];
const storedById = (id) => stored().find((row) => String(row._id) === String(id));
const notices = () => handleSingleNotification.mock.calls.map(([body]) => body);
const emits = () => socketEmitter.emit.mock.calls.filter(([, payload]) => payload && payload.module === 'pageComments').map(([type, payload]) => ({ type, ...payload }));

const seat = (userId, extra = {}) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, ...extra });
const seedPage = (_id, extra = {}) => mockDb.seed(SCHEMA_TYPE.PAGES, {
    _id,
    title: 'Launch plan',
    ProjectID: oid(mockIds.project),
    createdBy: mockIds.author,
    visibility: 'project',
    deletedStatusKey: 0,
    content: { blocks: { blocks: [{ id: 'intro', type: 'paragraph', data: { text: 'Intro' } }, { id: 'risks', type: 'paragraph', data: { text: 'Risks' } }] } },
    ...extra,
});
const post = (uid, body, params) => call(comments.createComment, uid, { body, params });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    jest.clearAllMocks();
    mockProjectReaders[mockIds.project] = [mockIds.author, mockIds.member, mockIds.replier, mockIds.admin, mockIds.departed, mockIds.agent];
    mockMembers.length = 0;
    mockMembers.push(mockIds.author, mockIds.member, mockIds.replier, mockIds.outsider, mockIds.admin, mockIds.agent);
    [mockIds.author, mockIds.member, mockIds.replier, mockIds.outsider, mockIds.admin].forEach((id) => seat(id));
    seat(mockIds.departed, { isDelete: true });
    seat(mockIds.agent, { isAgent: true });
    seedPage(mockIds.page);
    seedPage(mockIds.privatePage, { visibility: 'private' });
    seedPage(mockIds.companyPage, { ProjectID: undefined, title: 'Handbook' });
    seedPage(mockIds.trashedPage, { deletedStatusKey: 1 });
});

describe('the page comments collection', () => {
    test('is registered everywhere collections are registered', () => {
        expect(SCHEMA_TYPE.PAGE_COMMENTS).toBe('pageComments');
        expect(dbCollections.PAGE_COMMENTS).toBe('pageComments');
        expect(schema.pageComments).toBeDefined();
        expect(createSchema.pageCommentsSchema).toBeInstanceOf(mongoose.Schema);
        expect(checkType(SCHEMA_TYPE.PAGE_COMMENTS)).toBe(createSchema.pageCommentsSchema);
        expect(tableType(SCHEMA_TYPE.PAGE_COMMENTS)).toBe('pageComments');
    });

    test('declares every field a comment writes, so the strict schema drops none', () => {
        const declared = Object.keys(schema.pageComments);
        ['pageId', 'blockId', 'parentId', 'userId', 'message', 'mentionIds', 'resolved', 'resolvedBy', 'resolvedAt', 'editedAt', 'isDeleted', 'deletedBy', 'deletedAt']
            .forEach((field) => expect(declared).toContain(field));
    });

    test('is read by page, in order, and by thread', () => {
        const indexes = createSchema.pageCommentsSchema.indexes().map(([key]) => key);
        expect(indexes).toContainEqual({ pageId: 1, isDeleted: 1, createdAt: 1 });
        expect(indexes).toContainEqual({ parentId: 1 });
    });
});

describe('migration 063-page-comments', () => {
    const migration = require('../migrations/063-page-comments');
    const logger = { info: jest.fn(), error: jest.fn() };
    const tenants = (built) => {
        const indexes = {};
        return {
            crud: async (companyId, q, method) => {
                if (method === 'createIndexes') { indexes[companyId] = built; return undefined; }
                if (method === 'listIndexes') return indexes[companyId] || [];
                return mockDb.crud(companyId, q, method);
            },
        };
    };
    const contextFor = (db, companies) => buildContext({ MongoDbCrudOpration: db.crud, SCHEMA_TYPE, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });

    test('is listed after 062', () => {
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('063-page-comments')).toBeGreaterThan(ids.indexOf('062-workflow-status-conditions'));
    });

    test('builds the page index in every workspace', async () => {
        await migration.up(contextFor(tenants([{ name: '_id_', key: { _id: 1 } }, { name: 'page', key: { pageId: 1, isDeleted: 1, createdAt: 1 } }]), ['c1', 'c2']));
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('063 c1'));
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('063 c2'));
    });

    test('fails loudly when the page index is missing after createIndexes', async () => {
        await expect(migration.indexCompany(contextFor(tenants([{ name: '_id_', key: { _id: 1 } }]), ['c1']), 'c1')).rejects.toThrow(/page index/);
    });
});

describe('who can read and write comments', () => {
    test('anyone who can read the doc can comment on it and list its comments', async () => {
        const r = await post(mockIds.member, { message: 'Looks good' });
        expect(r.body.status).toBe(true);
        const row = storedById(r.body.data._id);
        expect(String(row.pageId)).toBe(mockIds.page);
        expect(row.userId).toBe(mockIds.member);
        expect(row.blockId || '').toBe('');

        const list = await call(comments.listComments, mockIds.replier);
        expect(list.body.status).toBe(true);
        expect(list.body.data.map((c) => String(c._id))).toEqual([String(r.body.data._id)]);
    });

    test('someone who cannot read the doc gets the same answer as for a missing doc', async () => {
        await post(mockIds.member, { message: 'Looks good' });
        const list = await call(comments.listComments, mockIds.outsider);
        expect(list.body.status).toBe(false);
        expect(list.body.statusCode).toBe(404);
        const write = await post(mockIds.outsider, { message: 'Let me in' });
        expect(write.body.statusCode).toBe(404);
        expect(stored()).toHaveLength(1);
    });

    test('a private doc takes comments from its author alone', async () => {
        expect((await post(mockIds.member, { message: 'Hi' }, { id: mockIds.privatePage })).body.statusCode).toBe(404);
        expect((await post(mockIds.author, { message: 'Note to self' }, { id: mockIds.privatePage })).body.status).toBe(true);
    });

    test('a company doc takes comments from company members', async () => {
        expect((await post(mockIds.outsider, { message: 'Hi' }, { id: mockIds.companyPage })).body.status).toBe(true);
    });

    test('a doc in the trash takes no comments', async () => {
        expect((await post(mockIds.author, { message: 'Hi' }, { id: mockIds.trashedPage })).body.statusCode).toBe(404);
    });

    test('another company never reaches the doc', async () => {
        const r = await call(comments.createComment, mockIds.member, { body: { message: 'Hi' }, companyId: mockIds.otherCompany });
        expect(r.body.status).toBe(false);
        expect(stored()).toHaveLength(0);
    });

    test('refuses an empty or oversized message', async () => {
        expect((await post(mockIds.member, { message: '   ' })).body.statusCode).toBe(400);
        expect((await post(mockIds.member, { message: 'x'.repeat(10001) })).body.statusCode).toBe(400);
        expect(stored()).toHaveLength(0);
    });
});

describe('what a comment stores', () => {
    test('text holding markup is stored escaped, the way task comments are', async () => {
        const r = await post(mockIds.member, { message: '<img src=x onerror=alert(1)>' });
        expect(storedById(r.body.data._id).message).toBe('&lt;img src=x onerror=alert(1)&gt;');
    });

    test('the author is the caller, never the body', async () => {
        const r = await post(mockIds.member, { message: 'Hi', userId: mockIds.admin });
        expect(storedById(r.body.data._id).userId).toBe(mockIds.member);
    });

    test('a comment can be anchored to a block', async () => {
        const r = await post(mockIds.member, { message: 'Which risks?', blockId: 'risks' });
        expect(storedById(r.body.data._id).blockId).toBe('risks');
    });

    test('a malformed block id is refused', async () => {
        expect((await post(mockIds.member, { message: 'Hi', blockId: '<b>' })).body.statusCode).toBe(400);
    });

    test('a comment whose block was deleted is listed at doc level', async () => {
        const kept = await post(mockIds.member, { message: 'On intro', blockId: 'intro' });
        const orphan = await post(mockIds.member, { message: 'On gone', blockId: 'gone' });
        const list = await call(comments.listComments, mockIds.member);
        const byId = Object.fromEntries(list.body.data.map((c) => [String(c._id), c]));
        expect(byId[String(kept.body.data._id)].blockId).toBe('intro');
        expect(byId[String(orphan.body.data._id)].blockId).toBe('');
        expect(byId[String(orphan.body.data._id)].blockRemoved).toBe(true);
    });
});

describe('threads', () => {
    test('a reply joins the thread of the first comment, and inherits its block', async () => {
        const root = await post(mockIds.author, { message: 'Root', blockId: 'intro' });
        const reply = await post(mockIds.member, { message: 'Reply', parentId: String(root.body.data._id), blockId: 'risks' });
        const nested = await post(mockIds.replier, { message: 'Nested', parentId: String(reply.body.data._id) });
        expect(String(storedById(reply.body.data._id).parentId)).toBe(String(root.body.data._id));
        expect(String(storedById(nested.body.data._id).parentId)).toBe(String(root.body.data._id));
        expect(storedById(reply.body.data._id).blockId).toBe('intro');
    });

    test('a reply cannot reach into another doc', async () => {
        const elsewhere = await post(mockIds.author, { message: 'Company', }, { id: mockIds.companyPage });
        const r = await post(mockIds.member, { message: 'Reply', parentId: String(elsewhere.body.data._id) });
        expect(r.body.statusCode).toBe(404);
    });
});

describe('resolve and reopen', () => {
    test('anyone who can comment resolves and reopens a thread', async () => {
        const root = await post(mockIds.author, { message: 'Root' });
        const id = String(root.body.data._id);
        const resolved = await call(comments.resolveComment, mockIds.member, { params: { commentId: id }, body: { resolved: true } });
        expect(resolved.body.status).toBe(true);
        expect(storedById(id)).toEqual(expect.objectContaining({ resolved: true, resolvedBy: mockIds.member }));
        const reopened = await call(comments.resolveComment, mockIds.replier, { params: { commentId: id }, body: { resolved: false } });
        expect(reopened.body.status).toBe(true);
        expect(storedById(id).resolved).toBe(false);
        expect(storedById(id).resolvedBy).toBeUndefined();
    });

    test('only a thread resolves, not a reply', async () => {
        const root = await post(mockIds.author, { message: 'Root' });
        const reply = await post(mockIds.member, { message: 'Reply', parentId: String(root.body.data._id) });
        const r = await call(comments.resolveComment, mockIds.member, { params: { commentId: String(reply.body.data._id) }, body: { resolved: true } });
        expect(r.body.statusCode).toBe(400);
    });

    test('someone who cannot read the doc cannot resolve', async () => {
        const root = await post(mockIds.author, { message: 'Root' });
        const r = await call(comments.resolveComment, mockIds.outsider, { params: { commentId: String(root.body.data._id) }, body: { resolved: true } });
        expect(r.body.statusCode).toBe(404);
        expect(storedById(root.body.data._id).resolved).toBeFalsy();
    });
});

describe('edit and delete', () => {
    test('only the author edits, and the edit is marked', async () => {
        const root = await post(mockIds.author, { message: 'Frist' });
        const id = String(root.body.data._id);
        expect((await call(comments.updateComment, mockIds.admin, { params: { commentId: id }, body: { message: 'Hacked' } })).body.statusCode).toBe(403);
        const r = await call(comments.updateComment, mockIds.author, { params: { commentId: id }, body: { message: 'First <3' } });
        expect(r.body.status).toBe(true);
        expect(storedById(id).message).toBe('First &lt;3');
        expect(storedById(id).editedAt).toBeInstanceOf(Date);
    });

    test('the author or an admin deletes, and a thread goes with its replies', async () => {
        const root = await post(mockIds.author, { message: 'Root' });
        const reply = await post(mockIds.member, { message: 'Reply', parentId: String(root.body.data._id) });
        const rootId = String(root.body.data._id);
        expect((await call(comments.deleteComment, mockIds.replier, { params: { commentId: rootId } })).body.statusCode).toBe(403);
        const byAdmin = await call(comments.deleteComment, mockIds.admin, { params: { commentId: rootId } });
        expect(byAdmin.body.status).toBe(true);
        expect(storedById(rootId).isDeleted).toBe(true);
        expect(storedById(reply.body.data._id).isDeleted).toBe(true);
        expect((await call(comments.listComments, mockIds.member)).body.data).toEqual([]);
    });

    test('the author deletes their own reply without touching the thread', async () => {
        const root = await post(mockIds.author, { message: 'Root' });
        const reply = await post(mockIds.member, { message: 'Reply', parentId: String(root.body.data._id) });
        const r = await call(comments.deleteComment, mockIds.member, { params: { commentId: String(reply.body.data._id) } });
        expect(r.body.status).toBe(true);
        expect(storedById(reply.body.data._id).isDeleted).toBe(true);
        expect(storedById(root.body.data._id).isDeleted).toBeFalsy();
    });

    test('a deleted comment cannot be edited', async () => {
        const root = await post(mockIds.author, { message: 'Root' });
        const id = String(root.body.data._id);
        await call(comments.deleteComment, mockIds.author, { params: { commentId: id } });
        expect((await call(comments.updateComment, mockIds.author, { params: { commentId: id }, body: { message: 'Back' } })).body.statusCode).toBe(404);
    });
});

describe('live updates', () => {
    test('every write is announced for the doc, with its company', async () => {
        const root = await post(mockIds.author, { message: 'Root' });
        const id = String(root.body.data._id);
        await call(comments.updateComment, mockIds.author, { params: { commentId: id }, body: { message: 'Root!' } });
        await call(comments.resolveComment, mockIds.member, { params: { commentId: id }, body: { resolved: true } });
        await call(comments.deleteComment, mockIds.author, { params: { commentId: id } });
        const seen = emits();
        expect(seen.map((e) => e.type)).toEqual(['insert', 'update', 'update', 'update']);
        seen.forEach((e) => {
            expect(e.companyId).toBe(C);
            expect(String(e.data.pageId)).toBe(mockIds.page);
        });
        expect(seen[3].data.isDeleted).toBe(true);
    });

    test('a doc comment room is opened only by someone who can read the doc', async () => {
        expect(await canOpenComments({ companyId: C, uid: mockIds.member }, `pagecomments_${mockIds.page}`)).toBe(true);
        expect(await canOpenComments({ companyId: C, uid: mockIds.outsider }, `pagecomments_${mockIds.page}`)).toBe(false);
        expect(await canOpenComments({ companyId: C, uid: mockIds.member }, `pagecomments_${mockIds.privatePage}`)).toBe(false);
        expect(await canOpenComments({ companyId: C, uid: mockIds.member }, 'pagecomments_nope')).toBe(false);
    });

    test('an event reaches only the room members who can still read the doc', async () => {
        const reader = { id: 's1', rooms: new Set(), identity: { companyId: C, uid: mockIds.member }, disconnected: false };
        const revoked = { id: 's2', rooms: new Set(), identity: { companyId: C, uid: mockIds.outsider }, disconnected: false };
        const sent = [];
        const namespaceOf = (socket) => ({ to: (room) => ({ emit: (event, payload) => sent.push({ socket: socket.id, room, event, payload }) }) });
        [reader, revoked].forEach((socket) => {
            const roomName = `pagecomments_${mockIds.page}**${socket.id}`;
            socket.rooms.add(roomName);
            upsertRoom({ roomName, socketId: socket.id, namespace: namespaceOf(socket), socket });
        });
        await relayPageComment({ type: 'insert', module: 'pageComments', companyId: C, data: { _id: 'x', pageId: mockIds.page, message: 'Hi' } });
        expect(sent).toEqual([expect.objectContaining({ socket: 's1', event: 'pageCommentInsert', payload: { fullDocument: expect.objectContaining({ _id: 'x' }) } })]);
        [reader, revoked].forEach((socket) => removeRoom(`pagecomments_${mockIds.page}**${socket.id}`));
    });
});

describe('notifications', () => {
    test('doc comment notices sit in the Docs settings section, push on and email off', () => {
        const items = DOC_NOTICE_SECTION.items.filter((item) => [Notification_key.DOC_COMMENT_MENTION, Notification_key.DOC_COMMENT_REPLY].includes(item.key));
        expect(items).toHaveLength(2);
        items.forEach((item) => expect(item).toMatchObject({ browser: true, mobile: true, email: false }));
        expect(COMMENT_NOTICE_ITEMS.map((item) => item.key)).not.toEqual(expect.arrayContaining([Notification_key.DOC_COMMENT_MENTION]));
    });

    test('a settings document that already has the Docs section gains the comment notices, once', async () => {
        const { ensureDocNoticeSection, forgetHealedDocNotices } = jest.requireActual('../Modules/notification/docNotices');
        forgetHealedDocNotices();
        const older = mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, {
            userId: mockIds.member,
            docs: { key: 'docs', sectionName: 'Docs', items: [{ key: Notification_key.DOC_MENTION, browser: false, mobile: true, email: false }] },
        });
        const fresh = mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, { userId: mockIds.author });
        await ensureDocNoticeSection(C, [mockIds.member, mockIds.author]);
        await ensureDocNoticeSection(C, [mockIds.member, mockIds.author]);
        const keys = [Notification_key.DOC_MENTION, Notification_key.DOC_COMMENT_MENTION, Notification_key.DOC_COMMENT_REPLY];
        expect(older.docs.items.map((item) => item.key)).toEqual(keys);
        expect(older.docs.items[0].browser).toBe(false);
        expect(fresh.docs.items.map((item) => item.key)).toEqual(keys);
    });

    test('a mention tells the people named who can read the doc, and nobody else', async () => {
        const message = `Thoughts @[Member](${mockIds.member}) @[Out](${mockIds.outsider}) @[Gone](${mockIds.departed}) @[Bot](${mockIds.agent}) @[Me](${mockIds.author})`;
        const r = await post(mockIds.author, { message, blockId: 'intro' });
        const [notice, ...rest] = notices();
        expect(rest).toEqual([]);
        expect(notice).toEqual(expect.objectContaining({
            key: Notification_key.DOC_COMMENT_MENTION,
            type: 'docs',
            companyId: C,
            projectId: mockIds.project,
            userId: mockIds.author,
            assigneeUsers: [mockIds.member],
            changeType: 'doc_comment',
            changeData: expect.objectContaining({ pageId: mockIds.page, pageTitle: 'Launch plan', commentId: String(r.body.data._id), blockId: 'intro' }),
        }));
        expect(storedById(r.body.data._id).mentionIds).toEqual([mockIds.member]);
    });

    test('a company doc sends a doc notice with no project, naming the doc in its change data', async () => {
        await post(mockIds.author, { message: `Hey @[Out](${mockIds.outsider})` }, { id: mockIds.companyPage });
        const [notice] = notices();
        expect(notice).toEqual(expect.objectContaining({ type: 'docs', assigneeUsers: [mockIds.outsider] }));
        expect(notice.projectId).toBeUndefined();
        expect(notice.changeData.pageId).toBe(mockIds.companyPage);
    });

    test('a doc comment notice with no project is a row the notifications schema accepts', () => {
        const Notice = mongoose.models.PageCommentNoticeProbe || mongoose.model('PageCommentNoticeProbe', createSchema.notificationsSchema);
        const row = new Notice({
            key: Notification_key.DOC_COMMENT_REPLY, type: 'docs', message: 'Hi', companyId: C, userId: mockIds.author, receiverID: mockIds.member,
            changeType: 'doc_comment', changeData: { pageId: mockIds.companyPage, commentId: mockIds.page },
        });
        const error = row.validateSync();
        expect(error && error.errors.projectId).toBeUndefined();
    });

    test('a reply tells the thread author and earlier repliers, but not whoever it mentions or who wrote it', async () => {
        const root = await post(mockIds.author, { message: 'Root' });
        await post(mockIds.replier, { message: 'First reply', parentId: String(root.body.data._id) });
        handleSingleNotification.mockClear();
        await post(mockIds.member, { message: `Agreed @[Rep](${mockIds.replier})`, parentId: String(root.body.data._id) });
        const byKey = Object.fromEntries(notices().map((n) => [n.key, n]));
        expect(byKey[Notification_key.DOC_COMMENT_MENTION].assigneeUsers).toEqual([mockIds.replier]);
        expect(byKey[Notification_key.DOC_COMMENT_REPLY].assigneeUsers).toEqual([mockIds.author]);
    });

    test('an edit tells only the people it newly mentions', async () => {
        const root = await post(mockIds.author, { message: `Hi @[Member](${mockIds.member})` });
        handleSingleNotification.mockClear();
        await call(comments.updateComment, mockIds.author, {
            params: { commentId: String(root.body.data._id) },
            body: { message: `Hi @[Member](${mockIds.member}) and @[Rep](${mockIds.replier})` },
        });
        expect(notices()).toHaveLength(1);
        expect(notices()[0].assigneeUsers).toEqual([mockIds.replier]);
    });
});
