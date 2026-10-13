const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ADMIN = 'a00000000000000000000002';
const MEMBER = 'a00000000000000000000003';
const GUEST = 'a00000000000000000000004';
const REMOVED = 'a00000000000000000000005';
const INVITED = 'a00000000000000000000006';
const OUTSIDER = 'a00000000000000000000009';
const MEMBER_ROLE = 3;

const routesOf = () => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
    require('../Modules/Teams/routes').init(app);
    return table;
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = res.json;
    res.set = jest.fn(() => res);
    return res;
};

const run = async (handlers, request) => {
    const res = response();
    for (const handler of handlers) {
        let advanced = false;
        await handler(request, res, () => { advanced = true; });
        if (!advanced) break;
    }
    await new Promise((resolve) => setImmediate(resolve));
    return res;
};

const seedRules = (grants = {}) => {
    const parent = mockDb.seed(SCHEMA_TYPE.RULES, { key: 'settings', isParent: true, roles: [{ key: MEMBER_ROLE, permission: true }] });
    Object.entries(grants).forEach(([key, permission]) => {
        mockDb.seed(SCHEMA_TYPE.RULES, { key, isParent: false, parentId: String(parent._id), roles: [{ key: MEMBER_ROLE, permission }] });
    });
};

const add = (uid, body) => run(routesOf()['POST /api/v1/teams/addTeam'], { uid, params: {}, query: {}, body, headers: { companyid: C } });
const update = (uid, body) => run(routesOf()['PUT /api/v1/teams/updateTeam'], { uid, params: {}, query: {}, body, headers: { companyid: C } });
const list = (uid) => run(routesOf()['GET /api/v1/teams'], { uid, params: {}, query: {}, body: {}, headers: { companyid: C } });

const teams = () => mockDb.store[SCHEMA_TYPE.TEAMS_MANAGEMENT] || [];
const stored = (id) => teams().find((team) => String(team._id) === String(id));

const webAppNewTeam = (members = [MEMBER]) => ({
    name: 'Design Crew',
    value: 'DESIGN_CREW',
    teamColor: { color: '#ffffff', bgColor: '#40BC86' },
    assigneeUsersArray: members,
    createdAt: new Date().toISOString(),
});

let team;
beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ADMIN, roleType: 2, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: MEMBER_ROLE, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: REMOVED, roleType: MEMBER_ROLE, status: 2, isDelete: true });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: INVITED, roleType: MEMBER_ROLE, status: 1, isDelete: false });
    team = mockDb.seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, {
        name: 'Core', value: 'CORE', teamColor: { color: '#fff', bgColor: '#1ABC9C' }, assigneeUsersArray: [OWNER, REMOVED],
    });
});

describe('a member without the teams permissions cannot manage teams', () => {
    beforeEach(() => seedRules({ settings_create_team: false, settings_team_list: false }));

    it.each([['a member', MEMBER], ['a guest', GUEST]])('refuses %s creating a team and writes nothing', async (_, uid) => {
        const res = await add(uid, webAppNewTeam([uid]));
        expect(res.statusCode).toBe(403);
        expect(teams()).toHaveLength(1);
    });

    it.each([
        ['$addToSet', { assigneeUsersArray: MEMBER }],
        ['$pull', { assigneeUsersArray: OWNER }],
        ['$set', { name: 'Mine', value: 'MINE' }],
    ])('refuses a member %s on a team and leaves it unchanged', async (key, updateObject) => {
        const res = await update(MEMBER, { id: String(team._id), key, updateObject });
        expect(res.statusCode).toBe(403);
        expect(stored(team._id)).toMatchObject({ name: 'Core', value: 'CORE', assigneeUsersArray: [OWNER, REMOVED] });
    });

    it('keeps the team list readable for the pickers', async () => {
        const res = await list(MEMBER);
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveLength(1);
    });
});

describe('creating a team needs the create team permission, editing needs the team list permission', () => {
    it('lets a member with create team but not team list create, and not edit', async () => {
        seedRules({ settings_create_team: true, settings_team_list: false });
        expect((await add(MEMBER, webAppNewTeam())).statusCode).toBe(200);
        expect((await update(MEMBER, { id: String(team._id), key: '$set', updateObject: { name: 'X', value: 'XXX' } })).statusCode).toBe(403);
    });

    it('lets a member with team list but not create team edit, and not create', async () => {
        seedRules({ settings_create_team: false, settings_team_list: true });
        expect((await add(MEMBER, webAppNewTeam())).statusCode).toBe(403);
        expect((await update(MEMBER, { id: String(team._id), key: '$set', updateObject: { name: 'Renamed', value: 'RENAMED' } })).statusCode).toBe(200);
    });
});

