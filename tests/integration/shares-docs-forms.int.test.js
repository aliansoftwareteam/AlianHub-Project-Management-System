const { createApiClient } = require('../../e2e/support/api');
const { createProject, listSprints, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anon = createApiClient({ baseURL: state.baseURL });
const refused = (res) => res.status >= 400 || (res.body && res.body.status === false);

const urlencoded = async (path, fields) => {
    const res = await fetch(new URL(path, state.baseURL), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
        redirect: 'manual',
    });
    return { status: res.status, text: await res.text() };
};

const sprintOf = async (api, projectId) => String((await listSprints(api, projectId))[0]._id);
const privateProject = (owner) => createProject(owner.api, { name: `PAG Private ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
const sharedProject = (owner) => createProject(owner.api, { name: `PAG Shared ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });

async function makeLiveForm(owner, project) {
    const sprintId = await sprintOf(owner.api, project._id);
    const created = await owner.api.post('/api/v2/forms', { title: `[QA pages] form ${uniqueSuffix()}`, projectId: project._id, sprintId });
    const formId = created.body.data._id;
    await owner.api.put(`/api/v2/forms/${formId}`, { questions: [{ id: 'qname', label: 'Request title', mapTo: 'TaskName', required: true }] });
    const pub = await owner.api.post(`/api/v2/forms/${formId}/publish`, { publish: true });
    return { formId, token: pub.body.data.token, sprintId };
}

describe('pages findings (regressions)', () => {
    it('PAG-08: a guest cannot mint a public link to a sprint of a project they are not in', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const priv = await privateProject(owner);
        const sprintId = await sprintOf(owner.api, priv._id);
        const res = await guest.api.post('/api/v2/public-shares', { entityType: 'sprint', entityId: sprintId });
        expect(refused(res)).toBe(true);
        expect(res.status).toBe(404);
    });

    it('PAG-08: a guest cannot read, disable or revoke the owner\'s link to a private sprint', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const priv = await privateProject(owner);
        const sprintId = await sprintOf(owner.api, priv._id);
        const share = await owner.api.post('/api/v2/public-shares', { entityType: 'sprint', entityId: sprintId });
        expect(share.body.status).toBe(true);
        const token = share.body.data.token;

        const read = await guest.api.get(`/api/v2/public-shares?entityId=${sprintId}`);
        expect(JSON.stringify(read.body)).not.toContain(token);
        expect(refused(await guest.api.put(`/api/v2/public-shares/${share.body.data._id}`, { enabled: false }))).toBe(true);
        expect(refused(await guest.api.delete(`/api/v2/public-shares/${share.body.data._id}`))).toBe(true);
        expect((await anon.get(`/share/${token}`)).status).toBe(200);

        await owner.api.delete(`/api/v2/public-shares/${share.body.data._id}`);
        expect((await anon.get(`/share/${token}`)).status).toBe(404);
    });

    it('PAG-09: a guest cannot read docs of a project they are not in', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const priv = await privateProject(owner);
        const page = await owner.api.post('/api/v2/pages', { title: `[QA pages] hidden ${uniqueSuffix()}`, projectId: priv._id });
        const list = await guest.api.get(`/api/v2/pages?projectId=${priv._id}`);
        expect((list.body.data || []).length).toBe(0);
        expect(refused(await guest.api.get(`/api/v2/pages/${page.body.data._id}`))).toBe(true);
        expect((await owner.api.get(`/api/v2/pages/${page.body.data._id}`)).body.status).toBe(true);
    });

    it('PAG-09: a guest cannot read a form of a project they are not in', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const priv = await privateProject(owner);
        const form = await owner.api.post('/api/v2/forms', { title: `[QA pages] hidden form ${uniqueSuffix()}`, projectId: priv._id });
        const res = await guest.api.get(`/api/v2/forms/${form.body.data._id}/submissions`);
        expect(refused(res)).toBe(true);
        expect(refused(await guest.api.get(`/api/v2/forms/${form.body.data._id}`))).toBe(true);
        expect((await owner.api.get(`/api/v2/forms/${form.body.data._id}/submissions`)).body.status).toBe(true);
    });

    it('PAG-10: a member cannot delete another user\'s private doc', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const project = await sharedProject(owner);
        const priv = await owner.api.post('/api/v2/pages', { title: `[QA pages] mine ${uniqueSuffix()}`, projectId: project._id, visibility: 'private' });
        const res = await member.api.delete(`/api/v2/pages/${priv.body.data._id}`);
        expect(refused(res)).toBe(true);
        expect((await owner.api.get(`/api/v2/pages/${priv.body.data._id}`)).body.status).toBe(true);
        expect((await owner.api.delete(`/api/v2/pages/${priv.body.data._id}`)).body.status).toBe(true);
    });

    it('PAG-11: a form submission records the key of the task it filed', async () => {
        const owner = await loginAs('owner');
        const project = await sharedProject(owner);
        const { formId, token } = await makeLiveForm(owner, project);
        await urlencoded(`/form/${token}`, { qname: `[QA pages] keyed ${uniqueSuffix()}` });
        const subs = await owner.api.get(`/api/v2/forms/${formId}/submissions`);
        expect(subs.body.data.submissions[0].taskKey).toBeTruthy();
    });
});
