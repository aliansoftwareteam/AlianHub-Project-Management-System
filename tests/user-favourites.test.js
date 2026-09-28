/* Task 042 slice 8: one favourites store on the user. Each entry names the company it belongs to,
   a read returns only what the caller can still open in that company, and the stars of projects,
   sprints and tasks move into it once, without doubling on a second run. */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const mockDbs = {};
const mockDbFor = (scope) => { mockDbs[scope] = mockDbs[scope] || require('./fixtures/fakeMongo').create(); return mockDbs[scope]; };
const mockVisible = {};
const mockRoles = {};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (scope, q, method) => mockDbFor(String(scope)).crud(scope, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions.js', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({
    visibleProjects: async (companyId, uid) => (mockVisible[`${companyId}:${uid}`] || []).map((p) => ({ ...p })),
    visibleProjectIds: async (companyId, uid) => (mockVisible[`${companyId}:${uid}`] || []).map((p) => String(p._id)),
}));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: async (companyId, uid) => (mockRoles[`${companyId}:${uid}`] === undefined ? 3 : mockRoles[`${companyId}:${uid}`]),
    isPrivileged: jest.requireActual('../Config/roleTypes').isPrivileged,
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema.js');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { toSelfView } = require('../Modules/Users/helpers/userAccessRules');
const { FAVOURITE_TYPES, MAX_FAVOURITES, sanitizeFavouriteToggle, sanitizeFavouriteOrder } = require('../Modules/Users/helpers/favouritesRules');
const favourites = require('../Modules/Users/favourites');
const migration = require('../migrations/057-favourites-store');

const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const ME = '64b000000000000000000001';
const OTHER = '64b000000000000000000002';
const P_OPEN = '6f0000000000000000000a01';
const P_SECRET = '6f0000000000000000000a02';
const P_C2 = '6f0000000000000000000a03';
const oid = (id) => new mongoose.Types.ObjectId(id);
const quiet = { info: jest.fn(), error: jest.fn() };

const users = () => mockDbFor(SCHEMA_TYPE.GOLBAL).store[SCHEMA_TYPE.USERS] || [];
const userDoc = (id) => users().find((u) => String(u._id) === id);
const seedUser = (id, extra = {}) => mockDbFor(SCHEMA_TYPE.GOLBAL).seed(SCHEMA_TYPE.USERS, { _id: oid(id), Employee_Name: id, ...extra });
const seed = (companyId, type, doc) => mockDbFor(companyId).seed(type, doc);

const resOf = () => {
    const res = { status: jest.fn(() => res), json: jest.fn(), send: jest.fn() };
    return res;
};
const body = (res) => (res.json.mock.calls[0] || res.send.mock.calls[0])[0];
const req = (extra) => ({ uid: ME, aud: `${C1},${C2}`, headers: { companyid: C1 }, query: {}, body: {}, ...extra });

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    Object.keys(mockVisible).forEach((k) => { delete mockVisible[k]; });
    Object.keys(mockRoles).forEach((k) => { delete mockRoles[k]; });
    jest.clearAllMocks();
});

describe('the favourites store on the user record', () => {
    const Users = mongoose.models.FavouritesUser || mongoose.model('FavouritesUser', new mongoose.Schema(schema.users, { strict: true, timestamps: true }));

    it('keeps every entry with its company, type and id under the strict schema', () => {
        const addedAt = new Date('2026-09-01T00:00:00Z');
        const doc = new Users({ favourites: [{ companyId: C1, type: 'sprint', id: P_OPEN, addedAt }] }).toObject();
        expect(doc.favourites).toEqual([{ companyId: C1, type: 'sprint', id: P_OPEN, addedAt }]);
    });

    it('leaves a user who never starred anything without a value', () => {
        expect(new Users({}).toObject().favourites).toBeUndefined();
    });

    it('stays out of the user record other people and the caller read', () => {
        expect(toSelfView({ _id: ME, favourites: [{ companyId: C1, type: 'task', id: P_OPEN }] })).not.toHaveProperty('favourites');
    });
});