describe.each([['owner', OWNER], ['admin', ADMIN], ['member with both permissions', MEMBER]])('the web app requests still work for an %s', (_, uid) => {
    beforeEach(() => seedRules({ settings_create_team: true, settings_team_list: true }));

    it('creates a team from the add team sidebar body', async () => {
        const res = await add(uid, webAppNewTeam([MEMBER, OWNER]));
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ name: 'Design Crew', value: 'DESIGN_CREW', teamColor: { color: '#ffffff', bgColor: '#40BC86' }, assigneeUsersArray: [MEMBER, OWNER] });
        expect(teams()).toHaveLength(2);
    });

    it('adds a member', async () => {
        const res = await update(uid, { id: String(team._id), key: '$addToSet', updateObject: { assigneeUsersArray: MEMBER } });
        expect(res.statusCode).toBe(200);
        expect(stored(team._id).assigneeUsersArray).toEqual([OWNER, REMOVED, MEMBER]);
    });

    it('removes a member, a removed one included', async () => {
        const res = await update(uid, { id: String(team._id), key: '$pull', updateObject: { assigneeUsersArray: REMOVED } });
        expect(res.statusCode).toBe(200);
        expect(stored(team._id).assigneeUsersArray).toEqual([OWNER]);
    });

    it('changes the colour', async () => {
        const res = await update(uid, { id: String(team._id), key: '$set', updateObject: { teamColor: { bgColor: '#F31D2F', color: '#fff' } } });
        expect(res.statusCode).toBe(200);
        expect(stored(team._id).teamColor).toEqual({ bgColor: '#F31D2F', color: '#fff' });
    });

    it('renames the team', async () => {
        const res = await update(uid, { id: String(team._id), key: '$set', updateObject: { name: 'Core Two', value: 'CORE_TWO', updatedAt: new Date().toISOString() } });
        expect(res.statusCode).toBe(200);
        expect(stored(team._id)).toMatchObject({ name: 'Core Two', value: 'CORE_TWO' });
    });
});

describe('a team write changes only the fields and operators the web app uses', () => {
    beforeEach(() => seedRules({ settings_create_team: true, settings_team_list: true }));

    it.each([
        ['$unset', { assigneeUsersArray: '' }],
        ['$rename', { name: 'companyId' }],
        ['$push', { assigneeUsersArray: MEMBER }],
        ['$addToSet', { assigneeUsersArray: { $each: [MEMBER] } }],
        ['$addToSet', { assigneeUsersArray: [MEMBER] }],
        ['$addToSet', { assigneeUsersArray: MEMBER, name: 'X' }],
        ['$addToSet', { otherField: MEMBER }],
        ['$pull', { assigneeUsersArray: { $in: [OWNER] } }],
        ['$set', { assigneeUsersArray: [MEMBER] }],
        ['$set', { companyId: 'c00000000000000000000002' }],
        ['$set', { name: 'Only name', createdBy: MEMBER }],
        ['$set', { teamColor: { bgColor: '#000', color: '#fff', extra: 'x' } }],
        ['$set', { name: '' }],
        ['$set', { name: { $gt: '' } }],
        ['$set', {}],
        ['name', 'Plain'],
        [undefined, { name: 'X' }],
    ])('refuses key %s with %j and writes nothing', async (key, updateObject) => {
        const before = JSON.stringify(stored(team._id));
        const res = await update(OWNER, { id: String(team._id), key, updateObject });
        expect(res.statusCode).toBe(400);
        expect(JSON.stringify(stored(team._id))).toBe(before);
    });

    it('refuses a team id that is not an id', async () => {
        const res = await update(OWNER, { id: { $ne: null }, key: '$set', updateObject: { name: 'All', value: 'ALL' } });
        expect(res.statusCode).toBe(400);
        expect(stored(team._id).name).toBe('Core');
    });

    it.each([
        ['an unknown field', { ...webAppNewTeam(), companyId: C }],
        ['a missing name', { ...webAppNewTeam(), name: '' }],
        ['members that are not a list', { ...webAppNewTeam(), assigneeUsersArray: { $gt: '' } }],
        ['a colour with extra fields', { ...webAppNewTeam(), teamColor: { color: '#fff', bgColor: '#000', x: 1 } }],
    ])('refuses a new team with %s and writes nothing', async (_, body) => {
        const res = await add(OWNER, body);
        expect(res.statusCode).toBe(400);
        expect(teams()).toHaveLength(1);
    });
});

describe('a team names only active members of the company', () => {
    beforeEach(() => seedRules({ settings_create_team: true, settings_team_list: true }));

    it.each([['an outsider', OUTSIDER], ['a removed member', REMOVED], ['a pending invitee', INVITED], ['a team reference', `tId_${'b'.repeat(24)}`], ['not an id', 'anyone']])(
        'refuses %s in a new team and writes nothing', async (_, id) => {
            const res = await add(OWNER, webAppNewTeam([MEMBER, id]));
            expect(res.statusCode).toBe(400);
            expect(teams()).toHaveLength(1);
        },
    );

    it.each([['an outsider', OUTSIDER], ['a removed member', REMOVED], ['a pending invitee', INVITED]])(
        'refuses adding %s to a team', async (_, id) => {
            const res = await update(OWNER, { id: String(team._id), key: '$addToSet', updateObject: { assigneeUsersArray: id } });
            expect(res.statusCode).toBe(400);
            expect(stored(team._id).assigneeUsersArray).toEqual([OWNER, REMOVED]);
        },
    );
});
