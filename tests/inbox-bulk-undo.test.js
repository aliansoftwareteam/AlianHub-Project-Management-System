jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({
    updateUnReadCommentsCountFun: jest.fn(() => Promise.resolve({ status: true })),
    updateCount: jest.fn((companyId, userIds, query, cb) => cb({ status: true })),
    updateMentionCount: jest.fn((companyId, userIds, field, cb) => cb({ status: true })),
}));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(() => Promise.resolve(3)), isPrivileged: () => false }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const counter = require('../Modules/notification-count/controller');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/Inbox/controller');

const UID = '64b000000000000000000001';
const OTHER_UID = '64b000000000000000000002';
const HOUR = 60 * 60 * 1000;

const reqOf = (body = {}, uid = UID) => ({ uid, headers: { companyid: 'c1' }, body, query: {} });
const resOf = () => {
    const res = { send: jest.fn(), status: jest.fn(() => res), json: jest.fn() };
    return res;
};
const call = async (action, body, uid) => {
    const res = resOf();
    await ctrl[action](reqOf(body, uid), res);
    return res.send.mock.calls[0][0];
};

let db;
const notice = (extra = {}) => db.seed(SCHEMA_TYPE.NOTIFICATIONS, {
    receiverID: UID, assigneeUsers: [UID], key: 'task_status', notificationType: 'push', notSeen: [UID], createdAt: new Date(Date.now() - HOUR), ...extra,
});
const mention = (extra = {}) => db.seed(SCHEMA_TYPE.MENTIONS, {
    mentionIds: [UID], notSeen: [UID], comment_message: 'hi', createdAt: new Date(Date.now() - HOUR), ...extra,
});
const row = (type, id) => (db.store[type] || []).find((r) => String(r._id) === String(id));
const note = (id) => row(SCHEMA_TYPE.NOTIFICATIONS, id);
const ment = (id) => row(SCHEMA_TYPE.MENTIONS, id);
const ids = (list) => list.map((i) => `${i.sourceType}:${i.sourceId}`).sort();

beforeEach(() => {
    db = require('./fixtures/fakeMongo').create();
    // The driver reports matchedCount on updateMany; the fake reports only modifiedCount.
    MongoDbCrudOpration.mockImplementation(async (...args) => {
        const out = await db.crud(...args);
        return args[2] === 'updateMany' && out ? { matchedCount: out.modifiedCount, ...out } : out;
    });
    counter.updateCount.mockClear();
});

