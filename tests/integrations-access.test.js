const mockDb = require('./fixtures/fakeMongo').create();

const mockRoles = {};
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => (uid in mockRoles ? mockRoles[uid] : null)),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/Integrations/controller');
const rules = require('../Modules/Integrations/helpers/integrationsRules');

const COMPANY = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OWNER = '200000000000000000000001';
const ADMIN = '200000000000000000000002';
const MEMBER = '200000000000000000000003';
const GUEST = '200000000000000000000004';
Object.assign(mockRoles, { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0 });
const T = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = r.json;
    return r;
};
const call = async (handler, uid, { body = {}, params = {} } = {}) => {
    const r = res();
    await handler({ headers: { companyid: COMPANY }, uid, body, params, query: {} }, r);
    return r;
};

const ZAPIER = { type: 'zapier', config: { hook_url: 'https://hooks.zapier.com/hooks/catch/123/abc/' } };
const SLACK_TOKEN = 'Q2hvb3NlQVZlcmlmaWNhdGlv';

let existing;
beforeEach(() => {
    mockDb.store[T] = [];
    existing = mockDb.seed(T, { type: 'custom_iframe', name: 'Grafana', config: { name: 'Grafana', url: 'https://g.example.com' }, status: 'connected', enabled: true, createdBy: ADMIN, deletedStatusKey: 0 });
});
const row = (id) => mockDb.store[T].find((d) => d._id === id);

describe('REP-03 managing integrations needs an owner or admin', () => {
    it('refuses a guest or member connecting an integration', async () => {
        for (const uid of [GUEST, MEMBER]) {
            // eslint-disable-next-line no-await-in-loop
            const r = await call(ctrl.connect, uid, { body: ZAPIER });
            expect(r.code).toBe(403);
            expect(r.body.status).toBe(false);
        }
        expect(mockDb.store[T]).toHaveLength(1);
    });

    it('refuses a guest toggling or disconnecting a company connection', async () => {
        const toggle = await call(ctrl.updateConnection, GUEST, { params: { id: existing._id }, body: { enabled: false } });
        const drop = await call(ctrl.disconnect, GUEST, { params: { id: existing._id } });
        expect(toggle.code).toBe(403);
        expect(drop.code).toBe(403);
        expect(row(existing._id)).toMatchObject({ enabled: true, deletedStatusKey: 0 });
    });

    it('refuses a caller with no company membership', async () => {
        const r = await call(ctrl.connect, '2000000000000000000000ff', { body: ZAPIER });
        expect(r.code).toBe(403);
    });

    it('lets an admin connect and toggle, and an owner disconnect', async () => {
        const connected = await call(ctrl.connect, ADMIN, { body: ZAPIER });
        expect(connected.body.status).toBe(true);
        expect(connected.body.data.secrets).toEqual({ hook_url: true });
        expect(JSON.stringify(connected.body)).not.toContain('hooks.zapier.com');

        const toggled = await call(ctrl.updateConnection, ADMIN, { params: { id: existing._id }, body: { enabled: false } });
        expect(toggled.body.status).toBe(true);
        expect(row(existing._id).enabled).toBe(false);

        const dropped = await call(ctrl.disconnect, OWNER, { params: { id: existing._id } });
        expect(dropped.body.status).toBe(true);
        expect(row(existing._id).deletedStatusKey).toBe(1);
    });

    it('still lets a guest list connections, with secrets redacted', async () => {
        await call(ctrl.connect, OWNER, { body: ZAPIER });
        const r = await call(ctrl.listConnections, GUEST);
        expect(r.body.status).toBe(true);
        expect(JSON.stringify(r.body)).not.toContain('hooks.zapier.com');
    });

    it('answers 400 for a malformed id and 404 for an unknown one', async () => {
        expect((await call(ctrl.disconnect, OWNER, { params: { id: 'nope' } })).code).toBe(400);
        expect((await call(ctrl.disconnect, OWNER, { params: { id: 'abcdefabcdefabcdefabcdef' } })).code).toBe(404);
        expect((await call(ctrl.updateConnection, OWNER, { params: { id: 'abcdefabcdefabcdefabcdef' }, body: { enabled: true } })).code).toBe(404);
    });
});

