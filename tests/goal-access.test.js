/* Task 046 M3: who may read and change a goal. The route handlers run over fakeMongo. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const goals = require('../Modules/Goals/controller');
const { recordAuditFromReq } = require('../Modules/Audit/recorder');
const { holdNarrowedToken } = require('../Config/narrowedTokenRoutes');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const AUTHOR = '6f0000000000000000000003';
const NAMED = '6f0000000000000000000004';
const COLLEAGUE = '6f0000000000000000000005';
const GUEST = '6f0000000000000000000006';
const NAMED_GUEST = '6f0000000000000000000007';
const DEACTIVATED = '6f0000000000000000000008';
const INVITED = '6f0000000000000000000009';
const STRANGER = '6f000000000000000000000a';
const ROLES = { [OWNER]: 1, [ADMIN]: 2, [AUTHOR]: 3, [NAMED]: 3, [COLLEAGUE]: 3, [GUEST]: 0, [NAMED_GUEST]: 0 };
const MISSING = '6f00000000000000000000ff';
const TARGET = 'target-1';
const PROJECT = '6f0000000000000000000a01';

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};
const call = async (handler, uid, { body, id, targetId, query, headers, apiToken } = {}) => {
    const res = response();
    await handler({ headers: headers || { companyid: C }, aud: C, uid, body, query: query || {}, params: { id, targetId }, apiToken }, res);
    return res;
};

const stored = () => mockDb.store[SCHEMA_TYPE.GOALS] || [];
const seedGoal = (fields = {}) => String(mockDb.seed(SCHEMA_TYPE.GOALS, {
    name: 'Grow revenue',
    description: '',
    ownerUserId: AUTHOR,
    periodStart: '2026-10-01',
    periodEnd: '2026-12-31',
    visibility: 'private',
    sharedWith: [],
    color: '',
    progressPct: 30,
    targets: [{ id: TARGET, name: 'New customers', kind: 'number', weight: 1, start: 0, target: 10, current: 3, unit: '', progressPct: 30, reachedAt: null }],
    revision: 0,
    createdBy: AUTHOR,
    deletedStatusKey: 0,
    ...fields,
})._id);
const snapshot = () => JSON.stringify(stored());

const listed = async (uid, query) => (await call(goals.listGoals, uid, { query })).body.data.map((goal) => goal._id);
const read = (uid, id) => call(goals.getGoal, uid, { id });

/* Every write a goal has, each with a body its handler would accept. */
const WRITES = [
    ['renaming it', (uid, id, options) => call(goals.updateGoal, uid, { ...options, id, body: { name: 'Taken' } })],
    ['sharing it wider', (uid, id, options) => call(goals.updateGoal, uid, { ...options, id, body: { visibility: 'workspace' } })],
    ['taking it over', (uid, id, options) => call(goals.updateGoal, uid, { ...options, id, body: { ownerUserId: uid } })],
    ['archiving it', (uid, id, options) => call(goals.archiveGoal, uid, { ...options, id })],
    ['restoring it', (uid, id, options) => call(goals.restoreGoal, uid, { ...options, id })],
    ['adding a target', (uid, id, options) => call(goals.addTarget, uid, { ...options, id, body: { name: 'Added', kind: 'boolean' } })],
    ['changing a target', (uid, id, options) => call(goals.editTarget, uid, { ...options, id, targetId: TARGET, body: { name: 'Changed' } })],
    ['removing a target', (uid, id, options) => call(goals.removeTarget, uid, { ...options, id, targetId: TARGET })],
    ['setting a target\'s value', (uid, id, options) => call(goals.setTargetValue, uid, { ...options, id, targetId: TARGET, body: { current: 9 } })],
];
const READS = [
    ['reading it', (uid, id, options) => call(goals.getGoal, uid, { ...options, id })],
];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    Object.entries(ROLES).forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: DEACTIVATED, roleType: 3, status: 2, isDelete: true });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: INVITED, roleType: 3, status: 1, isDelete: false });
});