describe('favourite rules', () => {
    it('covers projects, folders, sprints, tasks and docs', () => {
        expect(FAVOURITE_TYPES).toEqual(['project', 'folder', 'sprint', 'task', 'doc']);
    });

    it('accepts a star or an unstar of a known type', () => {
        expect(sanitizeFavouriteToggle({ type: 'task', id: P_OPEN, favourite: true })).toEqual({ ok: true, entry: { type: 'task', id: P_OPEN }, favourite: true });
        expect(sanitizeFavouriteToggle({ type: 'doc', id: P_OPEN, favourite: false })).toEqual({ ok: true, entry: { type: 'doc', id: P_OPEN }, favourite: false });
    });

    it.each([
        ['no body', undefined],
        ['an unknown type', { type: 'board', id: P_OPEN, favourite: true }],
        ['an id that is not an id', { type: 'task', id: 'abc', favourite: true }],
        ['a missing flag', { type: 'task', id: P_OPEN }],
        ['another user', { type: 'task', id: P_OPEN, favourite: true, userId: OTHER }],
        ['another company', { type: 'task', id: P_OPEN, favourite: true, companyId: C2 }],
        ['an operator', { $set: { favourites: [] } }],
    ])('refuses %s', (_name, sent) => {
        expect(sanitizeFavouriteToggle(sent).ok).toBe(false);
    });

    it('accepts an order of distinct keys and refuses anything else', () => {
        expect(sanitizeFavouriteOrder({ keys: [`task:${P_OPEN}`, `project:${P_OPEN}`] })).toEqual({ ok: true, keys: [`task:${P_OPEN}`, `project:${P_OPEN}`] });
        expect(sanitizeFavouriteOrder({ keys: [`task:${P_OPEN}`, `task:${P_OPEN}`] }).ok).toBe(false);
        expect(sanitizeFavouriteOrder({ keys: ['task:nope'] }).ok).toBe(false);
        expect(sanitizeFavouriteOrder({ keys: 'task' }).ok).toBe(false);
        expect(sanitizeFavouriteOrder({ keys: Array.from({ length: MAX_FAVOURITES + 1 }, (_, i) => `task:${String(i).padStart(24, '0')}`) }).ok).toBe(false);
    });
});

describe('the favourites routes', () => {
    it('are registered and need a session with a company', () => {
        const routes = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'Users', 'routes.js'), 'utf8');
        const middleware = fs.readFileSync(path.join(__dirname, '..', 'Config', 'setMiddleware.js'), 'utf8');
        expect(routes).toContain("app.get('/api/v2/users/favourites', favourites.listOwnFavourites)");
        expect(routes).toContain("app.put('/api/v2/users/favourites', favourites.setOwnFavourite)");
        expect(routes).toContain("app.put('/api/v2/users/favourites/order', favourites.reorderOwnFavourites)");
        const withCompany = middleware.slice(0, middleware.indexOf('const verifyJWTToken = ['));
        expect(withCompany).toContain('"/api/v2/users/favourites"');
    });

    it('refuses a caller without a session', async () => {
        const res = resOf();
        await favourites.listOwnFavourites(req({ uid: undefined }), res);
        expect(res.status).toHaveBeenCalledWith(401);
    });
});

describe('each user keeps their own favourites, per company', () => {
    beforeEach(() => {
        seedUser(ME);
        seedUser(OTHER);
        mockVisible[`${C1}:${ME}`] = [{ _id: oid(P_OPEN), ProjectName: 'Open' }];
        mockVisible[`${C1}:${OTHER}`] = [{ _id: oid(P_OPEN), ProjectName: 'Open' }];
        mockVisible[`${C2}:${ME}`] = [{ _id: oid(P_C2), ProjectName: 'Elsewhere' }];
    });

    it('stars into the caller\'s record only, tagged with the header company', async () => {
        const res = resOf();
        await favourites.setOwnFavourite(req({ body: { type: 'project', id: P_OPEN, favourite: true } }), res);
        expect(body(res).status).toBe(true);
        expect(userDoc(ME).favourites).toEqual([expect.objectContaining({ companyId: C1, type: 'project', id: P_OPEN })]);
        expect(userDoc(OTHER).favourites).toBeUndefined();
        expect(body(res).data).toEqual([expect.objectContaining({ type: 'project', id: P_OPEN, name: 'Open' })]);
    });

    it('does not add the same item twice and unstars it again', async () => {
        await favourites.setOwnFavourite(req({ body: { type: 'project', id: P_OPEN, favourite: true } }), resOf());
        await favourites.setOwnFavourite(req({ body: { type: 'project', id: P_OPEN, favourite: true } }), resOf());
        expect(userDoc(ME).favourites).toHaveLength(1);
        await favourites.setOwnFavourite(req({ body: { type: 'project', id: P_OPEN, favourite: false } }), resOf());
        expect(userDoc(ME).favourites).toEqual([]);
    });

    it('lists only the header company\'s entries', async () => {
        await favourites.setOwnFavourite(req({ body: { type: 'project', id: P_OPEN, favourite: true } }), resOf());
        await favourites.setOwnFavourite(req({ headers: { companyid: C2 }, body: { type: 'project', id: P_C2, favourite: true } }), resOf());

        const inC1 = resOf();
        await favourites.listOwnFavourites(req(), inC1);
        expect(body(inC1).data.map((f) => f.id)).toEqual([P_OPEN]);

        const inC2 = resOf();
        await favourites.listOwnFavourites(req({ headers: { companyid: C2 } }), inC2);
        expect(body(inC2).data.map((f) => f.id)).toEqual([P_C2]);
    });

    it('reorders the company\'s entries and keeps the other company\'s', async () => {
        const sprint = seed(C1, SCHEMA_TYPE.SPRINTS, { name: 'Sprint 1', projectId: oid(P_OPEN), deletedStatusKey: 0, private: false });
        await favourites.setOwnFavourite(req({ body: { type: 'project', id: P_OPEN, favourite: true } }), resOf());
        await favourites.setOwnFavourite(req({ body: { type: 'sprint', id: String(sprint._id), favourite: true } }), resOf());
        await favourites.setOwnFavourite(req({ headers: { companyid: C2 }, body: { type: 'project', id: P_C2, favourite: true } }), resOf());

        const res = resOf();
        await favourites.reorderOwnFavourites(req({ body: { keys: [`sprint:${sprint._id}`, `project:${P_OPEN}`] } }), res);
        expect(body(res).data.map((f) => f.type)).toEqual(['sprint', 'project']);
        expect(userDoc(ME).favourites.filter((f) => f.companyId === C2)).toHaveLength(1);
    });
});