describe('clear all can be undone', () => {
    it('says when it cleared and which of the rows were unread, and only the caller\'s', async () => {
        const mine = notice();
        const mentioned = mention();
        notice({ receiverID: OTHER_UID, assigneeUsers: [OTHER_UID], notSeen: [OTHER_UID] });
        notice({ clearedAt: new Date(Date.now() - HOUR), notSeen: [] });

        const out = await call('clearAll', { tab: 'primary' });
        expect(out.status).toBe(true);
        expect(out.data.count).toBe(2);
        expect(Number.isNaN(new Date(out.data.clearedAt).getTime())).toBe(false);
        expect(ids(out.data.unread)).toEqual(ids([
            { sourceType: 'notification', sourceId: String(mine._id) },
            { sourceType: 'mention', sourceId: String(mentioned._id) },
        ]));
    });

    it('restores exactly the rows that clear all cleared, unread again', async () => {
        const mine = notice();
        const mentioned = mention();
        const earlier = notice({ clearedAt: new Date(Date.now() - HOUR), notSeen: [] });
        const cleared = await call('clearAll', { tab: 'primary' });
        expect(note(mine._id).clearedAt).toBeInstanceOf(Date);
        expect(ment(mentioned._id).mentionIds).toEqual([]);

        const out = await call('restoreAll', { clearedAt: cleared.data.clearedAt, unread: cleared.data.unread });
        expect(out.status).toBe(true);
        expect(out.data.count).toBe(2);
        expect(note(mine._id).clearedAt).toBeUndefined();
        expect(note(mine._id).notSeen).toEqual([UID]);
        expect(ment(mentioned._id).mentionIds).toEqual([UID]);
        expect(ment(mentioned._id).notSeen).toEqual([UID]);
        expect(ment(mentioned._id).clearedFor).toEqual([]);
        expect(note(earlier._id).clearedAt).toBeInstanceOf(Date);
        expect(counter.updateCount.mock.calls.map(([, users, q]) => [users, q.$inc])).toEqual(expect.arrayContaining([
            [[UID], { notification_counts: 1 }],
            [[UID], { mention_counts: 1 }],
        ]));
    });

    it('brings a row that was already read back read', async () => {
        const read = notice({ notSeen: [] });
        const readMention = mention({ notSeen: [] });
        const cleared = await call('clearAll', { tab: 'done' });
        expect(cleared.data.count).toBe(2);
        expect(cleared.data.unread).toEqual([]);

        await call('restoreAll', { clearedAt: cleared.data.clearedAt, unread: cleared.data.unread });
        expect(note(read._id).clearedAt).toBeUndefined();
        expect(note(read._id).notSeen).toEqual([]);
        expect(ment(readMention._id).mentionIds).toEqual([UID]);
        expect(ment(readMention._id).notSeen).toEqual([]);
    });

    it('never restores another reader\'s rows or rows another action cleared, whatever ids it is sent', async () => {
        const at = new Date(Date.now() - 1000);
        const theirs = notice({ receiverID: OTHER_UID, assigneeUsers: [OTHER_UID], clearedAt: at, notSeen: [] });
        const theirMention = mention({ mentionIds: [], notSeen: [], clearedFor: [{ userId: OTHER_UID, at }] });
        const mineEarlier = notice({ clearedAt: new Date(at.getTime() - 1), notSeen: [] });
        const unread = [theirs, theirMention, mineEarlier].map((r, i) => ({ sourceType: i === 1 ? 'mention' : 'notification', sourceId: String(r._id) }));

        const out = await call('restoreAll', { clearedAt: at.toISOString(), unread });
        expect(out.status).toBe(true);
        expect(out.data.count).toBe(0);
        expect(note(theirs._id).clearedAt).toEqual(at);
        expect(note(theirs._id).notSeen).toEqual([]);
        expect(ment(theirMention._id).clearedFor).toEqual([{ userId: OTHER_UID, at }]);
        expect(ment(theirMention._id).mentionIds).toEqual([]);
        expect(note(mineEarlier._id).clearedAt).toBeInstanceOf(Date);
        expect(counter.updateCount).not.toHaveBeenCalled();
    });

    it('refuses without a readable clear time, or without a session user, and writes nothing', async () => {
        notice({ clearedAt: new Date(), notSeen: [] });
        expect((await call('restoreAll', {})).status).toBe(false);
        expect((await call('restoreAll', { clearedAt: 'yesterday' })).status).toBe(false);
        expect((await call('restoreAll', { clearedAt: new Date().toISOString() }, '')).status).toBe(false);
        expect(db.calls.filter((c) => c.method !== 'find')).toEqual([]);
    });

    it('is served at POST /api/v1/inbox/restore-all', () => {
        const app = { get: jest.fn(), post: jest.fn() };
        require('../Modules/Inbox/routes').init(app);
        expect(app.post.mock.calls.map(([path]) => path)).toContain('/api/v1/inbox/restore-all');
    });
});

describe('mark all read can be undone', () => {
    it('returns the caller\'s rows it read, and marking those unread puts back exactly them', async () => {
        const first = notice();
        const second = notice();
        const mentioned = mention();
        const already = notice({ notSeen: [] });
        const theirs = notice({ receiverID: OTHER_UID, assigneeUsers: [OTHER_UID], notSeen: [OTHER_UID] });

        const out = await call('markAllRead', { tab: 'primary' });
        expect(out.status).toBe(true);
        expect(ids(out.data.items)).toEqual(ids([
            { sourceType: 'notification', sourceId: String(first._id) },
            { sourceType: 'notification', sourceId: String(second._id) },
            { sourceType: 'mention', sourceId: String(mentioned._id) },
        ]));
        expect(note(first._id).notSeen).toEqual([]);

        await call('markRead', { items: out.data.items, read: 'false' });
        expect(note(first._id).notSeen).toEqual([UID]);
        expect(note(second._id).notSeen).toEqual([UID]);
        expect(ment(mentioned._id).notSeen).toEqual([UID]);
        expect(note(already._id).notSeen).toEqual([]);
        expect(note(theirs._id).notSeen).toEqual([OTHER_UID]);
    });
});