describe('who reads a goal', () => {
    const READERS = [
        ['its owner', AUTHOR], ['the workspace owner', OWNER], ['an admin', ADMIN], ['a named member', NAMED],
        ['a member who is not named', COLLEAGUE], ['a guest', GUEST], ['a named guest', NAMED_GUEST],
    ];
    const CASES = [
        ['private', { visibility: 'private' }, [AUTHOR]],
        ['people', { visibility: 'people', sharedWith: [NAMED, NAMED_GUEST] }, [AUTHOR, NAMED, NAMED_GUEST]],
        ['workspace', { visibility: 'workspace', sharedWith: [NAMED_GUEST] }, [AUTHOR, OWNER, ADMIN, NAMED, COLLEAGUE, NAMED_GUEST]],
    ];

    describe.each(CASES)('a %s goal', (_kind, fields, readers) => {
        it.each(READERS)('is listed and opened for %s only when the goal is theirs to read', async (_who, uid) => {
            const id = seedGoal(fields);
            const reads = readers.includes(uid);
            expect(await listed(uid)).toEqual(reads ? [id] : []);
            const opened = await read(uid, id);
            expect(opened.statusCode).toBe(reads ? 200 : 404);
            if (reads) expect(opened.body.data).toMatchObject({ _id: id, name: 'Grow revenue', progressPct: 30 });
        });
    });

    it('leaves a private goal out for the workspace owner and an admin, whatever else they can read', async () => {
        const theirs = seedGoal({ visibility: 'private' });
        const shared = seedGoal({ visibility: 'workspace', name: 'Ship the app' });
        const own = seedGoal({ visibility: 'private', ownerUserId: ADMIN, name: 'Hire two' });
        expect(await listed(OWNER)).toEqual([shared]);
        expect((await listed(ADMIN)).sort()).toEqual([own, shared].sort());
        expect(await listed(AUTHOR)).toEqual([theirs, shared]);
    });

    it('reads a goal with a visibility it does not know as its owner\'s alone', async () => {
        const id = seedGoal({ visibility: 'everyone', sharedWith: [NAMED] });
        expect(await listed(OWNER)).toEqual([]);
        expect(await listed(NAMED)).toEqual([]);
        expect(await listed(AUTHOR)).toEqual([id]);
    });

    it('keeps archived goals apart, under the same rule', async () => {
        const hidden = seedGoal({ visibility: 'private', deletedStatusKey: 2 });
        const shared = seedGoal({ visibility: 'workspace', deletedStatusKey: 2, name: 'Old' });
        seedGoal({ visibility: 'workspace', deletedStatusKey: 1, name: 'Gone' });
        const live = seedGoal({ visibility: 'workspace', name: 'Now' });
        expect(await listed(ADMIN)).toEqual([live]);
        expect(await listed(ADMIN, { archived: 'true' })).toEqual([shared]);
        expect((await listed(AUTHOR, { archived: 'true' })).sort()).toEqual([hidden, shared].sort());
        expect((await read(ADMIN, hidden)).statusCode).toBe(404);
        expect((await read(ADMIN, shared)).body.data.archived).toBe(true);
    });

    it('narrows the list to the goals a person owns or is named on when asked', async () => {
        const own = seedGoal({ visibility: 'workspace', ownerUserId: NAMED, name: 'A' });
        const named = seedGoal({ visibility: 'people', sharedWith: [NAMED], name: 'B' });
        seedGoal({ visibility: 'workspace', name: 'C' });
        seedGoal({ visibility: 'private', name: 'D' });
        expect(await listed(NAMED, { mine: 'true' })).toEqual([own, named]);
        expect(await listed(NAMED)).toHaveLength(3);
    });

    it('tells a reader whether they are named, and lists the named people only for those who manage them', async () => {
        const id = seedGoal({ visibility: 'workspace', sharedWith: [NAMED_GUEST] });
        expect((await read(AUTHOR, id)).body.data).toMatchObject({ sharedWith: [NAMED_GUEST], isOwner: true, sharedWithMe: false, canEdit: true });
        expect((await read(ADMIN, id)).body.data).toMatchObject({ sharedWith: [NAMED_GUEST], isOwner: false, canEdit: true });
        expect((await read(COLLEAGUE, id)).body.data).toMatchObject({ sharedWith: [], sharedWithMe: false, canEdit: false, canSetValue: false });
        expect((await read(NAMED_GUEST, id)).body.data).toMatchObject({ sharedWith: [], sharedWithMe: true, canEdit: false });
    });
});