describe('a favourite the caller can no longer see is left out, name and all', () => {
    let hiddenSprint;
    let sharedSprint;
    let hiddenTask;

    beforeEach(() => {
        mockVisible[`${C1}:${ME}`] = [{ _id: oid(P_OPEN), ProjectName: 'Open' }];
        const folder = seed(C1, SCHEMA_TYPE.FOLDERS, { name: 'Design', projectId: oid(P_OPEN), deletedStatusKey: 0 });
        const secretFolder = seed(C1, SCHEMA_TYPE.FOLDERS, { name: 'Secret folder', projectId: oid(P_SECRET), deletedStatusKey: 0 });
        sharedSprint = seed(C1, SCHEMA_TYPE.SPRINTS, { name: 'Shared', projectId: oid(P_OPEN), folderId: folder._id, deletedStatusKey: 0, private: true, AssigneeUserId: [ME] });
        hiddenSprint = seed(C1, SCHEMA_TYPE.SPRINTS, { name: 'Board only', projectId: oid(P_OPEN), deletedStatusKey: 0, private: true, AssigneeUserId: [OTHER] });
        const deletedSprint = seed(C1, SCHEMA_TYPE.SPRINTS, { name: 'Gone', projectId: oid(P_OPEN), deletedStatusKey: 1, private: false });
        const task = seed(C1, SCHEMA_TYPE.TASKS, { TaskName: 'Visible task', TaskKey: 'OP-1', ProjectID: oid(P_OPEN), sprintId: sharedSprint._id, folderObjId: folder._id, deletedStatusKey: 0 });
        hiddenTask = seed(C1, SCHEMA_TYPE.TASKS, { TaskName: 'Hidden task', TaskKey: 'OP-2', ProjectID: oid(P_OPEN), sprintId: hiddenSprint._id, deletedStatusKey: 0 });
        const secretTask = seed(C1, SCHEMA_TYPE.TASKS, { TaskName: 'Secret task', TaskKey: 'SE-1', ProjectID: oid(P_SECRET), deletedStatusKey: 0 });
        const doc = seed(C1, SCHEMA_TYPE.PAGES, { title: 'Handbook', ProjectID: oid(P_OPEN), deletedStatusKey: 0, visibility: 'project', createdBy: OTHER });
        const privateDoc = seed(C1, SCHEMA_TYPE.PAGES, { title: 'Diary', ProjectID: oid(P_OPEN), deletedStatusKey: 0, visibility: 'private', createdBy: OTHER });
        const entries = [
            ['project', P_OPEN], ['project', P_SECRET], ['folder', folder._id], ['folder', secretFolder._id],
            ['sprint', sharedSprint._id], ['sprint', hiddenSprint._id], ['sprint', deletedSprint._id],
            ['task', task._id], ['task', hiddenTask._id], ['task', secretTask._id],
            ['doc', doc._id], ['doc', privateDoc._id],
        ].map(([type, id]) => ({ companyId: C1, type, id: String(id), addedAt: new Date() }));
        seedUser(ME, { favourites: entries });
    });

    it('returns only what a member can open, in the stored order', async () => {
        const res = resOf();
        await favourites.listOwnFavourites(req(), res);
        const data = body(res).data;
        expect(data.map((f) => `${f.type}:${f.name}`)).toEqual(['project:Open', 'folder:Design', 'sprint:Shared', 'task:Visible task', 'doc:Handbook']);
        const text = JSON.stringify(data);
        ['Secret', 'Board only', 'Gone', 'Hidden task', 'Diary'].forEach((name) => expect(text).not.toContain(name));
    });

    it('gives each item what its link needs', async () => {
        const res = resOf();
        await favourites.listOwnFavourites(req(), res);
        const task = body(res).data.find((f) => f.type === 'task');
        expect(task).toEqual(expect.objectContaining({ projectId: P_OPEN, sprintId: String(sharedSprint._id), key: 'OP-1' }));
        expect(task.folderId).toBeTruthy();
    });

    it('lets an admin see past sprint privacy but not into projects they cannot open', async () => {
        mockRoles[`${C1}:${ME}`] = 2;
        const res = resOf();
        await favourites.listOwnFavourites(req(), res);
        const names = body(res).data.map((f) => f.name);
        expect(names).toEqual(expect.arrayContaining(['Board only', 'Hidden task']));
        expect(names).not.toContain('Secret task');
    });

    it('keeps the hidden entries stored, so they come back if access does', async () => {
        await favourites.reorderOwnFavourites(req({ body: { keys: [`doc:${userDoc(ME).favourites[10].id}`] } }), resOf());
        expect(userDoc(ME).favourites).toHaveLength(12);
        expect(userDoc(ME).favourites.some((f) => f.id === String(hiddenTask._id))).toBe(true);
    });
});

