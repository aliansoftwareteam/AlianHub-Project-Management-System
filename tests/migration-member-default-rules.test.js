const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../utils/commonFunctions');
const { evaluatePermission } = require('../Config/permissionGuard');
const { MEMBER_DEFAULT_PERMISSIONS } = require('../Modules/settings/securityPermissions/memberDefaults');
const migration = require('../migrations/011-member-default-rules');

const LEGACY = '6f0000000000000000000c01';
const CONFIGURED = '6f0000000000000000000c02';
const UNSEEDED = '6f0000000000000000000c03';
const MEMBER = '6f0000000000000000000002';
const GUEST_ONLY = [{ key: 0, permission: false }];
const logger = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies) => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, settingsCollectionDocs, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });
const rules = (companyId) => mockDbFor(companyId).store[SCHEMA_TYPE.RULES] || [];
const ruleFor = (companyId, key) => rules(companyId).find((r) => r.key === key);
const memberEntry = (companyId, key) => (ruleFor(companyId, key).roles || []).find((r) => r.key === 3);

/* The shape Local360 (6a8ee973d625fca52e519a12) has: every rule seeded with a Guest entry only. */
const seedCompany = (companyId, { member = null } = {}) => {
    const db = mockDbFor(companyId);
    db.seed(SCHEMA_TYPE.SETTINGS, { name: settingsCollectionDocs.ROLES, settings: [{ key: 0, name: 'Guest' }, { key: 1, name: 'Owner' }, { key: 2, name: 'Admin' }, { key: 3, name: 'Member' }] });
    db.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false });
    const project = db.seed(SCHEMA_TYPE.RULES, { key: 'project', name: 'Project', isParent: true, roles: [...GUEST_ONLY] });
    const task = db.seed(SCHEMA_TYPE.RULES, { key: 'task', name: 'Task', isParent: true, roles: [...GUEST_ONLY] });
    const settings = db.seed(SCHEMA_TYPE.RULES, { key: 'settings', name: 'Company Settings', isParent: true, roles: [...GUEST_ONLY] });
    const child = (key, parent, roles = [...GUEST_ONLY]) => db.seed(SCHEMA_TYPE.RULES, { key, name: key, isParent: false, parentId: String(parent._id), roles });
    child('project_create', project);
    child('task_create', task, member === null ? [...GUEST_ONLY] : [...GUEST_ONLY, { key: 3, permission: member }]);
    child('task_comment', task);
    child('settings_security_permissions', settings);
    db.seed(SCHEMA_TYPE.RULES, { key: 'toggle', name: 'toggle', isParent: false, roles: [] });
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
});

describe('011-member-default-rules', () => {
    test('is a valid company-scoped migration listed after 010, with a down()', () => {
        expect(() => validateMigration(migration, '011-member-default-rules')).not.toThrow();
        expect(typeof migration.down).toBe('function');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('011-member-default-rules')).toBeGreaterThan(ids.indexOf('010-seed-brief-parse-skill'));
    });

    test('a member of a company seeded without Member entries is denied what the defaults allow, and allowed after the backfill', async () => {
        seedCompany(LEGACY);
        expect(await evaluatePermission(LEGACY, MEMBER, 'task.task_create')).toBeNull();
        expect(await evaluatePermission(LEGACY, MEMBER, 'task.task_comment')).toBeNull();

        const ctx = contextFor([LEGACY]);
        await migration.up(ctx);

        expect(ctx.companies[LEGACY]).toEqual({ ok: true, added: 4, rules: 8 });
        expect(await evaluatePermission(LEGACY, MEMBER, 'task.task_create')).toBe(true);
        expect(await evaluatePermission(LEGACY, MEMBER, 'task.task_comment')).toBe(true);
        expect(await evaluatePermission(LEGACY, MEMBER, 'project.project_create')).toBeNull();
        expect(await evaluatePermission(LEGACY, MEMBER, 'settings.settings_security_permissions')).toBeNull();
        expect(memberEntry(LEGACY, 'project')).toEqual({ key: 3, permission: MEMBER_DEFAULT_PERMISSIONS.project, seededBy: '011-member-default-rules' });
        expect(ruleFor(LEGACY, 'toggle').roles).toEqual([]);
        expect(ruleFor(LEGACY, 'task_create').roles[0]).toEqual({ key: 0, permission: false });
        expect(removeCache).toHaveBeenCalledWith(`rules:${LEGACY}`);
        expect(mockDbFor(LEGACY).calls.every((call) => call.companyId === LEGACY)).toBe(true);
    });

    test('is idempotent: a second run adds nothing', async () => {
        seedCompany(LEGACY);
        await migration.up(contextFor([LEGACY]));
        const again = contextFor([LEGACY]);
        await migration.up(again);
        expect(again.companies[LEGACY]).toEqual({ ok: true, added: 0, skipped: 'configured' });
        expect(rules(LEGACY).flatMap((r) => r.roles).filter((r) => r.key === 3)).toHaveLength(4);
    });

    test('never touches a company where an admin has set any Member entry, even None', async () => {
        seedCompany(CONFIGURED, { member: null });
        ruleFor(CONFIGURED, 'task_comment').roles.push({ key: 3, permission: null });
        const ctx = contextFor([CONFIGURED]);
        await migration.up(ctx);
        expect(ctx.companies[CONFIGURED]).toEqual({ ok: true, added: 0, skipped: 'configured' });
        expect(memberEntry(CONFIGURED, 'task_comment')).toEqual({ key: 3, permission: null });
        expect(ruleFor(CONFIGURED, 'task_create').roles.some((r) => r.key === 3)).toBe(false);
    });

    test('skips a company whose rules were never seeded', async () => {
        mockDbFor(UNSEEDED);
        const ctx = contextFor([UNSEEDED]);
        await migration.up(ctx);
        expect(ctx.companies[UNSEEDED]).toEqual({ ok: true, added: 0, skipped: 'unseeded' });
    });

    test('down() removes only the entries it added that still hold the default', async () => {
        seedCompany(LEGACY);
        await migration.up(contextFor([LEGACY]));
        memberEntry(LEGACY, 'task_comment').permission = null;

        const ctx = contextFor([LEGACY]);
        await migration.down(ctx);

        expect(ctx.companies[LEGACY]).toEqual({ ok: true, removed: 3, keptChanged: 1 });
        expect(memberEntry(LEGACY, 'task_create')).toBeUndefined();
        expect(memberEntry(LEGACY, 'task_comment')).toEqual({ key: 3, permission: null, seededBy: '011-member-default-rules' });
        expect(ruleFor(LEGACY, 'task_create').roles).toEqual([{ key: 0, permission: false }]);
    });
});