describe('a goal that is not the caller\'s to read', () => {
    const HIDDEN = [
        ['a private goal, for the workspace owner', { visibility: 'private' }, OWNER],
        ['a private goal, for an admin', { visibility: 'private' }, ADMIN],
        ['a private goal, for a member', { visibility: 'private' }, COLLEAGUE],
        ['a goal shared with people, for an admin who is not named', { visibility: 'people', sharedWith: [NAMED] }, ADMIN],
        ['a goal shared with people, for a member who is not named', { visibility: 'people', sharedWith: [NAMED] }, COLLEAGUE],
        ['a workspace goal, for a guest', { visibility: 'workspace' }, GUEST],
        ['an archived private goal, for an admin', { visibility: 'private', deletedStatusKey: 2 }, ADMIN],
    ];

    describe.each(HIDDEN)('%s', (_case, fields, uid) => {
        it.each([...READS, ...WRITES])('answers %s as it answers a goal that does not exist, and changes nothing', async (_what, attempt) => {
            const id = seedGoal(fields);
            const before = snapshot();
            const hidden = await attempt(uid, id);
            const missing = await attempt(uid, MISSING);
            expect(hidden.statusCode).toBe(404);
            expect(hidden.body).toEqual({ status: false, statusText: 'Goal not found.', message: 'Goal not found.' });
            expect(hidden.body).toEqual(missing.body);
            expect(snapshot()).toBe(before);
        });
    });

    it('answers the same for an id that is not an id', async () => {
        expect((await read(AUTHOR, 'not-an-id')).statusCode).toBe(404);
        expect((await call(goals.updateGoal, AUTHOR, { id: 'not-an-id', body: { name: 'N' } })).statusCode).toBe(404);
    });

    it('answers a hidden goal before it reads the request, so a bad body tells nothing either', async () => {
        const id = seedGoal({ visibility: 'private' });
        const hidden = await call(goals.editTarget, ADMIN, { id, targetId: TARGET, body: { current: 'x', unknown: true } });
        expect(hidden.statusCode).toBe(404);
        const noTarget = await call(goals.setTargetValue, ADMIN, { id, targetId: 'no-such-target', body: { current: 1 } });
        expect(noTarget.body.statusText).toBe('Goal not found.');
    });

    it('tells nobody else and leaves no audit row', async () => {
        const id = seedGoal({ visibility: 'private' });
        for (const [, attempt] of WRITES) await attempt(ADMIN, id);
        expect(require('../event/socketEventEmitter').emit).not.toHaveBeenCalled();
        expect(recordAuditFromReq).not.toHaveBeenCalled();
    });
});

