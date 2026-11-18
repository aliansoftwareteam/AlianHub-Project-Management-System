const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0, keys: () => [] } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn() }));
jest.mock('../Modules/MainChats/controller', () => ({ updateMainChat: jest.fn() }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({
    updateCompanyFun: (type, query, method) => require('../utils/mongo-handler/mongoQueries').MongoDbCrudOpration(type, query, method),
}));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { importCompanyRules } = require('../utils/data');
const { SENTINEL_KEYS } = require('../Modules/settings/securityPermissions/reconcileRules');
const seats = require('../Modules/DesktopTracker/trackerSeats');
const migration = require('../migrations/083-desktop-tracker-by-role');

const C = '6f0000000000000000000c01';
const PEOPLE = {
    owner: '6f0000000000000000000a01',
    guest: '6f0000000000000000000a00',
    member: '6f0000000000000000000a03',
    second: '6f0000000000000000000a05',
    third: '6f0000000000000000000a06',
    lead: '6f0000000000000000000a04',
};
const ROLE_OF = { owner: 1, guest: 0, member: 3, second: 3, third: 3, lead: 4 };
const OUTSIDER = '6f0000000000000000000a99';

const db = (companyId = C) => mockDbFor(companyId);
const rules = (companyId = C) => db(companyId).store[SCHEMA_TYPE.RULES] || [];
const ruleFor = (key, companyId = C) => rules(companyId).find((r) => r.key === key && r.projectId === undefined);
const entryOf = (key, roleKey, companyId = C) => ((ruleFor(key, companyId) || {}).roles || []).find((r) => r.key === roleKey);
const seatOf = (person) => (db().store[SCHEMA_TYPE.COMPANY_USERS] || []).find((row) => row.userId === PEOPLE[person]);
const company = () => (db('global').store[SCHEMA_TYPE.COMPANIES] || []).find((row) => String(row._id) === C);
const access = (person, options) => seats.trackerAccessFor(C, PEOPLE[person] || person, options);
const contextFor = (companies) => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger: { info: jest.fn(), error: jest.fn() }, listCompanies: async () => companies.map((_id) => ({ _id })) });

const seedCompany = ({ planFeature = {} } = {}) => {
    db().seed(SCHEMA_TYPE.SETTINGS, { name: settingsCollectionDocs.ROLES, settings: [{ key: 0, name: 'Guest' }, { key: 1, name: 'Owner' }, { key: 2, name: 'Admin' }, { key: 3, name: 'Member' }, { key: 4, name: 'Team lead' }] });
    Object.entries(PEOPLE).forEach(([person, userId]) => db().seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: ROLE_OF[person], status: 2, isDelete: false }));
    db('global').seed(SCHEMA_TYPE.COMPANIES, { _id: C, planFeature, trackerUsers: 0 });
};

const setRole = (key, roleKey, permission) => {
    const rule = ruleFor(key);
    rule.roles = [...rule.roles.filter((r) => r.key !== roleKey), { key: roleKey, permission }];
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    delete process.env.HOSTING_MODE;
    jest.clearAllMocks();
});

describe('the Desktop time tracker row of Security & Permissions', () => {
    test('a new company gets a Time tracking section with one switch, and the repair watches both', async () => {
        seedCompany();
        await importCompanyRules(C);
        const section = ruleFor('time_tracking');
        expect(section).toMatchObject({ isParent: true });
        expect(ruleFor('desktop_tracker')).toMatchObject({ dependency: 'time_tracking', isParent: false, parentId: section._id, switchOnly: true });
        expect(SENTINEL_KEYS).toEqual(expect.arrayContaining(['time_tracking', 'desktop_tracker']));
    });

    test('a new company switches it on for Member and leaves Guest off', async () => {
        seedCompany();
        await importCompanyRules(C);
        expect(entryOf('desktop_tracker', 3)).toEqual({ key: 3, permission: true });
        expect(entryOf('time_tracking', 3)).toEqual({ key: 3, permission: true });
        expect(entryOf('desktop_tracker', 0)).toEqual({ key: 0, permission: null });
    });

    test('a project never holds it among its own rules', async () => {
        seedCompany();
        await importCompanyRules(C, 'project', '6f0000000000000000000b01');
        const keys = (db().store[SCHEMA_TYPE.PROJECT_RULES] || []).map((r) => r.key);
        expect(keys).not.toContain('time_tracking');
        expect(keys).not.toContain('desktop_tracker');
    });
});

describe('trackerAccessFor on a plan without a tracker seat limit', () => {
    beforeEach(async () => {
        seedCompany();
        await importCompanyRules(C);
    });

    test('a member tracks by their role alone, and no seat is taken', async () => {
        expect(await access('member', { claim: true })).toEqual({ allowed: true });
        expect(seatOf('member').isTrackerUser).toBeUndefined();
    });

    test('an owner always may', async () => {
        expect(await access('owner')).toEqual({ allowed: true });
    });

    test('a guest is refused by role until an admin turns it on for guests', async () => {
        expect(await access('guest')).toEqual({ allowed: false, refusal: { code: seats.ROLE_REFUSAL } });
        setRole('desktop_tracker', 0, true);
        expect(await access('guest')).toEqual({ allowed: true });
    });

    test('turning the role off refuses the next start', async () => {
        setRole('desktop_tracker', 3, null);
        expect(await access('member', { claim: true })).toEqual({ allowed: false, refusal: { code: seats.ROLE_REFUSAL } });
    });

    test('someone without a live seat in the workspace is refused', async () => {
        expect((await access(OUTSIDER)).refusal).toEqual({ code: seats.NOT_A_MEMBER });
    });
});

