const { createApiClient } = require('../../e2e/support/api');
const { emailFor, inviteMember, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });
const anonymousWithCompany = createApiClient({ baseURL: state.baseURL, companyId: state.companyId });
const OTHER_COMPANY = '0123456789abcdef01234567';
const NON_OWNERS = ['admin', 'member', 'guest'];
const ALL_ROLES = ['owner', ...NON_OWNERS];

const refused = (res) => res.status >= 400 || Boolean(res.body && typeof res.body === 'object' && res.body.status === false);

/* One login per role per file: the refresh token is derived from the second a session starts. */
const sessions = {};
const as = async (role) => {
    if (!sessions[role]) sessions[role] = await loginAs(role);
    return sessions[role];
};

async function freshUser(role) {
    const owner = await as('owner');
    const suffix = uniqueSuffix();
    const email = emailFor(role, `ins${suffix}`);
    const user = await inviteMember({ baseURL: state.baseURL, ownerApi: owner.api, companyId: state.companyId, role, email, firstName: 'QA', lastName: `Instance ${suffix}` });
    const session = await login(state.baseURL, email);
    return { ...user, api: createApiClient({ baseURL: state.baseURL, accessToken: session.accessToken, companyId: state.companyId }) };
}

async function waitFor(check, { timeoutMs = 15000, intervalMs = 250 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() > deadline) return value;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

const statusTemplate = (TemplateName) => ({ TemplateName, ActiveStatusList: [], DoneStatusList: [], defaultActive: {}, defaultComplete: {} });

const roleTypeOf = async (userId) => {
    const owner = await as('owner');
    const res = await owner.api.get(`/api/v1/members/${userId}`);
    return res.body && res.body.roleType;
};

describe('build version', () => {
    it('reports one version on /version, /health, Stats and Upgrade', async () => {
        const owner = await as('owner');
        const version = await anonymous.get('/version');
        expect(version.status).toBe(200);
        expect(version.body.status).toBe(true);
        const { data } = version.body;
        expect(data).toEqual(expect.objectContaining({ version: expect.stringMatching(/^14\./), release: expect.any(String), channel: expect.any(String) }));
        if (data.channel === 'beta') {
            expect(data.version).toMatch(new RegExp(`-beta\\.${data.build}$`));
            expect(data.build).toBeGreaterThan(0);
        }

        const health = await anonymous.get('/health');
        expect(health.status).toBe(200);
        expect(health.body).toMatchObject({ status: 'ok', version: data.version, db: { ok: true }, maintenance: false });

        const stats = await owner.api.get('/api/v2/instance/stats');
        expect(stats.body.data).toMatchObject({ version: data.version, channel: data.channel, build: data.build });

        const upgrade = await owner.api.get('/api/v2/instance/upgrade');
        expect(upgrade.status).toBe(200);
        expect(upgrade.body.data).toMatchObject({ currentVersion: data.version, release: data.release, build: { channel: data.channel } });
        expect(Array.isArray(upgrade.body.data.buildLog)).toBe(true);
    }, 30000);
});

const INSTANCE_ROUTES = [
    ['get', '/api/v2/instance/access'],
    ['get', '/api/v2/instance/settings'],
    ['put', '/api/v2/instance/settings', { APP_NAME: '[QA instance] refused' }],
    ['post', '/api/v2/instance/settings/test', { group: 'storage' }],
    ['get', '/api/v2/instance/health'],
    ['post', '/api/v2/instance/maintenance', { on: false }],
    ['get', '/api/v2/instance/upgrade'],
    ['post', '/api/v2/instance/migrations/run', {}],
    ['get', '/api/v2/instance/logs'],
    ['get', '/api/v2/instance/logs/files'],
    ['get', '/api/v2/instance/logs/download?name=error-2026-01-01.log'],
    ['get', '/api/v2/instance/backups'],
    ['post', '/api/v2/instance/backups', {}],
    ['get', '/api/v2/instance/backups/alianhub-14.0.0-20260101-000000.tar.gz/manifest'],
    ['get', '/api/v2/instance/backups/alianhub-14.0.0-20260101-000000.tar.gz/download'],
    ['post', '/api/v2/instance/backups/alianhub-14.0.0-20260101-000000.tar.gz/restore', { confirm: 'alianhub-14.0.0-20260101-000000.tar.gz' }],
    ['delete', '/api/v2/instance/backups/alianhub-14.0.0-20260101-000000.tar.gz'],
    ['get', '/api/v2/instance/stats'],
    ['get', '/api/v2/instance/companies'],
    ['get', `/api/v2/instance/audit-export?companyId=${state.companyId}`],
];

describe('instance console refusals', () => {
    const cases = NON_OWNERS.flatMap((role) => INSTANCE_ROUTES.map(([method, path, body]) => [role, method.toUpperCase(), path, body]));

    it.each(cases)('refuses %s on %s %s', async (role, method, path, body) => {
        const { api } = await as(role);
        const res = await api.request(method, path, { body });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ status: false });
    });

    it.each(INSTANCE_ROUTES.map(([method, path, body]) => [method.toUpperCase(), path, body]))('answers 401 without a session on %s %s', async (method, path, body) => {
        const res = await anonymousWithCompany.request(method, path, { body });
        expect(res.status).toBe(401);
    });

    it('serves the public config to anyone', async () => {
        const res = await anonymous.get('/api/v2/instance/public-config');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual(expect.objectContaining({ version: expect.any(String), appName: expect.any(String), auth: expect.any(Object) }));
    });
});