describe('who changes a goal', () => {
    const allowed = async (attempt, uid, fields) => {
        const id = seedGoal(fields);
        const before = snapshot();
        const res = await attempt(uid, id);
        return { statusCode: res.statusCode, changed: snapshot() !== before };
    };
    /* Restoring a live goal and renaming alike leave a mark: every accepted write moves the revision on. */
    const DONE = { statusCode: 200, changed: true };
    const REFUSED = { statusCode: 403, changed: false };

    describe.each(WRITES)('%s', (_what, attempt) => {
        it('is for the owner of a private goal', async () => {
            expect(await allowed(attempt, AUTHOR, { visibility: 'private' })).toEqual(DONE);
        });

        it.each([['a named member', NAMED], ['a named guest', NAMED_GUEST]])('is refused to %s on a goal shared with people, who may only read it', async (_who, uid) => {
            expect(await allowed(attempt, uid, { visibility: 'people', sharedWith: [NAMED, NAMED_GUEST, ADMIN] })).toEqual(REFUSED);
        });

        it('is refused to an admin named on a goal shared with people', async () => {
            expect(await allowed(attempt, ADMIN, { visibility: 'people', sharedWith: [ADMIN] })).toEqual(REFUSED);
        });

        it.each([['its owner', AUTHOR], ['the workspace owner', OWNER], ['an admin', ADMIN]])('is for %s on a workspace goal', async (_who, uid) => {
            expect(await allowed(attempt, uid, { visibility: 'workspace' })).toEqual(DONE);
        });

        it.each([['a member', COLLEAGUE], ['a named guest', NAMED_GUEST]])('is refused to %s on a workspace goal', async (_who, uid) => {
            expect(await allowed(attempt, uid, { visibility: 'workspace', sharedWith: [NAMED_GUEST] })).toEqual(REFUSED);
        });
    });

    it('lets only the owner share a private goal wider', async () => {
        const id = seedGoal({ visibility: 'private' });
        for (const uid of [OWNER, ADMIN, COLLEAGUE]) {
            expect((await call(goals.updateGoal, uid, { id, body: { visibility: 'workspace' } })).statusCode).toBe(404);
        }
        expect(stored()[0].visibility).toBe('private');
        expect((await call(goals.updateGoal, AUTHOR, { id, body: { visibility: 'workspace' } })).statusCode).toBe(200);
        expect(stored()[0].visibility).toBe('workspace');
    });

    it('answers a change that takes the goal out of the caller\'s reach with no goal, and it is then gone for them', async () => {
        const id = seedGoal({ visibility: 'workspace', sharedWith: [NAMED_GUEST] });
        const narrowed = await call(goals.updateGoal, ADMIN, { id, body: { visibility: 'private' } });
        expect(narrowed.body).toEqual({ status: true, statusText: 'Goal saved.', data: null });
        expect(stored()[0]).toMatchObject({ visibility: 'private', sharedWith: [] });
        expect((await read(ADMIN, id)).statusCode).toBe(404);
        expect((await read(NAMED_GUEST, id)).statusCode).toBe(404);
        expect((await read(AUTHOR, id)).statusCode).toBe(200);
    });

    it('hands a private goal to another member whole: the one who gave it away no longer reads it', async () => {
        const id = seedGoal({ visibility: 'private' });
        const given = await call(goals.updateGoal, AUTHOR, { id, body: { ownerUserId: COLLEAGUE } });
        expect(given.body).toEqual({ status: true, statusText: 'Goal saved.', data: null });
        expect((await read(AUTHOR, id)).statusCode).toBe(404);
        expect((await read(COLLEAGUE, id)).body.data).toMatchObject({ ownerUserId: COLLEAGUE, isOwner: true });
    });

    it('refuses every change but restoring to an archived goal', async () => {
        const id = seedGoal({ visibility: 'workspace', deletedStatusKey: 2 });
        for (const [what, attempt] of WRITES.filter(([name]) => !['archiving it', 'restoring it'].includes(name))) {
            const res = await attempt(AUTHOR, id);
            expect([what, res.statusCode]).toEqual([what, 409]);
        }
        expect(stored()[0]).toMatchObject({ name: 'Grow revenue', deletedStatusKey: 2, revision: 0 });
        expect((await call(goals.restoreGoal, AUTHOR, { id })).body.data.archived).toBe(false);
    });
});

describe('who makes a goal', () => {
    const create = (uid, body = { name: 'Grow revenue' }) => call(goals.createGoal, uid, { body });

    it.each([['the workspace owner', OWNER], ['an admin', ADMIN], ['a member', COLLEAGUE]])('%s may, and owns it, and it starts private', async (_who, uid) => {
        const res = await create(uid);
        expect(res.statusCode).toBe(200);
        expect(res.body.data).toMatchObject({ ownerUserId: uid, createdBy: uid, visibility: 'private', sharedWith: [], isOwner: true });
        expect(stored()[0]).toMatchObject({ ownerUserId: uid, visibility: 'private', deletedStatusKey: 0 });
    });

    it('a guest may not, whatever the request holds', async () => {
        for (const uid of [GUEST, NAMED_GUEST]) {
            expect((await create(uid)).statusCode).toBe(403);
            expect((await create(uid, { nonsense: true })).statusCode).toBe(403);
        }
        expect(stored()).toEqual([]);
    });

    it('cannot be made in someone else\'s name', async () => {
        const res = await create(COLLEAGUE, { name: 'For you', ownerUserId: AUTHOR });
        expect(res.statusCode).toBe(400);
        expect(res.body.field).toBe('ownerUserId');
        expect(stored()).toEqual([]);
    });
});

