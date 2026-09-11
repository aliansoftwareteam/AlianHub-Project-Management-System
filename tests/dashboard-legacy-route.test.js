const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), getTtl: jest.fn() } }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => []) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/UserDashboard/controller');

const COMPANY = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OWNER = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const GUEST = 'cccccccccccccccccccccccc';
const T = SCHEMA_TYPE.USERDASHBOARD;

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = r.json;
    r.set = () => r;
    return r;
};
const call = async (handler, { uid, body = {}, params = {} }) => {
    const r = res();
    await handler({ headers: { companyid: COMPANY }, uid, body, params }, r);
    return r;
};

const card = (uid, extra = {}) => ({
    componentId: 'TotalTasksCard', cardId: 'x', uid,
    config: { cardData: { fieldName: 'A' }, filterData: [], position: { x: 0, y: 0, w: 4, h: 6 } },
    ...extra,
});

let ownerDoc;
let guestDoc;
beforeEach(() => {
    mockDb.store[T] = [];
    mockDb.calls.length = 0;
    ownerDoc = mockDb.seed(T, { userId: OWNER, templateId: 'tpl1', title: 'Owner private', cards: [card('111'), card('222')] });
    guestDoc = mockDb.seed(T, { userId: GUEST, templateId: 'tpl1', title: 'Guest home', cards: [card('333')] });
});

const doc = (id) => mockDb.store[T].find((d) => d._id === id);
const methodsCalled = () => mockDb.calls.filter((c) => c.type === T).map((c) => c.method);

describe('REP-01 legacy POST /api/v1/dashboard', () => {
    it('refuses a body-supplied method and queryObject without touching the collection', async () => {
        const read = await call(ctrl.updateDashboard, { uid: GUEST, body: { method: 'findOne', queryObject: [{ _id: ownerDoc._id }] } });
        const write = await call(ctrl.updateDashboard, { uid: GUEST, body: { method: 'updateOne', queryObject: [{ _id: ownerDoc._id }, { $set: { title: 'pwned' } }] } });
        const union = await call(ctrl.updateDashboard, { uid: GUEST, body: { method: 'aggregate', queryObject: [[{ $unionWith: { coll: 'saved_reports' } }]] } });

        [read, write, union].forEach((r) => {
            expect(r.code).toBe(400);
            expect(r.body.status).toBe(false);
        });
        expect(methodsCalled()).toEqual([]);
        expect(doc(ownerDoc._id).title).toBe('Owner private');
    });

    it('refuses an unknown operation', async () => {
        const r = await call(ctrl.updateDashboard, { uid: GUEST, body: { op: 'deleteMany' } });
        expect(r.code).toBe(400);
        expect(methodsCalled()).toEqual([]);
    });

    it('binds every operation to the caller\'s own dashboard, never another user\'s', async () => {
        const r = await call(ctrl.updateDashboard, {
            uid: GUEST,
            body: { op: 'updateCard', templateId: 'tpl1', cardUid: '111', cardData: { fieldName: 'pwned' } },
        });
        expect(r.code).toBe(404);
        expect(doc(ownerDoc._id).cards[0].config.cardData.fieldName).toBe('A');

        const cleared = await call(ctrl.updateDashboard, { uid: GUEST, body: { op: 'setCards', templateId: 'tpl1', cards: [] } });
        expect(cleared.code).toBe(200);
        expect(doc(ownerDoc._id).cards).toHaveLength(2);
        expect(doc(guestDoc._id).cards).toHaveLength(0);
    });

    it('refuses an unauthenticated call', async () => {
        const r = await call(ctrl.updateDashboard, { uid: undefined, body: { op: 'setCards', cards: [] } });
        expect(r.body.status).toBe(false);
        expect(methodsCalled()).toEqual([]);
    });

    describe('the owner\'s own dashboard edits still work', () => {
        it('adds a card', async () => {
            const r = await call(ctrl.updateDashboard, { uid: OWNER, body: { op: 'addCard', templateId: 'tpl1', card: card('444') } });
            expect(r.code).toBe(200);
            expect(r.body.status).toBe(true);
            expect(doc(ownerDoc._id).cards.map((c) => c.uid)).toEqual(['111', '222', '444']);
            expect(r.body.data.cards).toHaveLength(3);
        });

        it('refuses a malformed or duplicate card', async () => {
            expect((await call(ctrl.updateDashboard, { uid: OWNER, body: { op: 'addCard', card: { uid: '9' } } })).code).toBe(400);
            expect((await call(ctrl.updateDashboard, { uid: OWNER, body: { op: 'addCard', card: card('111') } })).code).toBe(400);
            expect(doc(ownerDoc._id).cards).toHaveLength(2);
        });

        it('updates one card\'s settings and filters', async () => {
            const r = await call(ctrl.updateDashboard, {
                uid: OWNER,
                body: { op: 'updateCard', templateId: 'tpl1', cardUid: '222', cardData: { fieldName: 'B' }, filterData: [{ comparisonsData: [1] }] },
            });
            expect(r.code).toBe(200);
            const updated = doc(ownerDoc._id).cards.find((c) => c.uid === '222');
            expect(updated.config.cardData).toEqual({ fieldName: 'B' });
            expect(updated.config.filterData).toEqual([{ comparisonsData: [1] }]);
            expect(updated.config.position).toEqual(card('222').config.position);
        });

        it('keeps filters when only card data changes', async () => {
            doc(ownerDoc._id).cards[0].config.filterData = [{ keep: true }];
            await call(ctrl.updateDashboard, { uid: OWNER, body: { op: 'updateCard', cardUid: '111', cardData: { fieldName: 'C' } } });
            expect(doc(ownerDoc._id).cards[0].config.filterData).toEqual([{ keep: true }]);
        });

        it('answers 404 for a card that is not on the dashboard', async () => {
            const r = await call(ctrl.updateDashboard, { uid: OWNER, body: { op: 'updateCard', cardUid: '999', cardData: {} } });
            expect(r.code).toBe(404);
        });

        it('removes a card', async () => {
            const r = await call(ctrl.updateDashboard, { uid: OWNER, body: { op: 'removeCard', templateId: 'tpl1', cardUid: '111' } });
            expect(r.code).toBe(200);
            expect(doc(ownerDoc._id).cards.map((c) => c.uid)).toEqual(['222']);
        });

        it('replaces the layout, sanitising what the client sent', async () => {
            const moved = [card('222', { config: { cardData: {}, filterData: [], position: { x: 4, y: 0, w: 4, h: 6 } }, $where: 'x' }), card('111')];
            const r = await call(ctrl.updateDashboard, { uid: OWNER, body: { op: 'setCards', templateId: 'tpl1', cards: moved } });
            expect(r.code).toBe(200);
            const saved = doc(ownerDoc._id).cards;
            expect(saved.map((c) => c.uid)).toEqual(['222', '111']);
            expect(saved[0].config.position.x).toBe(4);
            expect(saved[0]).not.toHaveProperty('$where');
        });
    });
});

describe('REP-01 legacy GET /api/v1/dashboard/:id', () => {
    it('refuses reading another user\'s dashboard', async () => {
        const r = await call(ctrl.getDashboard, { uid: GUEST, params: { id: OWNER } });
        expect(r.code).toBe(403);
        expect(JSON.stringify(r.body)).not.toContain('Owner private');
    });

    it('returns the caller\'s own dashboard', async () => {
        const r = await call(ctrl.getDashboard, { uid: OWNER, params: { id: OWNER } });
        expect(r.code).toBe(200);
        expect(r.body[0].title).toBe('Owner private');
    });
});