describe('instance console as the owner', () => {
    it('confirms owner access', async () => {
        const { api } = await as('owner');
        const res = await api.get('/api/v2/instance/access');
        expect(res.body).toEqual({ status: true, statusText: expect.any(String), data: { allowed: true, via: 'owner' } });
    });

    it.failing('INS-07 saves a setting from the owner session, shows it in the public config and restores it', async () => {
        const { api } = await as('owner');
        const before = await api.get('/api/v2/instance/settings');
        expect(before.body.data.groups).toEqual(expect.arrayContaining(['general', 'mail', 'storage']));
        const appName = before.body.data.settings.find((s) => s.key === 'APP_NAME');
        expect(appName).toBeDefined();
        const restore = appName.source === 'saved' ? appName.value : '';
        const name = `[QA instance] ${uniqueSuffix()}`;
        try {
            const saved = await api.put('/api/v2/instance/settings', { APP_NAME: name });
            expect(saved.status).toBe(200);
            expect(saved.body.data.applied).toEqual(['APP_NAME']);
            const pub = await anonymous.get('/api/v2/instance/public-config');
            expect(pub.body.data.appName).toBe(name);
        } finally {
            await api.put('/api/v2/instance/settings', { APP_NAME: restore });
        }
        const after = await api.get('/api/v2/instance/settings');
        expect(after.body.data.settings.find((s) => s.key === 'APP_NAME').value).toBe(appName.value);
    });

    it('rejects unknown settings and unknown test groups', async () => {
        const { api } = await as('owner');
        const bad = await api.put('/api/v2/instance/settings', { NOT_A_SETTING: 'x' });
        expect(bad.status).toBe(400);
        expect(bad.body).toMatchObject({ status: false, data: { errors: { NOT_A_SETTING: 'unknown' } } });

        const test = await api.post('/api/v2/instance/settings/test', { group: 'nothing' });
        expect(test.status).toBe(400);
        expect(test.body.status).toBe(false);
    });

    it('reports health', async () => {
        const { api } = await as('owner');
        const res = await api.get('/api/v2/instance/health');
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: 'ok', db: { ok: true }, maintenance: false });
        expect(res.body.data.readiness).toEqual(expect.objectContaining({ storageChosen: true }));
    });

    it('blocks the API during maintenance and keeps the console and health open', async () => {
        const { api } = await as('owner');
        try {
            const on = await api.post('/api/v2/instance/maintenance', { on: true });
            expect(on.body.data).toEqual({ maintenance: true });

            const blocked = await api.get('/api/v1/setting/roles');
            expect(blocked.status).toBe(503);
            expect(blocked.body).toMatchObject({ status: false, maintenance: true });
            expect((await api.get('/api/v2/instance/health')).status).toBe(200);
            expect((await anonymous.get('/health')).body.maintenance).toBe(true);
        } finally {
            await api.post('/api/v2/instance/maintenance', { on: false });
        }
        expect((await api.get('/api/v1/setting/roles')).status).toBe(200);
    });

    it('runs pending migrations', async () => {
        const { api } = await as('owner');
        const res = await api.post('/api/v2/instance/migrations/run', {});
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(Array.isArray(res.body.data.applied)).toBe(true);
    });

    it('lists and tails logs and refuses a path outside the log directory', async () => {
        const { api } = await as('owner');
        const files = await api.get('/api/v2/instance/logs/files');
        expect(Array.isArray(files.body.data.files)).toBe(true);

        const tail = await api.get('/api/v2/instance/logs', { query: { file: 'combined', lines: 5 } });
        expect(tail.status).toBe(200);
        expect(tail.body.data).toEqual(expect.objectContaining({ kind: 'combined', lines: expect.any(Array) }));

        expect((await api.get('/api/v2/instance/logs', { query: { file: 'secrets' } })).status).toBe(400);
        expect((await api.get('/api/v2/instance/logs/download', { query: { name: '../../.env' } })).status).toBe(404);
    });

    it('creates, inspects, downloads and deletes a backup', async () => {
        const { api } = await as('owner');
        const created = await api.post('/api/v2/instance/backups', {});
        expect(created.status).toBe(200);
        const { name } = created.body.data;
        expect(name).toMatch(/^[a-z0-9.-]+-\d{8}-\d{6}\.tar\.gz$/);
        try {
            const list = await api.get('/api/v2/instance/backups');
            expect(list.body.data.backups.map((b) => b.name)).toContain(name);

            const manifest = await api.get(`/api/v2/instance/backups/${name}/manifest`);
            expect(manifest.body.data).toMatchObject({ format: 'alianhub-backup', includeFiles: false });
            expect(Object.keys(manifest.body.data.databases)).toEqual(expect.arrayContaining(['global', state.companyId]));

            const download = await api.get(`/api/v2/instance/backups/${name}/download`);
            expect(download.status).toBe(200);
            expect(download.headers.get('content-disposition')).toContain(name);

            const wrongConfirm = await api.post(`/api/v2/instance/backups/${name}/restore`, { confirm: 'yes' });
            expect(wrongConfirm.status).toBe(400);
        } finally {
            expect((await api.delete(`/api/v2/instance/backups/${name}`)).status).toBe(200);
        }
        expect((await api.get(`/api/v2/instance/backups/${name}/manifest`)).status).toBe(404);
    }, 60000);

    it('restores a backup and keeps serving', async () => {
        const { api } = await as('owner');
        const created = await api.post('/api/v2/instance/backups', {});
        const { name } = created.body.data;
        try {
            const restored = await api.post(`/api/v2/instance/backups/${name}/restore`, { confirm: name });
            expect(restored.status).toBe(200);
            expect(restored.body.status).toBe(true);
            expect((await anonymous.get('/health')).body).toMatchObject({ status: 'ok', maintenance: false });
            expect((await api.get('/api/v2/instance/stats')).status).toBe(200);
        } finally {
            await api.delete(`/api/v2/instance/backups/${name}`);
        }
    }, 90000);

    it('lists companies and exports company history as CSV', async () => {
        const { api } = await as('owner');
        const stats = await api.get('/api/v2/instance/stats');
        expect(stats.body.data.companies).toBeGreaterThanOrEqual(1);
        expect(stats.body.data.users).toBeGreaterThanOrEqual(4);

        const companies = await api.get('/api/v2/instance/companies');
        expect(companies.body.data.map((c) => String(c._id))).toContain(state.companyId);

        const csv = await api.get('/api/v2/instance/audit-export', { query: { companyId: state.companyId } });
        expect(csv.status).toBe(200);
        expect(csv.headers.get('content-type')).toContain('text/csv');
        expect(String(csv.body).replace(/^\uFEFF/, '').split('\r\n')[0]).toBe('CreatedAt,Type,Key,UserId,ProjectId,TaskId,Message');

        expect((await api.get('/api/v2/instance/audit-export', { query: { companyId: 'nope' } })).status).toBe(400);
    });
});

