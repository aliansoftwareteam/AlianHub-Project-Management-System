/* Task 046 M3: goals and their targets. A goal has a name, a period, an owner and up to twenty
   targets whose value a person sets by hand. The route handlers run over fakeMongo. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn() }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const socketEmitter = require('../event/socketEventEmitter');
const goals = require('../Modules/Goals/controller');
const rules = require('../Modules/Goals/helpers/goalRules');
const createSchema = require('../utils/mongo-handler/createSchema');
const { schema } = require('../utils/mongo-handler/schema');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ADMIN = '6f0000000000000000000002';
const AUTHOR = '6f0000000000000000000003';
const NAMED = '6f0000000000000000000004';
const ROLES = { [ADMIN]: 2, [AUTHOR]: 3, [NAMED]: 3 };

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};
const call = async (handler, uid, { body, id, targetId, query } = {}) => {
    const res = response();
    await handler({ headers: { companyid: C }, aud: C, uid, body, query: query || {}, params: { id, targetId } }, res);
    return res;
};

const stored = () => mockDb.store[SCHEMA_TYPE.GOALS] || [];
const create = (body = { name: 'Grow revenue' }, uid = AUTHOR) => call(goals.createGoal, uid, { body });
const made = async (body) => (await create(body)).body.data;
const addTarget = (id, body, uid = AUTHOR) => call(goals.addTarget, uid, { id, body });
const setValue = (id, targetId, body, uid = AUTHOR) => call(goals.setTargetValue, uid, { id, targetId, body });

const CUSTOMERS = { name: 'New customers', kind: 'number', start: 0, target: 10, current: 3, unit: 'customers' };
const REVENUE = { name: 'Revenue', kind: 'currency', start: 1000, target: 5000, currencyCode: 'USD', weight: 2 };
const LAUNCH = { name: 'Launched', kind: 'boolean' };

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    Object.entries(ROLES).forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    mockDb.seed(SCHEMA_TYPE.CURRENCY_LIST, { code: 'USD' });
    mockDb.seed(SCHEMA_TYPE.CURRENCY_LIST, { code: 'EUR' });
});

describe('a goal', () => {
    it('keeps a name, a description, a period, a colour and who it is shared with', async () => {
        const res = await create({
            name: '  Grow   revenue ', description: ' Net new only ', periodStart: '2026-10-01', periodEnd: '2026-12-31',
            visibility: 'people', sharedWith: [NAMED], color: '#7B68EE',
        });
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ status: true, statusText: 'Goal saved.' });
        expect(res.body.data).toEqual({
            _id: expect.stringMatching(/^[a-f0-9]{24}$/i), name: 'Grow revenue', description: 'Net new only', ownerUserId: AUTHOR,
            periodStart: '2026-10-01', periodEnd: '2026-12-31', visibility: 'people', sharedWith: [NAMED], sharedWithMe: false, isOwner: true,
            color: '#7B68EE', progressPct: 0, targets: [], archived: false, canEdit: true, canSetValue: true,
            createdBy: AUTHOR, createdAt: expect.any(Date), updatedAt: null,
        });
        expect(stored()[0]).toMatchObject({ name: 'Grow revenue', ownerUserId: AUTHOR, createdBy: AUTHOR, updatedBy: AUTHOR, revision: 0, deletedStatusKey: 0 });
    });

    it('needs only a name', async () => {
        expect(await made({ name: 'Ship it' })).toMatchObject({ name: 'Ship it', description: '', periodStart: '', periodEnd: '', visibility: 'private', sharedWith: [], color: '', targets: [] });
    });

    it('can be made with its targets in one request', async () => {
        const goal = await made({ name: 'Q4', targets: [CUSTOMERS, { ...REVENUE, weight: 1 }, { ...LAUNCH, done: true }] });
        expect(goal.targets.map((target) => [target.name, target.kind, target.progressPct])).toEqual([['New customers', 'number', 30], ['Revenue', 'currency', 0], ['Launched', 'boolean', 100]]);
        expect(new Set(goal.targets.map((target) => target.id)).size).toBe(3);
        expect(goal.progressPct).toBe(43);
    });

    it('is listed by name with its progress', async () => {
        await create({ name: 'Zeta' });
        await create({ name: 'alpha', targets: [{ ...LAUNCH, done: true }] });
        const list = (await call(goals.listGoals, AUTHOR)).body;
        expect(list.statusText).toBe('Goals fetched successfully.');
        expect(list.data.map((goal) => [goal.name, goal.progressPct])).toEqual([['alpha', 100], ['Zeta', 0]]);
    });

    it('can have its name, description, period, colour and visibility changed, one or several at a time', async () => {
        const { _id: id } = await made({ name: 'Grow revenue', periodStart: '2026-10-01', periodEnd: '2026-12-31' });
        const renamed = await call(goals.updateGoal, AUTHOR, { id, body: { name: 'Grow revenue by half' } });
        expect(renamed.body.data).toMatchObject({ _id: id, name: 'Grow revenue by half', periodEnd: '2026-12-31' });
        const moved = await call(goals.updateGoal, AUTHOR, { id, body: { periodEnd: null, color: '#112233', visibility: 'workspace', description: 'All regions' } });
        expect(moved.body.data).toMatchObject({ periodStart: '2026-10-01', periodEnd: '', color: '#112233', visibility: 'workspace', description: 'All regions' });
        expect((await call(goals.getGoal, AUTHOR, { id })).body.data).toMatchObject({ name: 'Grow revenue by half', visibility: 'workspace' });
        expect(stored()[0]).toMatchObject({ revision: 2, updatedBy: AUTHOR });
    });

    it('can be archived and restored, and is out of the list in between', async () => {
        const { _id: id } = await made();
        const archived = await call(goals.archiveGoal, AUTHOR, { id });
        expect(archived.body).toMatchObject({ statusText: 'Goal archived.', data: { _id: id, archived: true } });
        expect((await call(goals.listGoals, AUTHOR)).body.data).toEqual([]);
        expect((await call(goals.listGoals, AUTHOR, { query: { archived: 'true' } })).body.data.map((goal) => goal._id)).toEqual([id]);
        const restored = await call(goals.restoreGoal, AUTHOR, { id });
        expect(restored.body).toMatchObject({ statusText: 'Goal restored.', data: { _id: id, archived: false } });
        expect((await call(goals.listGoals, AUTHOR)).body.data).toHaveLength(1);
        expect(stored()).toHaveLength(1);
    });

    it('is capped per owner', async () => {
        for (let n = 0; n < rules.MAX_GOALS_PER_OWNER; n += 1) mockDb.seed(SCHEMA_TYPE.GOALS, { name: `Goal ${n}`, ownerUserId: AUTHOR, visibility: 'private', deletedStatusKey: 0 });
        expect((await create()).statusCode).toBe(400);
        expect(stored()).toHaveLength(rules.MAX_GOALS_PER_OWNER);
        expect((await create({ name: 'Mine' }, NAMED)).statusCode).toBe(200);
    });
});

describe('a target', () => {
    let id;
    beforeEach(async () => { id = (await made())._id; });
    const targetsOf = async () => (await call(goals.getGoal, AUTHOR, { id })).body.data.targets;

    it('measures a number from a start to a target', async () => {
        const res = await addTarget(id, CUSTOMERS);
        expect(res.body.statusText).toBe('Target added.');
        expect(res.body.data.targets).toEqual([{
            id: expect.stringMatching(/^[a-f0-9]{24}$/), name: 'New customers', kind: 'number', weight: 1, progressPct: 30, reachedAt: null,
            start: 0, target: 10, current: 3, unit: 'customers', updatedBy: AUTHOR, updatedAt: expect.any(Date),
        }]);
        expect(res.body.data.progressPct).toBe(30);
    });

    it('starts where its range starts unless it is told otherwise, and from zero when no start is given', async () => {
        const [revenue] = (await addTarget(id, REVENUE)).body.data.targets;
        expect(revenue).toMatchObject({ kind: 'currency', currencyCode: 'USD', start: 1000, target: 5000, current: 1000, unit: '', weight: 2, progressPct: 0 });
        const [, plain] = (await addTarget(id, { name: 'Calls', kind: 'number', target: 40 })).body.data.targets;
        expect(plain).toMatchObject({ start: 0, current: 0, target: 40 });
    });

    it('is true or false, and carries no range', async () => {
        const [launch] = (await addTarget(id, LAUNCH)).body.data.targets;
        expect(launch).toEqual({ id: expect.any(String), name: 'Launched', kind: 'boolean', weight: 1, progressPct: 0, reachedAt: null, done: false, updatedBy: AUTHOR, updatedAt: expect.any(Date) });
    });

    it('has its value set on its own, which moves the goal and records who set it and when', async () => {
        const [customers] = (await addTarget(id, CUSTOMERS, AUTHOR)).body.data.targets;
        await call(goals.updateGoal, AUTHOR, { id, body: { visibility: 'workspace' } });
        const before = Date.now();
        const res = await setValue(id, customers.id, { current: 8 }, ADMIN);
        expect(res.body.statusText).toBe('Target updated.');
        expect(res.body.data).toMatchObject({ progressPct: 80, targets: [{ current: 8, progressPct: 80, updatedBy: ADMIN, reachedAt: null }] });
        expect(res.body.data.targets[0].updatedAt.getTime()).toBeGreaterThanOrEqual(before);
        expect(stored()[0]).toMatchObject({ progressPct: 80, updatedBy: ADMIN });
        expect(stored()[0].targets[0]).toMatchObject({ name: 'New customers', start: 0, target: 10, current: 8, progressPct: 80 });
    });

    it('marks the moment it is reached and forgets it when the value falls back', async () => {
        const [customers] = (await addTarget(id, CUSTOMERS)).body.data.targets;
        const reached = (await setValue(id, customers.id, { current: 12 })).body.data.targets[0];
        expect(reached).toMatchObject({ current: 12, progressPct: 100 });
        expect(reached.reachedAt).toBeInstanceOf(Date);
        const still = (await setValue(id, customers.id, { current: 10 })).body.data.targets[0];
        expect(still.reachedAt).toBe(reached.reachedAt);
        expect((await setValue(id, customers.id, { current: 9 })).body.data.targets[0]).toMatchObject({ progressPct: 90, reachedAt: null });
    });

    it('is ticked and unticked when it is true or false', async () => {
        const [launch] = (await addTarget(id, LAUNCH)).body.data.targets;
        expect((await setValue(id, launch.id, { done: true })).body.data).toMatchObject({ progressPct: 100, targets: [{ done: true, progressPct: 100 }] });
        expect((await setValue(id, launch.id, { done: false })).body.data).toMatchObject({ progressPct: 0, targets: [{ done: false, reachedAt: null }] });
    });

    it('weighs on the goal by its weight', async () => {
        const [launch] = (await addTarget(id, { ...LAUNCH, weight: 3 })).body.data.targets;
        await addTarget(id, { name: 'Announced', kind: 'boolean' });
        expect((await setValue(id, launch.id, { done: true })).body.data.progressPct).toBe(75);
    });

    it('can be renamed, re-ranged and re-weighed without touching its value or who set it', async () => {
        const [customers] = (await addTarget(id, CUSTOMERS)).body.data.targets;
        await call(goals.updateGoal, AUTHOR, { id, body: { visibility: 'workspace' } });
        const res = await call(goals.editTarget, ADMIN, { id, targetId: customers.id, body: { name: 'Customers won', target: 6, unit: '', weight: 5 } });
        expect(res.body.statusText).toBe('Target saved.');
        expect(res.body.data.targets[0]).toMatchObject({ id: customers.id, name: 'Customers won', kind: 'number', start: 0, target: 6, current: 3, unit: '', weight: 5, progressPct: 50, updatedBy: AUTHOR });
        expect(res.body.data.progressPct).toBe(50);
    });

    it('can change its currency to another the workspace has', async () => {
        const [revenue] = (await addTarget(id, REVENUE)).body.data.targets;
        expect((await call(goals.editTarget, AUTHOR, { id, targetId: revenue.id, body: { currencyCode: 'EUR' } })).body.data.targets[0].currencyCode).toBe('EUR');
        const refused = await call(goals.editTarget, AUTHOR, { id, targetId: revenue.id, body: { currencyCode: 'XTS' } });
        expect(refused.body).toMatchObject({ status: false, field: 'currencyCode' });
    });

    it('can be removed, and the goal is measured again without it', async () => {
        const [launch] = (await addTarget(id, { ...LAUNCH, done: true })).body.data.targets;
        await addTarget(id, CUSTOMERS);
        expect((await call(goals.getGoal, AUTHOR, { id })).body.data.progressPct).toBe(65);
        const res = await call(goals.removeTarget, AUTHOR, { id, targetId: launch.id });
        expect(res.body).toMatchObject({ statusText: 'Target removed.', data: { progressPct: 30 } });
        expect((await targetsOf()).map((target) => target.name)).toEqual(['New customers']);
    });

    it('answers a target the goal does not have as missing', async () => {
        await addTarget(id, CUSTOMERS);
        for (const res of [
            await setValue(id, 'no-such-target', { current: 1 }),
            await call(goals.editTarget, AUTHOR, { id, targetId: 'no-such-target', body: { name: 'N' } }),
            await call(goals.removeTarget, AUTHOR, { id, targetId: 'no-such-target' }),
        ]) {
            expect({ statusCode: res.statusCode, statusText: res.body.statusText }).toEqual({ statusCode: 404, statusText: 'Target not found.' });
        }
        expect(stored()[0].targets).toHaveLength(1);
    });

    it('is one of at most twenty', async () => {
        const full = Array.from({ length: rules.MAX_TARGETS }, (_, n) => ({ name: `Target ${n}`, kind: 'boolean' }));
        const goal = await made({ name: 'Full', targets: full });
        expect(goal.targets).toHaveLength(rules.MAX_TARGETS);
        const over = await addTarget(goal._id, LAUNCH);
        expect(over.statusCode).toBe(400);
        expect(over.body.field).toBe('targets');
        expect(stored()[1].targets).toHaveLength(rules.MAX_TARGETS);

        const tooMany = await create({ name: 'Over', targets: [...full, LAUNCH] });
        expect(tooMany.statusCode).toBe(400);
        expect(tooMany.body.field).toBe('targets');
        expect(stored()).toHaveLength(2);
    });
});

describe('two writes at the same moment', () => {
    const original = mockDb.crud.getMockImplementation();
    afterEach(() => mockDb.crud.mockImplementation(original));

    /* Runs `meanwhile` on the stored goal just before the next write lands, as another request would. */
    const raceOnce = (meanwhile) => {
        let raced = false;
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (method === 'findOneAndUpdate' && query.type === SCHEMA_TYPE.GOALS && !raced) {
                raced = true;
                meanwhile(stored()[0]);
                stored()[0].revision += 1;
            }
            return original(companyId, query, method);
        });
    };

    it('both land: the second is made again on what the first left', async () => {
        const goal = await made({ name: 'Q4', targets: [CUSTOMERS, LAUNCH] });
        const [customers, launch] = goal.targets;
        raceOnce((row) => { row.targets = row.targets.map((target) => (target.id === launch.id ? { ...target, done: true } : target)); });
        const res = await setValue(goal._id, customers.id, { current: 10 });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.targets.map((target) => [target.name, target.progressPct])).toEqual([['New customers', 100], ['Launched', 100]]);
        expect(res.body.data.progressPct).toBe(100);
        expect(stored()[0].revision).toBe(2);
    });

    it('a write does not land on a goal that left the writer\'s reach in between', async () => {
        const goal = await made({ name: 'Q4', visibility: 'workspace', targets: [CUSTOMERS] });
        raceOnce((row) => { row.visibility = 'private'; });
        const res = await setValue(goal._id, goal.targets[0].id, { current: 10 }, ADMIN);
        expect(res.statusCode).toBe(404);
        expect(stored()[0].targets[0].current).toBe(3);
    });

    it('gives up, saying so, when the goal keeps changing', async () => {
        const goal = await made({ name: 'Q4', targets: [CUSTOMERS] });
        mockDb.crud.mockImplementation(async (companyId, query, method) => {
            if (method === 'findOneAndUpdate' && query.type === SCHEMA_TYPE.GOALS) stored()[0].revision += 1;
            return original(companyId, query, method);
        });
        const res = await setValue(goal._id, goal.targets[0].id, { current: 10 });
        expect(res.statusCode).toBe(409);
        expect(stored()[0].targets[0].current).toBe(3);
    });
});