describe('trackerAccessFor on a plan with tracker seats', () => {
    beforeEach(async () => {
        seedCompany({ planFeature: { timeTrackerUser: 2 } });
        await importCompanyRules(C);
    });

    test('the first people to start take the free seats, and the count follows', async () => {
        expect(await access('member', { claim: true })).toEqual({ allowed: true });
        expect(await access('second', { claim: true })).toEqual({ allowed: true });
        expect(seatOf('member').isTrackerUser).toBe(true);
        expect(seatOf('second').isTrackerUser).toBe(true);
        expect(company().trackerUsers).toBe(2);
    });

    test('once every seat is held the next person is refused, and a holder keeps tracking', async () => {
        await access('member', { claim: true });
        await access('second', { claim: true });
        const refused = await access('third', { claim: true });
        expect(refused.allowed).toBe(false);
        expect(refused.refusal).toMatchObject({ code: 'tracker_seat_limit', limit: 2, used: 2 });
        expect(seatOf('third').isTrackerUser).toBeUndefined();
        expect(await access('member', { claim: true })).toEqual({ allowed: true });
    });

    test('asking without claiming takes no seat', async () => {
        expect(await access('member')).toEqual({ allowed: true });
        expect(seatOf('member').isTrackerUser).toBeUndefined();
    });

    test('a released seat lets the next person start', async () => {
        await access('member', { claim: true });
        await access('second', { claim: true });
        await seats.releaseTrackerSeat(C, PEOPLE.member);
        expect(seatOf('member').isTrackerUser).toBe(false);
        expect(company().trackerUsers).toBe(1);
        expect(await access('third', { claim: true })).toEqual({ allowed: true });
    });

    test('a role turned off gives its members\' seats back', async () => {
        await access('member', { claim: true });
        setRole('desktop_tracker', 3, null);
        expect(await seats.releaseSeatsWithoutAccess(C)).toBe(1);
        expect(seatOf('member').isTrackerUser).toBe(false);
        expect(company().trackerUsers).toBe(0);
    });
});

describe('a role created later', () => {
    test('starts with the tracker on, and a role an owner already set is left alone', async () => {
        seedCompany();
        await importCompanyRules(C);
        setRole('desktop_tracker', 6, null);
        expect(await seats.grantTrackerToNewRoles(C, [5, 6, 0, 2])).toBe(3);
        expect(entryOf('desktop_tracker', 5)).toEqual({ key: 5, permission: true });
        expect(entryOf('time_tracking', 5)).toEqual({ key: 5, permission: true });
        expect(entryOf('desktop_tracker', 6)).toEqual({ key: 6, permission: null });
        expect(entryOf('time_tracking', 6)).toEqual({ key: 6, permission: true });
        expect(entryOf('desktop_tracker', 2)).toBeUndefined();
        expect(entryOf('desktop_tracker', 0)).toEqual({ key: 0, permission: null });
    });

    test('is granted through the role update a new role is added with', async () => {
        seedCompany();
        await importCompanyRules(C);
        const { updateRole } = require('../Modules/settings/Roles/controller');
        const res = { status: jest.fn(function status() { return this; }), json: jest.fn() };
        await updateRole({ headers: { companyid: C }, body: { queryFilter: { name: settingsCollectionDocs.ROLES }, queryObj: { $push: { settings: { key: 5, name: 'Contractor' } }, $set: { name: settingsCollectionDocs.ROLES } } } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(entryOf('desktop_tracker', 5)).toEqual({ key: 5, permission: true });
    });
});

describe('083-desktop-tracker-by-role', () => {
    const seedOldCompany = async () => {
        seedCompany();
        await importCompanyRules(C);
        db().store[SCHEMA_TYPE.RULES] = rules().filter((r) => !['time_tracking', 'desktop_tracker'].includes(r.key));
    };

    test('is a valid company-scoped migration with a down(), listed after 079', () => {
        expect(() => validateMigration(migration, '083-desktop-tracker-by-role')).not.toThrow();
        expect(typeof migration.down).toBe('function');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('083-desktop-tracker-by-role')).toBeGreaterThan(ids.indexOf('079-timesheet-date-index'));
    });

    test('adds the switch to an existing company and turns it on for Member and every custom role, not for guests', async () => {
        await seedOldCompany();
        expect(ruleFor('desktop_tracker')).toBeUndefined();

        await migration.up(contextFor([C]));

        expect(await access('member')).toEqual({ allowed: true });
        expect(await access('lead')).toEqual({ allowed: true });
        expect((await access('guest')).allowed).toBe(false);
        expect(entryOf('desktop_tracker', 4)).toMatchObject({ permission: true, seededBy: migration.SEEDED_BY });
        expect(entryOf('time_tracking', 4)).toMatchObject({ permission: true, seededBy: migration.SEEDED_BY });
    });

    test('running it twice changes nothing', async () => {
        await seedOldCompany();
        await migration.up(contextFor([C]));
        const first = JSON.stringify(rules().map((r) => [r.key, r.roles]).sort());
        await migration.up(contextFor([C]));
        expect(JSON.stringify(rules().map((r) => [r.key, r.roles]).sort())).toBe(first);
        expect(await migration.grantCompany(contextFor([C]), C)).toEqual({ granted: 0 });
    });

    test('a value an owner has set is left alone', async () => {
        seedCompany();
        await importCompanyRules(C);
        setRole('desktop_tracker', 4, false);
        await migration.grantCompany(contextFor([C]), C);
        expect(entryOf('desktop_tracker', 4)).toEqual({ key: 4, permission: false });
    });

    test('down() takes back only what it gave', async () => {
        await seedOldCompany();
        await migration.up(contextFor([C]));
        await migration.down(contextFor([C]));
        expect(entryOf('desktop_tracker', 4)).toBeUndefined();
        expect(entryOf('desktop_tracker', 3)).toEqual({ key: 3, permission: true });
    });
});