const AUDIT_CSV_HEADER = 'time,actorType,actor,agent,run,event,entity,reason,cost_usd,undone_at';

describe('audit log', () => {
    it.each(['owner', 'admin'])('lists and exports for %s', async (role) => {
        const { api } = await as(role);
        const list = await api.get('/api/v1/audit-logs', { query: { limit: 5 } });
        expect(list.status).toBe(200);
        expect(list.body).toEqual({ status: true, data: expect.any(Array), metadata: expect.objectContaining({ total: expect.any(Number), page: 1 }) });

        const csv = await api.get('/api/v1/audit-logs/export');
        expect(csv.status).toBe(200);
        expect(String(csv.body).split('\n')[0]).toBe(AUDIT_CSV_HEADER);
    });

    it.each(['member', 'guest'])('refuses %s', async (role) => {
        const { api } = await as(role);
        expect((await api.get('/api/v1/audit-logs')).status).toBe(403);
        expect((await api.get('/api/v1/audit-logs/export')).status).toBe(403);
    });

    it('refuses without a session or for another company', async () => {
        expect((await anonymousWithCompany.get('/api/v1/audit-logs')).status).toBe(401);
        const { api } = await as('admin');
        expect((await api.withCompany(OTHER_COMPANY).get('/api/v1/audit-logs')).status).toBe(401);
    });

    it('records a member update and filters by entity', async () => {
        const owner = await as('owner');
        const user = await freshUser('member');
        const update = await owner.api.put('/api/v1/members', { id: user.companyUserId, data: { designation: 0 } });
        expect(update.body.status).toBe(true);

        const rows = await waitFor(async () => {
            const res = await owner.api.get('/api/v1/audit-logs', { query: { entityId: user.companyUserId } });
            return res.body.data.length ? res.body.data : null;
        });
        expect(rows[0]).toMatchObject({ action: 'member.update', entityType: 'member', entityId: user.companyUserId });
    });

    it('answers 404 when undoing a row that does not exist', async () => {
        const { api } = await as('owner');
        const res = await api.post(`/api/v1/audit-logs/${OTHER_COMPANY}/undo`, {});
        expect(res.status).toBe(404);
    });

    it.failing('INS-08 exports every row of the filter, not only the first 100', async () => {
        const owner = await as('owner');
        const user = await freshUser('member');
        for (let i = 0; i < 101; i += 1) {
            await owner.api.put('/api/v1/members', { id: user.companyUserId, data: { designation: 0 } });
        }
        const total = await waitFor(async () => {
            const res = await owner.api.get('/api/v1/audit-logs', { query: { entityId: user.companyUserId, limit: 1 } });
            return res.body.metadata.total >= 101 ? res.body.metadata.total : 0;
        });
        expect(total).toBe(101);

        const csv = await owner.api.get('/api/v1/audit-logs/export', { query: { entityId: user.companyUserId } });
        expect(String(csv.body).split('\n').length - 1).toBe(total);
    }, 120000);

    it.failing('INS-09 records the signed-in actor, not a name from the request body', async () => {
        const owner = await as('owner');
        const user = await freshUser('member');
        await owner.api.put('/api/v1/members', { id: user.companyUserId, data: { designation: 0 }, userData: { name: '=HYPERLINK("http://example.invalid","Rahul")' } });

        const row = await waitFor(async () => {
            const res = await owner.api.get('/api/v1/audit-logs', { query: { entityId: user.companyUserId } });
            return res.body.data[0];
        });
        expect(row.actorId).toBe(owner.uid);
        expect(row.actorName).not.toContain('HYPERLINK');

        const csv = await owner.api.get('/api/v1/audit-logs/export', { query: { entityId: user.companyUserId } });
        expect(String(csv.body)).not.toMatch(/(^|,)=HYPERLINK/m);
    });
});

