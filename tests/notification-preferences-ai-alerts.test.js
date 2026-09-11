const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async (c, uid) => ({ [mockIds.owner]: 1, [mockIds.admin]: 2, [mockIds.member]: 3 }[uid] || null)) }));
jest.mock('../Modules/notification/defaults', () => ({
    ensureNotificationDefaults: jest.fn(async (companyId, userId) => mockDb.crud(companyId, { type: 'notifications_settings', data: [{ userId: String(userId) }] }, 'findOne')),
}));
jest.mock('../Modules/settings/settingNotifications/controller', () => ({ updateNotifications: jest.fn(), getNotifications: jest.fn() }));

const mockIds = { owner: '6f00000000000000000000a1', admin: '6f00000000000000000000a2', member: '6f00000000000000000000a3' };

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { removeCache } = require('../utils/commonFunctions');
const routes = require('../Modules/settings/settingNotifications/routes');
const ctrl = require('../Modules/settings/settingNotifications/controller');
const preferences = require('../Modules/settings/settingNotifications/preferences');

const C = '6f0000000000000000000c01';
const docs = {};

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
};
const call = async (handler, uid, body) => { const r = res(); await handler({ headers: { companyid: C }, uid, body, params: {}, query: {} }, r); return r; };
const stored = (who) => mockDb.store[SCHEMA_TYPE.NOTIFICATIONS_SETTINGS].find((d) => d.userId === mockIds[who]);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    Object.keys(mockIds).forEach((who) => { docs[who] = mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, { _id: `6f0000000000000000000d${who === 'owner' ? '01' : who === 'admin' ? '02' : '03'}`, userId: mockIds[who], tasks: { items: [] }, agentActivity: true }); });
});

describe('GET /api/v1/notifications/preferences', () => {
    const routed = () => {
        const table = [];
        const app = { get: (p, h) => table.push({ method: 'get', p, h }), put: (p, h) => table.push({ method: 'put', p, h }) };
        routes.init(app);
        return (method, url) => table.find((r) => r.method === method && new RegExp(`^${r.p.replace(/:[^/]+/g, '[^/]+')}$`).test(url));
    };

    it('reaches the preferences handler instead of falling through to /:id', () => {
        const match = routed();
        expect(match('get', '/api/v1/notifications/preferences').h).toBe(preferences.getPreferences);
        expect(match('get', `/api/v1/notifications/${mockIds.owner}`).h).toBe(ctrl.getNotifications);
    });

    it('answers the caller\'s own document with owner defaults for AI alerts', async () => {
        const r = await call(preferences.getPreferences, mockIds.owner);
        expect(r.code).toBe(200);
        expect(r.body.data).toMatchObject({ userId: mockIds.owner, aiAlertsEligible: true, aiAlerts: { agent_error_rate: true, approval_rate_falling: true, cost_forecast: true, queue_age: true } });
    });

    it('gives admins cost and queue alerts by default and honours what they stored', async () => {
        expect((await call(preferences.getPreferences, mockIds.admin)).body.data.aiAlerts).toEqual({ agent_error_rate: false, approval_rate_falling: false, cost_forecast: true, queue_age: true });
        stored('admin').aiAlerts = { agent_error_rate: true, cost_forecast: false };
        expect((await call(preferences.getPreferences, mockIds.admin)).body.data.aiAlerts).toEqual({ agent_error_rate: true, approval_rate_falling: false, cost_forecast: false, queue_age: true });
    });

    it('marks a member ineligible with no AI alert choices', async () => {
        const r = await call(preferences.getPreferences, mockIds.member);
        expect(r.body.data).toMatchObject({ aiAlertsEligible: false, aiAlerts: null });
    });

    it('needs a signed-in caller', async () => {
        expect((await call(preferences.getPreferences, undefined)).code).toBe(400);
    });
});

describe('PUT /api/v1/notifications/preferences with aiAlerts', () => {
    it('stores an admin\'s choice per type and clears the settings cache', async () => {
        const r = await call(preferences.updatePreferences, mockIds.admin, { id: docs.admin._id, aiAlerts: { agent_error_rate: true, queue_age: false } });
        expect(r.code).toBe(200);
        expect(stored('admin').aiAlerts).toEqual({ agent_error_rate: true, queue_age: false });
        expect(removeCache).toHaveBeenCalledWith(`notification:${mockIds.admin}:${C}`);
    });

    it('refuses a member and writes nothing', async () => {
        const r = await call(preferences.updatePreferences, mockIds.member, { id: docs.member._id, aiAlerts: { cost_forecast: true } });
        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
        expect(stored('member').aiAlerts).toBeUndefined();
        expect(mockDb.calls.some((c) => c.method === 'findOneAndUpdate')).toBe(false);
    });

    it('still lets a member change their other preferences', async () => {
        const r = await call(preferences.updatePreferences, mockIds.member, { id: docs.member._id, agentActivity: false });
        expect(r.code).toBe(200);
        expect(stored('member').agentActivity).toBe(false);
    });

    it('refuses unknown alert types and non-boolean values', async () => {
        expect((await call(preferences.updatePreferences, mockIds.owner, { id: docs.owner._id, aiAlerts: { disk_full: true } })).code).toBe(400);
        expect((await call(preferences.updatePreferences, mockIds.owner, { id: docs.owner._id, aiAlerts: { queue_age: 'yes' } })).code).toBe(400);
        expect(stored('owner').aiAlerts).toBeUndefined();
    });

    it('cannot write another person\'s document', async () => {
        const r = await call(preferences.updatePreferences, mockIds.owner, { id: docs.admin._id, aiAlerts: { queue_age: false } });
        expect(r.code).toBe(404);
        expect(stored('admin').aiAlerts).toBeUndefined();
    });
});