describe('who can be named on a goal', () => {
    const share = (sharedWith, visibility = 'people') => call(goals.createGoal, AUTHOR, { body: { name: 'Shared', visibility, sharedWith } });

    it('takes active members and active guests', async () => {
        const res = await share([NAMED, NAMED_GUEST, NAMED]);
        expect(res.statusCode).toBe(200);
        expect(stored()[0].sharedWith).toEqual([NAMED, NAMED_GUEST]);
    });

    it.each([
        ['a deactivated seat', DEACTIVATED], ['an invitation that was not accepted', INVITED], ['someone with no seat', STRANGER],
    ])('refuses %s in the list of people', async (_who, uid) => {
        const res = await share([NAMED, uid]);
        expect(res.statusCode).toBe(400);
        expect(res.body.field).toBe('sharedWith');
        expect(stored()).toEqual([]);

        const id = seedGoal({ visibility: 'people', sharedWith: [NAMED] });
        const changed = await call(goals.updateGoal, AUTHOR, { id, body: { sharedWith: [uid] } });
        expect(changed.statusCode).toBe(400);
        expect(stored()[0].sharedWith).toEqual([NAMED]);
    });

    it.each([
        ['a deactivated seat', DEACTIVATED], ['an invitation that was not accepted', INVITED], ['someone with no seat', STRANGER], ['a guest', GUEST],
    ])('refuses %s as the new owner', async (_who, uid) => {
        const id = seedGoal({ visibility: 'workspace' });
        for (const by of [AUTHOR, ADMIN]) {
            const res = await call(goals.updateGoal, by, { id, body: { ownerUserId: uid } });
            expect(res.statusCode).toBe(400);
            expect(res.body.field).toBe('ownerUserId');
        }
        expect(stored()[0].ownerUserId).toBe(AUTHOR);
    });

    it('names nobody on a private goal', async () => {
        expect((await share([NAMED], 'private')).body.field).toBe('sharedWith');
        const id = seedGoal({ visibility: 'people', sharedWith: [NAMED] });
        const refused = await call(goals.updateGoal, AUTHOR, { id, body: { visibility: 'private', sharedWith: [NAMED] } });
        expect(refused.body.field).toBe('sharedWith');
        const closed = await call(goals.updateGoal, AUTHOR, { id, body: { visibility: 'private' } });
        expect(closed.body.data).toMatchObject({ visibility: 'private', sharedWith: [] });
        expect((await read(NAMED, id)).statusCode).toBe(404);
        const reopened = await call(goals.updateGoal, AUTHOR, { id, body: { visibility: 'people' } });
        expect(reopened.body.data.sharedWith).toEqual([]);
        expect((await read(NAMED, id)).statusCode).toBe(404);
    });
});