describe('what a request may hold', () => {
    const refusal = (fn) => {
        try { fn(); } catch (error) { if (error instanceof rules.GoalRefused) return error.field; throw error; }
        return null;
    };

    it.each([
        ['body', []],
        ['body', 'name=Grow'],
        ['name', {}],
        ['name', { name: '   ' }],
        ['name', { name: 7 }],
        ['name', { name: 'x'.repeat(rules.MAX_NAME + 1) }],
        ['description', { name: 'N', description: 'x'.repeat(rules.MAX_DESCRIPTION + 1) }],
        ['description', { name: 'N', description: null }],
        ['periodStart', { name: 'N', periodStart: '2026-13-01' }],
        ['periodStart', { name: 'N', periodStart: '2026-02-30' }],
        ['periodEnd', { name: 'N', periodEnd: '31/12/2026' }],
        ['periodEnd', { name: 'N', periodEnd: 1767139200000 }],
        ['visibility', { name: 'N', visibility: 'public' }],
        ['visibility', { name: 'N', visibility: ['workspace'] }],
        ['sharedWith', { name: 'N', sharedWith: NAMED }],
        ['sharedWith', { name: 'N', sharedWith: ['not-an-id'] }],
        ['sharedWith', { name: 'N', sharedWith: [{ $ne: null }] }],
        ['sharedWith', { name: 'N', sharedWith: Array.from({ length: rules.MAX_SHARED + 1 }, (_, n) => String(n).padStart(24, '0')) }],
        ['color', { name: 'N', color: 'red' }],
        ['color', { name: 'N', color: '#12345' }],
        ['targets', { name: 'N', targets: {} }],
        ['targets.0', { name: 'N', targets: ['Launched'] }],
        ['targets.1.kind', { name: 'N', targets: [LAUNCH, { name: 'T', kind: 'epic' }] }],
        ['ownerUserId', { name: 'N', ownerUserId: ADMIN }],
        ['progressPct', { name: 'N', progressPct: 100 }],
        ['deletedStatusKey', { name: 'N', deletedStatusKey: 0 }],
        ['revision', { name: 'N', revision: 9 }],
        ['createdBy', { name: 'N', createdBy: ADMIN }],
        ['$where', { name: 'N', $where: 'sleep(1000)' }],
        ['__proto__', JSON.parse('{"name":"N","__proto__":{"visibility":"workspace"}}')],
    ])('refuses a new goal with a bad %s', (field, body) => {
        expect(refusal(() => rules.parseGoalBody(body, { creating: true }))).toBe(field);
    });

    it.each([
        ['body', {}],
        ['targets', { targets: [] }],
        ['ownerUserId', { ownerUserId: 'me' }],
        ['ownerUserId', { ownerUserId: { $ne: '' } }],
        ['name', { name: '' }],
        ['progressPct', { progressPct: 100 }],
    ])('refuses a change with a bad %s', (field, body) => {
        expect(refusal(() => rules.parseGoalBody(body))).toBe(field);
    });

    it.each([
        ['body', 'Launched'],
        ['kind', { name: 'T' }],
        ['kind', { name: 'T', kind: 'epic' }],
        ['kind', { name: 'T', kind: ['number'] }],
        ['name', { kind: 'boolean' }],
        ['name', { kind: 'number', name: '', target: 1 }],
        ['target', { kind: 'number', name: 'T' }],
        ['target', { kind: 'number', name: 'T', target: '10' }],
        ['target', { kind: 'number', name: 'T', target: Infinity }],
        ['target', { kind: 'number', name: 'T', target: 1e16 }],
        ['target', { kind: 'number', name: 'T', start: 5, target: 5 }],
        ['target', { kind: 'number', name: 'T', target: 0 }],
        ['start', { kind: 'number', name: 'T', start: null, target: 5 }],
        ['current', { kind: 'number', name: 'T', target: 5, current: NaN }],
        ['unit', { kind: 'number', name: 'T', target: 5, unit: 'x'.repeat(rules.MAX_UNIT + 1) }],
        ['weight', { kind: 'boolean', name: 'T', weight: 0 }],
        ['weight', { kind: 'boolean', name: 'T', weight: 1.5 }],
        ['weight', { kind: 'boolean', name: 'T', weight: rules.MAX_WEIGHT + 1 }],
        ['currencyCode', { kind: 'currency', name: 'T', target: 5 }],
        ['currencyCode', { kind: 'currency', name: 'T', target: 5, currencyCode: 'usd' }],
        ['currencyCode', { kind: 'currency', name: 'T', target: 5, currencyCode: 'DOLLARS' }],
        ['currencyCode', { kind: 'number', name: 'T', target: 5, currencyCode: 'USD' }],
        ['done', { kind: 'boolean', name: 'T', done: 'yes' }],
        ['done', { kind: 'number', name: 'T', target: 5, done: true }],
        ['target', { kind: 'boolean', name: 'T', target: 5 }],
        ['id', { kind: 'boolean', name: 'T', id: 'chosen' }],
        ['progressPct', { kind: 'boolean', name: 'T', progressPct: 100 }],
        ['reachedAt', { kind: 'boolean', name: 'T', reachedAt: '2020-01-01' }],
        ['updatedBy', { kind: 'boolean', name: 'T', updatedBy: ADMIN }],
        ['sources', { kind: 'number', name: 'T', target: 5, sources: { taskIds: [] } }],
    ])('refuses a new target with a bad %s', (field, body) => {
        expect(refusal(() => rules.parseNewTarget(body))).toBe(field);
    });

    const NUMBER = { id: 't', name: 'T', kind: 'number', start: 0, target: 10, current: 3, unit: '' };
    const FLAG = { id: 'f', name: 'F', kind: 'boolean', done: false };

    it.each([
        ['body', NUMBER, {}],
        ['kind', NUMBER, { kind: 'boolean' }],
        ['current', NUMBER, { current: 9 }],
        ['done', FLAG, { done: true }],
        ['target', FLAG, { target: 4 }],
        ['target', NUMBER, { target: 0 }],
        ['target', NUMBER, { start: 10 }],
        ['currencyCode', NUMBER, { currencyCode: 'USD' }],
        ['id', NUMBER, { id: 'other' }],
        ['name', FLAG, { name: 4 }],
    ])('refuses a change to a target with a bad %s', (field, stored, body) => {
        expect(refusal(() => rules.parseTargetEdit(body, stored))).toBe(field);
    });

    it.each([
        ['current', NUMBER, {}],
        ['current', NUMBER, { current: '9' }],
        ['current', NUMBER, { current: null }],
        ['done', NUMBER, { done: true }],
        ['done', FLAG, { done: 1 }],
        ['current', FLAG, { current: 1 }],
        ['target', NUMBER, { current: 9, target: 9 }],
        ['name', FLAG, { done: true, name: 'Renamed' }],
        ['body', NUMBER, [9]],
    ])('refuses a value with a bad %s', (field, stored, body) => {
        expect(refusal(() => rules.parseTargetValue(body, stored))).toBe(field);
    });

    it('answers a refused request with 400 and the field, and stores nothing', async () => {
        const res = await create({ name: 'N', ownerUserId: ADMIN, progressPct: 100 });
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false, statusText: 'Request refused', field: 'ownerUserId' });
        expect((await create({ name: 'N', targets: [{ ...REVENUE, currencyCode: 'XTS' }] })).body.field).toBe('targets.0.currencyCode');
        expect((await create({ name: 'N', periodStart: '2026-12-31', periodEnd: '2026-10-01' })).body.field).toBe('periodEnd');
        expect(stored()).toEqual([]);
    });

    it('holds a change to one end of the period against the other, and leaves the goal as it was', async () => {
        const { _id: id } = await made({ name: 'N', periodStart: '2026-10-01', periodEnd: '2026-12-31', targets: [CUSTOMERS] });
        const res = await call(goals.updateGoal, AUTHOR, { id, body: { periodStart: '2027-01-01' } });
        expect(res.statusCode).toBe(400);
        expect(res.body.field).toBe('periodEnd');
        const [customers] = stored()[0].targets;
        expect((await setValue(id, customers.id, { current: '9' })).statusCode).toBe(400);
        expect((await setValue(id, customers.id, { done: true })).body.field).toBe('done');
        expect((await call(goals.editTarget, AUTHOR, { id, targetId: customers.id, body: { current: 9 } })).body.field).toBe('current');
        expect((await addTarget(id, { ...REVENUE, currencyCode: 'XTS' })).body.field).toBe('currencyCode');
        expect((await call(goals.archiveGoal, AUTHOR, { id, body: { reason: 'done' } })).body.field).toBe('body');
        expect((await call(goals.removeTarget, AUTHOR, { id, targetId: customers.id, body: { force: true } })).body.field).toBe('body');
        expect(stored()[0]).toMatchObject({ periodStart: '2026-10-01', revision: 0, deletedStatusKey: 0 });
        expect(stored()[0].targets[0]).toMatchObject({ current: 3 });
    });

    it('refuses a list filter that is not true or false', async () => {
        const res = await call(goals.listGoals, AUTHOR, { query: { archived: '1' } });
        expect(res.statusCode).toBe(400);
        expect(res.body.field).toBe('archived');
        expect((await call(goals.listGoals, AUTHOR, { query: { mine: ['true', 'false'] } })).body.field).toBe('mine');
    });
});