const SETTINGS_READS = [
    '/api/v1/setting/designation',
    '/api/v1/setting/companyUserStatus',
    '/api/v1/setting/category',
    '/api/v1/setting/roles',
    '/api/v1/commonDateFormate',
    '/api/v1/currency',
    '/api/v1/taskPriority',
    '/api/v1/restricted-extensions',
    '/api/v1/fileExtensions',
    '/api/v1/milestoneStatus',
    '/api/v1/milestoneBillingPeriod',
    '/api/v1/securityPermissions',
    '/api/v1/project-status-template',
    '/api/v1/templates/taskType',
    '/api/v1/templates/taskStatus',
    '/api/v1/setting/projectStatus',
    '/api/v1/setting/taskStatus',
    '/api/v1/setting/taskType',
    '/api/v1/members',
];

describe('company settings reads', () => {
    it.each(ALL_ROLES)('serves every settings catalogue to %s', async (role) => {
        const { api } = await as(role);
        for (const path of SETTINGS_READS) {
            const res = await api.get(path);
            expect({ path, status: res.status }).toEqual({ path, status: 200 });
        }
        const self = await api.get(`/api/v1/members/${state.users[role].userId}`);
        expect(self.body).toMatchObject({ userId: state.users[role].userId, roleType: state.users[role].roleType });
        const count = await api.post('/api/v1/members/count', { query: {} });
        expect(count.body[0].totalCount).toBeGreaterThanOrEqual(4);
    });

    it('refuses every settings catalogue without a session', async () => {
        for (const path of SETTINGS_READS) {
            const res = await anonymousWithCompany.get(path);
            expect({ path, status: res.status }).toEqual({ path, status: 401 });
        }
    });

    it('refuses a member reading another company', async () => {
        const { api } = await as('member');
        const res = await api.withCompany(OTHER_COMPANY).get('/api/v1/setting/roles');
        expect(res.status).toBe(401);
    });

    it.each([
        ['/api/v1/milestoneRange'],
        ['/api/v1/setting/skills'],
        [`/api/v1/notifications/${state.users.member.userId}`],
    ])('INS-03/INS-04 refuses %s without a session', async (path) => {
        const res = await anonymousWithCompany.get(path);
        expect(res.status).toBe(401);
    });
});