describe('the caller', () => {
    let id;
    beforeEach(() => {
        id = seedGoal({ visibility: 'workspace', sharedWith: [DEACTIVATED], ownerUserId: DEACTIVATED });
        mockDb.calls.length = 0;
    });
    const EVERY_ROUTE = [
        ['listing', (uid, options) => call(goals.listGoals, uid, options)],
        ['making one', (uid, options) => call(goals.createGoal, uid, { ...options, body: { name: 'N' } })],
        ...[...READS, ...WRITES].map(([what, attempt]) => [what, (uid, options) => attempt(uid, id, options)]),
    ];
    const goalCalls = () => mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.GOALS);

    it.each([
        ['a deactivated seat, on a goal it owned', DEACTIVATED, 403], ['an invitation that was not accepted', INVITED, 403],
        ['someone with no seat', STRANGER, 403], ['nobody', undefined, 401],
    ])('is refused as %s before any goal is read', async (_who, uid, statusCode) => {
        const before = snapshot();
        for (const [what, attempt] of EVERY_ROUTE) {
            expect([what, (await attempt(uid)).statusCode]).toEqual([what, statusCode]);
        }
        expect(goalCalls()).toEqual([]);
        expect(snapshot()).toBe(before);
    });

    it('is refused in a company outside the token audience, before anything is read', async () => {
        for (const [what, handler] of [['listing', goals.listGoals], ['reading', goals.getGoal], ['renaming', goals.updateGoal]]) {
            const res = await call(handler, ADMIN, { id, headers: { companyid: OTHER_COMPANY }, body: { name: 'N' } });
            expect([what, res.statusCode]).toEqual([what, 403]);
        }
        expect(mockDb.calls).toEqual([]);
    });

    it('is refused when the request names a second company', async () => {
        const res = await call(goals.updateGoal, ADMIN, { id, body: { name: 'N', companyId: OTHER_COMPANY } });
        expect(res.statusCode).toBe(403);
        expect(mockDb.calls).toEqual([]);
    });

    it('reads and writes inside the one company the request names', async () => {
        await call(goals.listGoals, ADMIN);
        await call(goals.createGoal, ADMIN, { body: { name: 'Mine', visibility: 'people', sharedWith: [NAMED] } });
        await call(goals.updateGoal, ADMIN, { id, body: { ownerUserId: ADMIN } });
        await call(goals.setTargetValue, ADMIN, { id, targetId: TARGET, body: { current: 4 } });
        expect(mockDb.calls.length).toBeGreaterThan(8);
        mockDb.calls.forEach((c) => expect([c.type, c.method, c.companyId]).toEqual([c.type, c.method, C]));
    });

    it('is refused with a token limited to some projects, on every route, before any goal is read', async () => {
        const apiToken = { userId: ADMIN, projectIds: [PROJECT] };
        for (const [what, attempt] of EVERY_ROUTE) {
            expect([what, (await attempt(ADMIN, { apiToken })).statusCode]).toEqual([what, 403]);
        }
        expect(mockDb.calls).toEqual([]);
        expect((await call(goals.listGoals, ADMIN, { apiToken: { userId: ADMIN, projectIds: [] } })).statusCode).toBe(200);
    });

    it('is not a route the guard lets a token limited to some projects reach', async () => {
        const paths = [
            ['GET', '/api/v2/goals'], ['POST', '/api/v2/goals'], ['GET', `/api/v2/goals/${id}`], ['PATCH', `/api/v2/goals/${id}`],
            ['POST', `/api/v2/goals/${id}/archive`], ['POST', `/api/v2/goals/${id}/restore`], ['POST', `/api/v2/goals/${id}/targets`],
            ['PATCH', `/api/v2/goals/${id}/targets/${TARGET}`], ['DELETE', `/api/v2/goals/${id}/targets/${TARGET}`], ['PUT', `/api/v2/goals/${id}/targets/${TARGET}/value`],
        ];
        for (const [method, path] of paths) {
            const res = response();
            const next = jest.fn();
            await holdNarrowedToken({ method, originalUrl: path, headers: { companyid: C }, apiToken: { userId: ADMIN, projectIds: [PROJECT] } }, res, next);
            expect({ method, path, reached: next.mock.calls.length, statusCode: res.statusCode }).toEqual({ method, path, reached: 0, statusCode: 403 });
        }
    });
});

describe('what the audit log keeps', () => {
    const audited = () => recordAuditFromReq.mock.calls.map(([, entry]) => entry);

    it('names a goal the whole workspace reads, and the fields changed, not their values', async () => {
        const id = seedGoal({ visibility: 'workspace' });
        await call(goals.updateGoal, ADMIN, { id, body: { name: 'Grow revenue by half', description: 'Net new only' } });
        await call(goals.archiveGoal, ADMIN, { id });
        await call(goals.restoreGoal, ADMIN, { id });
        expect(audited()).toEqual([
            { action: 'goal.update', entityType: 'goal', entityId: id, entityName: 'Grow revenue', meta: { fields: ['name', 'description'] } },
            { action: 'goal.archive', entityType: 'goal', entityId: id, entityName: 'Grow revenue by half', meta: {} },
            { action: 'goal.restore', entityType: 'goal', entityId: id, entityName: 'Grow revenue by half', meta: {} },
        ]);
        expect(JSON.stringify(audited())).not.toContain('Net new only');
    });

    it('keeps nothing of a goal that is private or shared with people', async () => {
        await call(goals.createGoal, AUTHOR, { body: { name: 'Quiet' } });
        const id = seedGoal({ visibility: 'people', sharedWith: [NAMED] });
        await call(goals.updateGoal, AUTHOR, { id, body: { name: 'Quieter' } });
        await call(goals.archiveGoal, AUTHOR, { id });
        expect(audited()).toEqual([]);
    });

    it('records the move into and out of the workspace\'s view under the name the workspace could read', async () => {
        const id = seedGoal({ visibility: 'private', name: 'Draft' });
        await call(goals.updateGoal, AUTHOR, { id, body: { visibility: 'workspace', name: 'Announced' } });
        await call(goals.updateGoal, AUTHOR, { id, body: { visibility: 'private', name: 'Withdrawn' } });
        expect(audited().map((entry) => [entry.action, entry.entityName, entry.meta.fields])).toEqual([
            ['goal.update', 'Announced', ['visibility', 'name']],
            ['goal.update', 'Announced', ['visibility', 'name']],
        ]);
    });
});