describe('the stored row', () => {
    const { checkType, tableType } = jest.requireActual('../utils/mongo-handler/mongoQueries');
    const Goal = mongoose.model('goal_fit', checkType(SCHEMA_TYPE.GOALS));
    const dropped = (sent, kept) => Object.keys(sent).filter((key) => sent[key] !== undefined && !(key in kept));

    it('lives in its own collection, in a strict schema, with an index for each way the list is read', () => {
        expect(SCHEMA_TYPE.GOALS).toBe('goals');
        expect(dbCollections.GOALS).toBe('goals');
        expect(tableType(SCHEMA_TYPE.GOALS)).toBe('goals');
        expect(checkType(SCHEMA_TYPE.GOALS)).toBe(createSchema.goalsSchema);
        expect(createSchema.goalsSchema.options.strict).toBe(true);
        expect(createSchema.goalsSchema.path('targets').schema.options.strict).not.toBe(false);
        const indexes = createSchema.goalsSchema.indexes().map(([key]) => key);
        expect(indexes).toContainEqual({ deletedStatusKey: 1, ownerUserId: 1 });
        expect(indexes).toContainEqual({ deletedStatusKey: 1, visibility: 1 });
    });

    it('keeps every field a goal is saved with, and every field of each kind of target', async () => {
        await create({
            name: 'Q4', description: 'All regions', periodStart: '2026-10-01', periodEnd: '2026-12-31', visibility: 'people', sharedWith: [NAMED], color: '#7b68ee',
            targets: [{ ...CUSTOMERS, current: 10 }, REVENUE, { ...LAUNCH, done: true }],
        });
        const [save] = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.GOALS && c.method === 'save');
        const cast = new Goal(save.data);
        expect(cast.validateSync() || null).toBeNull();
        const kept = cast.toObject({ minimize: false });
        expect(dropped(save.data, kept)).toEqual([]);
        expect(save.data.targets).toHaveLength(3);
        save.data.targets.forEach((target, index) => expect([target.kind, dropped(target, kept.targets[index])]).toEqual([target.kind, []]));
        expect(kept.targets.map((target) => target.id)).toEqual(save.data.targets.map((target) => target.id));
        expect(kept.targets[0]).toMatchObject({ current: 10, progressPct: 100, updatedBy: AUTHOR });
        expect(kept.targets[0].reachedAt).toBeInstanceOf(Date);
        expect(kept.targets[0].updatedAt).toEqual(save.data.targets[0].updatedAt);
        expect(kept.targets.every((target) => !('_id' in target))).toBe(true);
    });

    it('is read through a filter the schema casts without dropping a clause', () => {
        const { visibleTo } = require('../Modules/Goals/helpers/goalAccess');
        const filter = { deletedStatusKey: { $in: [0, 2] }, ...visibleTo({ uid: NAMED, isGuest: true }) };
        expect(Goal.find(filter).cast(Goal)).toEqual(filter);
        expect(filter.$or).toHaveLength(3);
    });

    it('drops what a target was not declared to hold', () => {
        const cast = new Goal({ name: 'N', ownerUserId: AUTHOR, visibility: 'private', targets: [{ id: 't', name: 'T', kind: 'boolean', done: true, secret: { taskIds: ['x'] } }], stray: 1 });
        const kept = cast.toObject({ minimize: false });
        expect('stray' in kept).toBe(false);
        expect('secret' in kept.targets[0]).toBe(false);
    });

    it('is only ever changed in fields its schema declares', async () => {
        const goal = await made({ name: 'Q4', visibility: 'workspace', targets: [CUSTOMERS] });
        const id = goal._id;
        await call(goals.updateGoal, AUTHOR, { id, body: { name: 'Q4 plan', description: 'D', periodStart: '2026-10-01', periodEnd: '2026-12-31', color: '', visibility: 'people', sharedWith: [NAMED], ownerUserId: ADMIN } });
        await call(goals.updateGoal, ADMIN, { id, body: { visibility: 'workspace' } });
        await addTarget(id, REVENUE, ADMIN);
        await call(goals.editTarget, ADMIN, { id, targetId: goal.targets[0].id, body: { name: 'Won' } });
        await setValue(id, goal.targets[0].id, { current: 5 }, ADMIN);
        await call(goals.removeTarget, ADMIN, { id, targetId: goal.targets[0].id });
        await call(goals.archiveGoal, ADMIN, { id });
        await call(goals.restoreGoal, ADMIN, { id });
        const writes = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.GOALS && c.method === 'findOneAndUpdate');
        expect(writes).toHaveLength(8);
        const declared = Object.keys(schema.goals);
        const targetFields = Object.keys(schema.goals.targets.type[0]);
        writes.forEach(({ data: [filter, update] }) => {
            expect(Object.keys(update).sort()).toEqual(['$inc', '$set']);
            expect(update.$inc).toEqual({ revision: 1 });
            expect(Object.keys(update.$set).filter((key) => !declared.includes(key))).toEqual([]);
            (update.$set.targets || []).forEach((target) => expect(Object.keys(target).filter((key) => !targetFields.includes(key))).toEqual([]));
            expect(Object.keys(filter).sort()).toEqual(['_id', 'revision']);
            expect(typeof filter.revision).toBe('number');
        });
    });
});