describe('company settings writes as the owner', () => {
    it('creates, renames and deletes a task status template', async () => {
        const { api } = await as('owner');
        const name = `[QA instance] status ${uniqueSuffix()}`;
        const created = await api.post('/api/v1/templates/taskStatus', { updateObject: statusTemplate(name) });
        expect(created.status).toBe(200);
        const id = created.body._id;
        expect(created.body.TemplateName).toBe(name);

        const renamed = await api.put('/api/v1/templates/taskStatus', { type: 'updateOne', key: '$set', id, updateObject: { TemplateName: `${name} renamed` } });
        expect(renamed.status).toBe(200);
        const list = await api.get('/api/v1/templates/taskStatus');
        expect(list.body.find((t) => t._id === id).TemplateName).toBe(`${name} renamed`);

        expect((await api.delete(`/api/v1/templates/taskStatus/${id}`)).status).toBe(200);
    });

    it('creates, renames and deletes a task type template', async () => {
        const { api } = await as('owner');
        const name = `[QA instance] type ${uniqueSuffix()}`;
        const created = await api.post('/api/v1/templates/taskType', { updateObject: { TemplateName: name, taskTypes: [] } });
        expect(created.status).toBe(200);
        const id = created.body._id;

        const renamed = await api.put('/api/v1/templates/taskType', { type: 'updateOne', key: '$set', id, updateObject: { TemplateName: `${name} renamed` } });
        expect(renamed.status).toBe(200);
        const list = await api.get('/api/v1/templates/taskType');
        expect(list.body.find((t) => t._id === id).TemplateName).toBe(`${name} renamed`);

        expect((await api.delete(`/api/v1/templates/taskType/${id}`)).status).toBe(200);
    });

    it('creates, renames and deletes a project status template', async () => {
        const { api } = await as('owner');
        const name = `[QA instance] project status ${uniqueSuffix()}`;
        const created = await api.post('/api/v1/project-status-template', { TemplateName: name, projectActiveStatus: [], projectCompletedStatus: {}, projectDoneStatus: [] });
        expect(created.body.status).toBe(true);
        const id = created.body.data._id;

        const renamed = await api.put('/api/v1/project-status-template', { id, templateName: `${name} renamed` });
        expect(renamed.status).toBe(200);
        const list = await api.get('/api/v1/project-status-template');
        expect(list.body.data.find((t) => t._id === id).TemplateName).toBe(`${name} renamed`);

        const removed = await api.delete(`/api/v1/project-status-template/${id}`);
        expect(removed.body.status).toBe(true);
    });

    it('adds a project skill and hides it again', async () => {
        const { api } = await as('owner');
        const added = await api.put('/api/v1/setting/skills', { operation: 'add', name: `QA Instance ${uniqueSuffix()}` });
        expect(added.status).toBe(200);
        const { key } = added.body.skill;
        const hidden = await api.put('/api/v1/setting/skills', { operation: 'setActive', key, active: false });
        expect(hidden.body.skill).toMatchObject({ key, active: false });
    });

    it('updates the caller notification preferences only for their own document', async () => {
        const user = await freshUser('member');
        const other = await freshUser('member');
        const mine = await user.api.get(`/api/v1/notifications/${user.userId}`);
        const theirs = await other.api.get(`/api/v1/notifications/${other.userId}`);

        const own = await user.api.put('/api/v1/notifications/preferences', { id: mine.body._id, dailyDigest: true });
        expect(own.body).toMatchObject({ status: true, data: { dailyDigest: true } });

        const foreign = await user.api.put('/api/v1/notifications/preferences', { id: theirs.body._id, dailyDigest: true });
        expect(foreign.status).toBe(404);
    });
});