describe('057-favourites-store', () => {
    const ID = '057-favourites-store';
    const contextFor = (companies) => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger: quiet, listCompanies: async () => companies.map((_id) => ({ _id })) });

    const seedLegacy = () => {
        seedUser(ME);
        seedUser(OTHER);
        const project = seed(C1, SCHEMA_TYPE.PROJECTS, { ProjectName: 'Open', favouriteTasks: [{ userId: ME }], deletedStatusKey: 0 });
        const sprint = seed(C1, SCHEMA_TYPE.SPRINTS, { name: 'Sprint 1', projectId: project._id, favouriteTasks: [{ userId: OTHER }, { userId: ME }], deletedStatusKey: 0 });
        const task = seed(C1, SCHEMA_TYPE.TASKS, { TaskName: 'Task', ProjectID: project._id, favouriteTasks: [ME], deletedStatusKey: 0 });
        seed(C1, SCHEMA_TYPE.TASKS, { TaskName: 'Deleted', ProjectID: project._id, favouriteTasks: [ME], deletedStatusKey: 1 });
        seed(C1, SCHEMA_TYPE.TASKS, { TaskName: 'Nobody', ProjectID: project._id, favouriteTasks: ['not-a-user'], deletedStatusKey: 0 });
        const other = seed(C2, SCHEMA_TYPE.PROJECTS, { ProjectName: 'Elsewhere', favouriteTasks: [{ userId: ME }], deletedStatusKey: 0 });
        return { project, sprint, task, other };
    };
    const keysOf = (uid) => (userDoc(uid).favourites || []).map((f) => `${f.companyId}:${f.type}:${f.id}`).sort();

    it('is a valid company-scoped migration after 055', () => {
        expect(() => validateMigration(migration, ID)).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf('055-agent-session-project-ids'));
    });

    it('moves every project, sprint and task star into the user\'s store, tagged with its own company', async () => {
        const { project, sprint, task, other } = seedLegacy();
        const ctx = contextFor([C1, C2]);
        await migration.up(ctx);

        expect(keysOf(ME)).toEqual([
            `${C1}:project:${project._id}`, `${C1}:sprint:${sprint._id}`, `${C1}:task:${task._id}`, `${C2}:project:${other._id}`,
        ].sort());
        expect(keysOf(OTHER)).toEqual([`${C1}:sprint:${sprint._id}`]);
        expect(ctx.companies[C1]).toEqual(expect.objectContaining({ ok: true, added: 4 }));
    });

    it('adds nothing on a second run', async () => {
        seedLegacy();
        await migration.up(contextFor([C1, C2]));
        const first = keysOf(ME);
        const ctx = contextFor([C1, C2]);
        await migration.up(ctx);
        expect(keysOf(ME)).toEqual(first);
        expect(ctx.companies[C1]).toEqual(expect.objectContaining({ ok: true, added: 0 }));
    });

    it('reads each company only through its own scope', async () => {
        seedLegacy();
        await migration.up(contextFor([C1, C2]));
        const reads = [C1, C2].flatMap((c) => mockDbFor(c).calls.map((call) => call.companyId));
        expect(new Set(reads.map(String))).toEqual(new Set([C1, C2]));
        const userWrites = mockDbFor(SCHEMA_TYPE.GOLBAL).calls.filter((call) => call.method === 'bulkWrite');
        userWrites.flatMap((call) => call.data[0]).forEach((op) => {
            expect(op.updateOne.update.$push.favourites.companyId).toBe(JSON.stringify(op.updateOne.filter).includes(C1) ? C1 : C2);
        });
    });

    it('reports nothing left to move once it has run', async () => {
        seedLegacy();
        const ctx = contextFor([C1, C2]);
        await migration.up(ctx);
        expect(await migration.verify(contextFor([C1, C2]))).toEqual([]);
    });
});