describe('the routes', () => {
    let server;
    let base;
    beforeAll(async () => {
        const express = require('express');
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => { req.uid = req.headers['x-test-uid']; req.aud = C; next(); });
        require('../Modules/Goals/routes').init(app);
        server = await new Promise((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
        base = `http://127.0.0.1:${server.address().port}`;
    });
    afterAll(() => new Promise((resolve) => { server.close(resolve); }));

    const http = async (method, path, body, uid = AUTHOR) => {
        const res = await fetch(`${base}${path}`, {
            method,
            headers: { companyid: C, 'x-test-uid': uid, ...(body ? { 'content-type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { statusCode: res.status, body: await res.json() };
    };

    it('carry a goal from made to archived, naming the goal and the target in the path', async () => {
        const goal = (await http('POST', '/api/v2/goals', { name: 'Q4', visibility: 'workspace', targets: [CUSTOMERS] })).body.data;
        const at = `/api/v2/goals/${goal._id}`;
        const target = `${at}/targets/${goal.targets[0].id}`;
        expect(goal.targets[0].updatedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));

        expect((await http('GET', '/api/v2/goals?mine=true')).body.data.map((row) => row._id)).toEqual([goal._id]);
        expect((await http('GET', '/api/v2/goals?archived=yes')).statusCode).toBe(400);
        expect((await http('GET', at, undefined, NAMED)).body.data).toMatchObject({ name: 'Q4', canEdit: false });
        expect((await http('PATCH', at, { name: 'Q4 plan' })).body.data.name).toBe('Q4 plan');
        expect((await http('PUT', `${target}/value`, { current: 5 }, NAMED)).statusCode).toBe(403);
        expect((await http('PUT', `${target}/value`, { current: 5 }, ADMIN)).body.data.progressPct).toBe(50);
        expect((await http('PATCH', target, { target: 5 })).body.data.progressPct).toBe(100);
        const added = (await http('POST', `${at}/targets`, LAUNCH)).body.data;
        expect(added.targets.map((row) => row.name)).toEqual(['New customers', 'Launched']);
        expect((await http('DELETE', `${at}/targets/${added.targets[1].id}`)).body.data.targets).toHaveLength(1);
        expect((await http('POST', `${at}/archive`)).body.data.archived).toBe(true);
        expect((await http('PATCH', at, { name: 'Late' })).statusCode).toBe(409);
        expect((await http('POST', `${at}/restore`)).body.data.archived).toBe(false);
        expect((await http('GET', '/api/v2/goals')).body.data).toHaveLength(1);
    });
});

describe('the live update', () => {
    const helper = require('../socket/helper');
    const { relay, EVENT } = require('../socket/controller/goalSocket');
    const listened = socketEmitter.on.mock.calls.map(([event]) => event);

    const join = (companyId, socketId, { identity = { companyId, uid: ADMIN }, stillInRoom = true } = {}) => {
        const emit = jest.fn();
        const roomName = `selected_companies_${companyId}**${socketId}`;
        const socket = { id: socketId, rooms: new Set(stillInRoom ? [roomName] : []), identity };
        helper.upsertRoom({ roomName, socketId, socket, namespace: { to: jest.fn(() => ({ emit })) } });
        return emit;
    };

    it('is announced after every write as the fact of a change, with no goal in it', async () => {
        const goal = await made({ name: 'Secret plan', targets: [CUSTOMERS] });
        const id = goal._id;
        await call(goals.updateGoal, AUTHOR, { id, body: { name: 'Secret plan B' } });
        await addTarget(id, LAUNCH);
        await call(goals.editTarget, AUTHOR, { id, targetId: goal.targets[0].id, body: { name: 'Won' } });
        await setValue(id, goal.targets[0].id, { current: 5 });
        await call(goals.removeTarget, AUTHOR, { id, targetId: goal.targets[0].id });
        await call(goals.archiveGoal, AUTHOR, { id });
        await call(goals.restoreGoal, AUTHOR, { id });
        const sent = socketEmitter.emit.mock.calls;
        expect(sent.map(([type]) => type)).toEqual(['insert', 'update', 'update', 'update', 'update', 'update', 'update', 'update']);
        sent.forEach(([type, payload]) => expect(payload).toEqual({ type, companyId: C, module: 'goals' }));
    });

    it('is not announced for a read or a refused request', async () => {
        const { _id: id } = await made();
        socketEmitter.emit.mockClear();
        await call(goals.listGoals, AUTHOR);
        await call(goals.getGoal, AUTHOR, { id });
        await call(goals.updateGoal, AUTHOR, { id, body: { name: '' } });
        await call(goals.updateGoal, NAMED, { id, body: { name: 'Taken' } });
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('reaches the sockets of that company and no other, and carries nothing but the kind of change', async () => {
        const mine = join(C, 's1');
        const theirs = join(OTHER_COMPANY, 's2');
        await relay({ type: 'update', companyId: C, module: 'goals', data: { _id: 'x', name: 'Secret plan', ownerUserId: AUTHOR } });
        expect(mine).toHaveBeenCalledTimes(1);
        expect(mine).toHaveBeenCalledWith(EVENT, { type: 'update' });
        expect(theirs).not.toHaveBeenCalled();
    });

    it('skips a socket in the company\'s room that is not that company\'s, has no identity, or has left', async () => {
        const outsider = join(C, 's3', { identity: { companyId: OTHER_COMPANY, uid: ADMIN } });
        const nameless = join(C, 's4', { identity: null });
        const left = join(C, 's5', { stillInRoom: false });
        await relay({ type: 'insert', companyId: C, module: 'goals' });
        await relay({ type: 'insert', module: 'goals' });
        [outsider, nameless, left].forEach((emit) => expect(emit).not.toHaveBeenCalled());
    });

    it('listens for both kinds of goal write', () => {
        expect(EVENT).toBe('goalsChanged');
        expect(listened).toEqual(expect.arrayContaining(['goals:insert', 'goals:update']));
    });
});