describe('company settings role enforcement', () => {
    it.failing('INS-01 refuses a member promoting themselves to owner through PUT /api/v1/members', async () => {
        const user = await freshUser('member');
        const res = await user.api.put('/api/v1/members', { id: user.companyUserId, data: { roleType: 1 } });
        expect(refused(res)).toBe(true);
        expect(await roleTypeOf(user.userId)).toBe(user.roleType);
    });

    it.failing('INS-02 refuses a guest promoting themselves to admin through PUT /api/v1/root-members', async () => {
        const user = await freshUser('guest');
        const res = await user.api.put('/api/v1/root-members', { id: user.companyUserId, data: { roleType: 2 }, companyId: state.companyId });
        expect(refused(res)).toBe(true);
        expect(await roleTypeOf(user.userId)).toBe(user.roleType);
    });

    const marker = () => `qa-instance-${uniqueSuffix()}`;
    it.failing.each([
        ['PUT /api/v1/setting/roles/update', 'put', '/api/v1/setting/roles/update', () => ({ queryFilter: { name: marker() }, queryObj: { $set: { qaMarker: true } } })],
        ['PUT /api/v1/setting/designation/update', 'put', '/api/v1/setting/designation/update', () => ({ queryFilter: { name: marker() }, queryObj: { $set: { qaMarker: true } } })],
        ['PUT /api/v1/commonDateFormate', 'put', '/api/v1/commonDateFormate', () => ({ key: '$set', updateObject: { qaMarker: marker() } })],
        ['PUT /api/v1/taskPriority', 'put', '/api/v1/taskPriority', () => ({ key: '$set', updateObject: { qaMarker: marker() } })],
        ['PUT /api/v1/fileExtensions', 'put', '/api/v1/fileExtensions', () => ({ key: '$set', updateObject: { qaMarker: marker() } })],
        ['PUT /api/v1/milestoneStatus', 'put', '/api/v1/milestoneStatus', () => ({ key: '$set', updateObject: { qaMarker: marker() } })],
        ['POST /api/v1/templates/taskStatus', 'post', '/api/v1/templates/taskStatus', () => ({ updateObject: statusTemplate(`[QA instance] ${marker()}`) })],
    ])('INS-06 refuses a guest on %s', async (label, method, path, body) => {
        const { api } = await as('guest');
        const res = await api.request(method.toUpperCase(), path, { body: body() });
        expect(refused(res)).toBe(true);
    });

    it.failing('INS-06 refuses a guest editing a security permission rule', async () => {
        const { api } = await as('guest');
        const rules = await api.get('/api/v1/securityPermissions');
        const rule = rules.body.find((r) => !r.isParent);
        const res = await api.put('/api/v1/securityPermissions', { type: 'updateOne', key: '$set', id: rule._id, updateObject: { qaMarker: marker() } });
        expect(refused(res)).toBe(true);
    });

    it.failing('INS-05 refuses a currency write aimed at another company', async () => {
        const { api } = await as('admin');
        const currencies = await api.get('/api/v1/currency');
        const [currency] = currencies.body;
        const res = await api.put(`/api/v1/currency/${OTHER_COMPANY}/${currency._id}`, { key: '$set', updateObject: { qaMarker: true } });
        expect(refused(res)).toBe(true);
    });

    it('INS-03 refuses an anonymous change to someone else notification settings', async () => {
        const user = await freshUser('member');
        const doc = (await user.api.get(`/api/v1/notifications/${user.userId}`)).body;
        const item = doc.chat.items[0];

        const res = await anonymousWithCompany.put('/api/v1/notifications', { id: doc._id, key: 'chat', elementKey: item.key, fieldToUpdate: 'email', valueToUpdate: !item.email, userId: user.userId });
        const after = (await user.api.get(`/api/v1/notifications/${user.userId}`)).body;

        expect(res.status).toBe(401);
        expect(after.chat.items[0].email).toBe(item.email);
    });

    it('INS-04 refuses an anonymous project skill write', async () => {
        const res = await anonymousWithCompany.put('/api/v1/setting/skills', { operation: 'add', name: `QA Anonymous ${uniqueSuffix()}` });
        expect(res.status).toBe(401);
    });

    it('INS-11 refuses an anonymous version update flag', async () => {
        const res = await anonymous.post('/api/v1/versionUpdateNotify', { flag: false });
        expect(res.status).toBe(401);
    });

    it.failing('INS-10 refuses a member editing another member private views', async () => {
        const user = await freshUser('member');
        const other = await freshUser('member');
        const res = await user.api.post('/api/v1/members/private-view', { id: other.companyUserId, operation: 'push', data: { id: `qa-${uniqueSuffix()}`, name: '[QA instance] view' } });
        expect(refused(res)).toBe(true);
    });
});

