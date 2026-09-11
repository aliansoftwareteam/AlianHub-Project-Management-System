const crypto = require('node:crypto');
const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();
const anon = createApiClient({ baseURL: state.baseURL });
const COMPANY_A = state.companyId;
const TASK_TYPE_IMAGE = 'setting/task_type/task.png';

/* The harness seeds one company and no pre-provisioned ones, so /api/v2/company/create
 * answers "Predefine company not found". Company B is an id outside every fixture
 * user's token; tests/storage-bucket-access.test.js covers two real memberships. */
const COMPANY_B = crypto.randomBytes(12).toString('hex');

describe('anonymous callers', () => {
    it.each([
        ['GET', `/api/v1/getBucket/${COMPANY_A}`],
        ['GET', `/api/v1/getBucketSize/${COMPANY_A}`],
        ['DELETE', `/api/v1/removeBucket/${COMPANY_A}`],
        ['GET', `/api/v1/generateSignedUrl/${COMPANY_A}?filepath=${TASK_TYPE_IMAGE}`],
    ])('get 401 from %s %s', async (method, url) => {
        const res = await anon.request(method, url);
        expect(res.status).toBe(401);
    });

    it('get 401 from POST /api/v1/getTaskTypeImage (TSK-04)', async () => {
        const res = await anon.post('/api/v1/getTaskTypeImage', { companyId: COMPANY_A, path: TASK_TYPE_IMAGE });
        expect(res.status).toBe(401);
        expect(JSON.stringify(res.body)).not.toContain('token=');
    });

    it('get 401 from POST /api/v1/getUserProfile (TSK-04)', async () => {
        const res = await anon.post('/api/v1/getUserProfile', { path: 'avatar.png' });
        expect(res.status).toBe(401);
        expect(JSON.stringify(res.body)).not.toContain('token=');
    });
});

describe('a user of company A asking for company B (TSK-03)', () => {
    it.each(['owner', 'admin', 'member', 'guest'])('%s is refused every read of company B', async (role) => {
        const { api } = await loginAs(role);
        expect((await api.get(`/api/v1/getBucket/${COMPANY_B}`)).status).toBe(403);
        expect((await api.get(`/api/v1/getBucketSize/${COMPANY_B}`)).status).toBe(403);
        expect((await api.get(`/api/v1/generateSignedUrl/${COMPANY_B}`, { query: { filepath: TASK_TYPE_IMAGE } })).status).toBe(403);
        expect((await api.withCompany(COMPANY_B).get(`/api/v1/getBucket/${COMPANY_B}`)).status).toBe(403);
    });

    it('member cannot mint a signed URL for company B through getTaskTypeImage', async () => {
        const { api } = await loginAs('member');
        const res = await api.post('/api/v1/getTaskTypeImage', { companyId: COMPANY_B, path: TASK_TYPE_IMAGE });
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain('token=');
    });

    it.each(['owner', 'member'])('%s cannot change, delete from or remove company B', async (role) => {
        const { api } = await loginAs(role);
        expect((await api.patch(`/api/v1/updateBucket/${COMPANY_B}`, { rule: { isPrivate: false } })).status).toBe(403);
        expect((await api.delete(`/api/v1/storage/removeFile/${COMPANY_B}`, { query: { filepath: TASK_TYPE_IMAGE } })).status).toBe(403);
        expect((await api.delete(`/api/v1/removeBucket/${COMPANY_B}`)).status).toBe(403);
    });

    it('member cannot climb out of their own bucket with a relative path', async () => {
        const { api } = await loginAs('member');
        const escape = `../${COMPANY_B}/${TASK_TYPE_IMAGE}`;
        expect((await api.get(`/api/v1/generateSignedUrl/${COMPANY_A}`, { query: { filepath: escape } })).status).toBe(400);
        expect((await api.delete(`/api/v1/storage/removeFile/${COMPANY_A}`, { query: { filepath: escape } })).status).toBe(400);
        expect((await api.post('/api/v1/getTaskTypeImage', { companyId: COMPANY_A, path: escape })).status).toBe(400);
        expect((await api.post('/api/v1/getUserProfile', { path: escape })).status).toBe(400);
    });
});

describe('changing or removing the own company bucket', () => {
    it.each(['admin', 'member', 'guest'])('is refused to a company %s', async (role) => {
        const owner = await loginAs('owner');
        const { api } = await loginAs(role);
        expect((await api.patch(`/api/v1/updateBucket/${COMPANY_A}`, { rule: { isPrivate: false } })).status).toBe(403);
        expect((await api.delete(`/api/v1/removeBucket/${COMPANY_A}`)).status).toBe(403);

        const after = await owner.api.get(`/api/v1/getBucket/${COMPANY_A}`);
        expect(after.status).toBe(200);
        expect(after.body.data.rule.isPrivate).toBe(true);
    });
});

describe('own-company flows still work', () => {
    it('owner reads their bucket and its size', async () => {
        const { api } = await loginAs('owner');
        const bucket = await api.get(`/api/v1/getBucket/${COMPANY_A}`);
        expect(bucket.status).toBe(200);
        expect(bucket.body).toMatchObject({ status: true, data: { id: COMPANY_A } });

        const size = await api.get(`/api/v1/getBucketSize/${COMPANY_A}`, { query: { unit: 'MB' } });
        expect(size.status).toBe(200);
        expect(size.body).toMatchObject({ status: true, data: { unit: 'MB' } });
    });

    it('member mints a signed URL for their company image and downloads it', async () => {
        const { api } = await loginAs('member');
        const res = await api.get(`/api/v1/generateSignedUrl/${COMPANY_A}`, { query: { filepath: TASK_TYPE_IMAGE, domainUrl: state.baseURL } });
        expect(res.status).toBe(200);
        const file = await fetch(res.body.url);
        expect(file.status).toBe(200);
    });

    it('member gets a task type image URL for their own company and downloads it', async () => {
        const { api } = await loginAs('member');
        const res = await api.post('/api/v1/getTaskTypeImage', { companyId: COMPANY_A, path: TASK_TYPE_IMAGE });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        const file = await fetch(res.body.statusText);
        expect(file.status).toBe(200);
    });

    it('a signed-in user without a company header gets a profile image URL', async () => {
        const member = await loginAs('member');
        const noCompany = createApiClient({ baseURL: state.baseURL, accessToken: member.accessToken });
        const res = await noCompany.post('/api/v1/getUserProfile', { path: 'avatar.png' });
        expect(res.status).toBe(200);
        expect(res.body.statusText).toContain('/api/v1/download/USER_PROFILES/avatar.png?token=');
    });
});
