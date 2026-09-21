const crypto = require('node:crypto');
const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();
const anon = createApiClient({ baseURL: state.baseURL });
const COMPANY_A = state.companyId;
const TASK_TYPE_IMAGE = 'setting/task_type/task.png';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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

    it('a signed-in user without a company header gets their own profile image URL', async () => {
        const member = await loginAs('member');
        const avatar = `${member.uid}_${crypto.randomBytes(3).toString('hex')}_avatar.png`;
        expect((await member.api.post('/api/v1/storage/uploadFileBase64', { companyId: 'USER_PROFILES', path: avatar, key: 'userProfile', base64String: PNG, isUserProfile: true })).status).toBe(200);

        const noCompany = createApiClient({ baseURL: state.baseURL, accessToken: member.accessToken });
        const res = await noCompany.post('/api/v1/getUserProfile', { path: avatar });
        expect(res.status).toBe(200);
        expect(res.body.statusText).toContain(`/api/v1/download/USER_PROFILES/${avatar}?token=`);

        await member.api.delete('/api/v1/storage/removeFile/USER_PROFILES', { query: { filepath: avatar, thubmkey: 'userProfile' } });
    });
});

describe('signed downloads follow the record that owns the file', () => {
    const [task, otherTask] = state.tasks;
    const ownKey = `Project/${task.projectId}/Sprint/${task._id}/Attachment/dl-${crypto.randomBytes(4).toString('hex')}.png`;

    it('a member downloads an attachment of a task they can open', async () => {
        const { api } = await loginAs('member');
        expect((await api.post('/api/v1/storage/uploadFileBase64', { companyId: COMPANY_A, path: ownKey, base64String: PNG })).status).toBe(200);
        const res = await api.get(`/api/v1/generateSignedUrl/${COMPANY_A}`, { query: { filepath: ownKey, domainUrl: state.baseURL } });
        expect(res.status).toBe(200);
        expect((await fetch(res.body.url)).status).toBe(200);
    });

    it.each([
        ['a file of a private project they are not on', `Project/${state.projects.restricted._id}/ProjectAttachment/dl-brief.pdf`],
        ['a key outside every layout the app writes', 'dl-backups/company.zip'],
    ])('a member is refused %s, without a signed link', async (_label, filepath) => {
        const { api } = await loginAs('member');
        const res = await api.get(`/api/v1/generateSignedUrl/${COMPANY_A}`, { query: { filepath, domainUrl: state.baseURL } });
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ status: false, code: 'STORED_FILE_NOT_AVAILABLE' });
        expect(JSON.stringify(res.body)).not.toContain('token=');
    });

    it('an attachment naming another task\'s file is refused on write', async () => {
        const { api } = await loginAs('owner');
        const res = await api.patch('/api/v2/tasks', {
            action: 'updateAttachments', companyId: COMPANY_A, sprintId: task.sprintId, taskId: task._id,
            taskData: { _id: task._id, ProjectID: task.projectId, attachments: [] }, id: '', operation: 'add',
            data: { id: 'dl1', filename: 'dl.png', url: `Project/${task.projectId}/Sprint/${otherTask._id}/Attachment/dl.png` },
            projectData: { id: task.projectId, ProjectName: 'E2E Shared Project' },
        });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ status: false, code: 'ATTACHMENT_KEY_NOT_OWN' });
    });
});