describe('REP-05 every integration type validates its fields', () => {
    const invalid = [
        ['zapier', { hook_url: 'not a url' }, 'hook_url'],
        ['zapier', { hook_url: 'http://hooks.zapier.com/hooks/catch/1/a/' }, 'hook_url'],
        ['zapier', { hook_url: 'https://evil.example.com/hooks/catch/1/a/' }, 'hook_url'],
        ['microsoft_teams', {}, 'webhook_url'],
        ['microsoft_teams', { webhook_url: 'https://127.0.0.1/webhook' }, 'webhook_url'],
        ['github', { token: 'fake', repo: 'owner/repo' }, 'token'],
        ['github', { token: `ghp_${'a'.repeat(36)}`, repo: 'not/../valid repo' }, 'repo'],
        ['gitlab', { token: 'short', project: 'group/app' }, 'token'],
        ['gitlab', { token: `glpat-${'a'.repeat(20)}` }, 'project'],
        ['slack', {}, 'verification_token'],
        ['slack', { verification_token: 'x' }, 'verification_token'],
        ['slack', { verification_token: SLACK_TOKEN, default_channel: 'has spaces!' }, 'default_channel'],
        ['google_calendar', { client_id: 'abc', client_secret: 'GOCSPX-aaaaaaaaaaaaaaaaaaaaaaaa' }, 'client_id'],
        ['google_calendar', { client_id: '1234-abc.apps.googleusercontent.com' }, 'client_secret'],
        ['custom_iframe', { name: 'x', url: 'javascript:alert(1)' }, 'url'],
    ];

    it.each(invalid)('%s with %j is refused on field %s', (type, config, field) => {
        const check = rules.validateConnection({ type, config });
        expect(check.valid).toBe(false);
        expect(check.field).toBe(field);
        expect(check.reason).toBeTruthy();
    });

    const valid = [
        ['zapier', { hook_url: 'https://hooks.zapier.com/hooks/catch/123/abc/' }],
        ['microsoft_teams', { webhook_url: 'https://contoso.webhook.office.com/webhookb2/abc' }],
        ['github', { token: `ghp_${'A1'.repeat(18)}`, repo: 'aliansoftwareteam/AlianHub' }],
        ['github', { token: `github_pat_${'a1B2_'.repeat(10)}`, repo: 'owner/repo.js' }],
        ['gitlab', { token: `glpat-${'a'.repeat(20)}`, project: 'group/sub/app' }],
        ['slack', { verification_token: SLACK_TOKEN, default_channel: '#dev-team' }],
        ['slack', { verification_token: SLACK_TOKEN }],
        ['google_calendar', { client_id: '1234-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-aaaaaaaaaaaaaaaaaaaaaaaa' }],
        ['custom_iframe', { name: 'Grafana', url: 'https://g.example.com' }],
    ];

    it.each(valid)('%s with %j is accepted', (type, config) => {
        expect(rules.validateConnection({ type, config }).valid).toBe(true);
    });

    it('answers 400 with the field and stores nothing for an invalid value', async () => {
        const r = await call(ctrl.connect, OWNER, { body: { type: 'microsoft_teams', config: {} } });
        expect(r.code).toBe(400);
        expect(r.body).toMatchObject({ status: false, field: 'webhook_url' });
        expect(mockDb.store[T].some((d) => d.type === 'microsoft_teams')).toBe(false);
    });

    it('marks required fields in the catalog so the form can show them', () => {
        const teams = rules.getCatalog().find((c) => c.key === 'microsoft_teams');
        expect(teams.fields.find((f) => f.key === 'webhook_url').required).toBe(true);
    });
});