describe('common, admin and api docs', () => {
    it('serves the time, email templates, logo and brand settings', async () => {
        const time = await anonymous.get('/api/v1/getTime', { query: { zone: 'UTC' } });
        expect(time.status).toBe(200);
        expect(String(time.body)).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        const templates = await anonymous.get('/api/v1/getEmailTemplates');
        expect(Object.keys(templates.body)).toEqual(expect.arrayContaining(['verifyEmail', 'resetEmail']));

        const logo = await anonymous.get('/api/v1/getlogo');
        expect(logo.status).toBe(200);
        expect(logo.headers.get('content-type')).toMatch(/^image\//);

        const brand = await anonymous.get('/api/v1/getBrandSettingsData');
        expect(brand.body).toEqual(expect.objectContaining({ productName: expect.any(String) }));
    });

    it('refuses the connections list without the preset key', async () => {
        const res = await anonymous.get('/connections/not-the-key');
        expect(res.body).toBe('Unauthorized');
    });

    it('serves the API docs', async () => {
        const res = await anonymous.get('/apidocs/');
        expect(res.status).toBe(200);
        expect(String(res.body)).toContain('swagger');
    });

    it.failing('INS-12 answers getTime without a zone with the standard error shape', async () => {
        const res = await anonymous.get('/api/v1/getTime');
        expect(res.body).toMatchObject({ status: false });
    });
});
