const fs = require('fs');
const path = require('path');
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/notification/app-notification/controller');

const C = '6f0000000000000000000c01';
const MEMBER = '6f0000000000000000000a03';
const GUEST = '6f0000000000000000000a04';
const MEMBER_ROW = '6f0000000000000000000d01';

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    return r;
};
const call = async (handler, over = {}) => {
    const r = res();
    await handler({ headers: { companyid: C }, params: {}, query: {}, body: {}, uid: GUEST, ...over }, r);
    return r;
};
const updates = (method) => mockDb.calls.filter((c) => c.method === method);
const pulled = (update) => update.data[1].$pull.notSeen;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    const push = (id, uid) => mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS, {
        _id: id, key: 'task_reminder', notificationType: 'push', assigneeUsers: [uid], receiverID: uid, notSeen: [uid],
    });
    push(MEMBER_ROW, MEMBER);
    push('6f0000000000000000000d02', GUEST);
    mockDb.seed(SCHEMA_TYPE.MENTIONS, { mentionIds: [MEMBER], notSeen: [MEMBER] });
});

describe('MSG-02 notifications are read for the session user', () => {
    it('refuses a userId query naming someone else', async () => {
        const r = await call(ctrl.getNotificationMessages, { query: { userId: MEMBER, filter: 'unread' } });
        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
        expect(r.body.data).toBeUndefined();
    });

    it('returns the caller\'s own feed without a userId', async () => {
        const r = await call(ctrl.getNotificationMessages, { query: { filter: 'unread' } });
        expect(r.body.status).toBe(true);
        expect(r.body.data.map((n) => n.receiverID)).toEqual([GUEST]);
    });

    it('refuses reading someone else\'s mentions', async () => {
        const r = await call(ctrl.getMentionsMessages, { query: { userId: MEMBER } });
        expect(r.code).toBe(403);
        expect(r.body.data).toBeUndefined();
    });

    it('reads the caller\'s mentions without a userId', async () => {
        const r = await call(ctrl.getMentionsMessages, { uid: MEMBER });
        expect(r.body.status).toBe(true);
        expect(r.body.data).toHaveLength(1);
    });
});

describe('MSG-02 marks change only the session user', () => {
    it('refuses marking a notification read for someone else', async () => {
        const r = await call(ctrl.updateMarkRead, { body: { key: 'notifications', id: MEMBER_ROW, userId: MEMBER } });
        expect(r.code).toBe(403);
        expect(updates('updateOne')).toHaveLength(0);
    });

    it('pulls the caller from notSeen when no userId is sent', async () => {
        const r = await call(ctrl.updateMarkRead, { body: { key: 'notifications', id: MEMBER_ROW } });
        expect(r.body.status).toBe(true);
        expect(pulled(updates('updateOne')[0])).toBe(GUEST);
    });

    it('refuses mark-all-read for someone else', async () => {
        const r = await call(ctrl.updateMarkAllRead, { body: { key: 'notifications', userId: MEMBER } });
        expect(r.code).toBe(403);
        expect(updates('updateMany')).toHaveLength(0);
    });

    it('scopes mark-all-read to the caller', async () => {
        const r = await call(ctrl.updateMarkAllRead, { body: { key: 'mentions' } });
        expect(r.body.status).toBe(true);
        const [update] = updates('updateMany');
        expect(update.data[0].mentionIds).toEqual({ $in: [GUEST] });
        expect(pulled(update)).toBe(GUEST);
    });

    it('lists /api/v1/push-mark-read behind the company JWT guard', () => {
        const source = fs.readFileSync(path.join(__dirname, '../Config/setMiddleware.js'), 'utf8');
        const guarded = source.slice(source.indexOf('const verifyJWTTokenWithCRoute'), source.indexOf('const verifyJWTToken ='));
        expect(guarded).toMatch(/["']\/api\/v1\/push-mark-read["']/);
    });
});

describe('MSG-03 a malformed mark-read id', () => {
    it('answers 400 with the standard envelope instead of a raw 500', async () => {
        const r = await call(ctrl.updateMarkRead, { body: { key: 'mentions', id: 'nope' } });
        expect(r.code).toBe(400);
        expect(r.body.status).toBe(false);
        expect(updates('updateOne')).toHaveLength(0);
    });
});

describe('MSG-08 the unregistered insertnotification route', () => {
    it('is gone, and nothing references it', () => {
        const root = path.join(__dirname, '..');
        expect(fs.existsSync(path.join(root, 'Modules/notification/routes.js'))).toBe(false);
        const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
        const hits = walk(path.join(root, 'Modules')).filter((f) => f.endsWith('.js') && fs.readFileSync(f, 'utf8').includes('insertnotification'));
        expect(hits).toEqual([]);
    });
});
