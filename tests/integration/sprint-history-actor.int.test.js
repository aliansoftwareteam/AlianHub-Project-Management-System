const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createApiClient } = require('../../e2e/support/api');
const { PASSWORD, assertOk, createProject, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Follow-up 102. A sprint or folder history line names whoever is signed in, so the same
 * request sent with somebody else's name and id in the body still records the session's. */

const state = readState();
const DEADLINE_MS = 15000;
const OTHER_NAME = 'Someone Else';

let client;
let owner;
let member;

const db = () => client.db(state.companyId);

/* Every test makes its own project, so its history is the only history under that id. */
const historyRows = async (projectId, key, needle) => {
    const rows = await db().collection('history').find({ ProjectId: String(projectId) }).toArray();
    return rows.filter((row) => row.Key === key && String(row.Message || '').includes(needle));
};

const waitForHistory = async (projectId, key, needle) => {
    const deadline = Date.now() + DEADLINE_MS;
    for (;;) {
        const found = await historyRows(projectId, key, needle);
        if (found.length) return found[0];
        if (Date.now() > deadline) throw new Error(`no "${key}" history mentioning "${needle}" within ${DEADLINE_MS}ms`);
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
};

const freshProject = (assigneeIds = [owner.uid]) => createProject(owner.api, {
    name: `SHA ${uniqueSuffix()}`, assigneeIds, createdBy: owner.uid,
});

const claimedBy = (user) => ({ id: user.uid, Employee_Name: OTHER_NAME, companyOwnerId: user.uid });

const addSprint = (api, project, sprintName, extra = {}) => api.post('/api/v1/sprint', {
    companyId: state.companyId,
    projectId: project._id,
    projectName: project.ProjectName,
    sprintName,
    userData: claimedBy(member),
    ...extra,
});

const patchSprint = (api, id, body) => api.patch(`/api/v1/sprint/${id}`, { companyId: state.companyId, userData: claimedBy(member), ...body });

const patchFolder = (api, id, body) => api.patch(`/api/v1/folder/${id}`, { companyId: state.companyId, userData: claimedBy(member), ...body });

const sprintIn = async (project, name) => {
    const created = assertOk(await addSprint(owner.api, project, name), `create sprint ${name}`);
    return String(created.data._id);
};

const folderIn = async (project, name) => {
    const created = assertOk(await owner.api.post('/api/v1/folder', {
        companyId: state.companyId, projectId: project._id, projectName: project.ProjectName, folderName: name, userData: claimedBy(member),
    }), `create folder ${name}`);
    return String(created.data._id);
};

/* A second signed-in user whose own name carries the characters the history message escapes. */
const registerAdmin = async (firstName, lastName) => {
    const email = `sha-${uniqueSuffix()}@e2e.alianhub.test`;
    const invited = await owner.api.post('/api/v2/sendInvitationEmail', {
        email, companyId: state.companyId, companyName: state.companyName, role: 2, designation: 0,
    });
    const row = invited.body && invited.body.data;
    if (!row || !row._id) throw new Error(`invite failed (${invited.status}): ${JSON.stringify(invited.body).slice(0, 300)}`);

    const anon = createApiClient({ baseURL: state.baseURL });
    assertOk(await anon.post('/api/v2/createUser', {
        firstName, lastName, email, password: PASSWORD, isInvitation: true, assignCompany: state.companyId,
        memberId: String(row._id), linkId: row.linkId,
    }), `register ${email}`);

    const session = await login(state.baseURL, email);
    const api = createApiClient({ baseURL: state.baseURL, accessToken: session.accessToken, companyId: state.companyId });
    assertOk(await api.put('/api/v1/root-members', { id: String(row._id), data: { userId: session.uid, status: 2 }, companyId: state.companyId, linkId: row.linkId }), `accept ${email}`);
    return { uid: String(session.uid), api };
};

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    owner = await loginAs('owner');
    member = await loginAs('member');
});

afterAll(async () => {
    if (client) await client.close();
});

describe('a sprint history line names the signed-in user', () => {
    it('records the session on a sprint create', async () => {
        const project = await freshProject();
        const name = `SHA created ${uniqueSuffix()}`;
        assertOk(await addSprint(owner.api, project, name), 'create sprint');

        const row = await waitForHistory(project._id, 'Create_Sprint', name);
        expect(String(row.UserId)).toBe(owner.uid);
        expect(row.Message).toContain('Olivia Owner');
        expect(row.Message).not.toContain(OTHER_NAME);
    });

    it('records the session on a sprint rename', async () => {
        const project = await freshProject();
        const sprintId = await sprintIn(project, `SHA before ${uniqueSuffix()}`);
        const renamed = `SHA renamed ${uniqueSuffix()}`;

        assertOk(await patchSprint(owner.api, sprintId, {
            type: 'editSprintName', projectId: project._id, projectName: project.ProjectName, sprintName: renamed, prevData: { name: 'SHA before' },
        }), 'rename sprint');

        const row = await waitForHistory(project._id, 'Create_Sprint', renamed);
        expect(String(row.UserId)).toBe(owner.uid);
        expect(row.Message).toContain('Olivia Owner');
        expect(row.Message).not.toContain(OTHER_NAME);
    });

    it('records the session on a sprint archive', async () => {
        const project = await freshProject();
        const name = `SHA archived ${uniqueSuffix()}`;
        const sprintId = await sprintIn(project, name);

        assertOk(await patchSprint(owner.api, sprintId, {
            type: 'updateSprint', projectId: project._id, sprintName: name, updatedValueDeleteStatusKey: 2,
            updateObject: { $set: { deletedStatusKey: 2 } }, projectData: { id: project._id, ProjectName: project.ProjectName },
        }), 'archive sprint');

        const row = await waitForHistory(project._id, 'project_sprint', name);
        expect(String(row.UserId)).toBe(owner.uid);
        expect(row.Message).toContain('Olivia Owner');
        expect(row.Message).not.toContain(OTHER_NAME);
    });
});

describe('a folder history line names the signed-in user', () => {
    it('records the session on a folder create', async () => {
        const project = await freshProject();
        const folderName = `SHA folder ${uniqueSuffix()}`;
        await folderIn(project, folderName);

        const row = await waitForHistory(project._id, 'Create_Folder', folderName);
        expect(String(row.UserId)).toBe(owner.uid);
        expect(row.Message).toContain('Olivia Owner');
        expect(row.Message).not.toContain(OTHER_NAME);
    });

    it('records the session on a folder rename', async () => {
        const project = await freshProject();
        const before = `SHA folder ${uniqueSuffix()}`;
        const folderId = await folderIn(project, before);
        const renamed = `SHA folder renamed ${uniqueSuffix()}`;

        assertOk(await patchFolder(owner.api, folderId, {
            type: 'editFolderName', projectId: project._id, projectName: project.ProjectName, folderName: renamed, prevFolderName: before,
        }), 'rename folder');

        const row = await waitForHistory(project._id, 'Create_Folder', renamed);
        expect(String(row.UserId)).toBe(owner.uid);
        expect(row.Message).toContain('Olivia Owner');
        expect(row.Message).not.toContain(OTHER_NAME);
    });

    it('records the session on a folder archive', async () => {
        const project = await freshProject();
        const folderName = `SHA folder archived ${uniqueSuffix()}`;
        const folderId = await folderIn(project, folderName);

        assertOk(await patchFolder(owner.api, folderId, {
            type: 'updateFolder', projectId: project._id, folderName, updatedValueDeleteStatusKey: 2, sprints: [],
            updateObject: { $set: { deletedStatusKey: 2 } }, projectData: { id: project._id, ProjectName: project.ProjectName },
        }), 'archive folder');

        const row = await waitForHistory(project._id, 'project_sprint_removed', folderName);
        expect(String(row.UserId)).toBe(owner.uid);
        expect(row.Message).toContain('Olivia Owner');
        expect(row.Message).not.toContain(OTHER_NAME);
    });
});

describe('the name the session carries', () => {
    it('is escaped exactly once', async () => {
        const actor = await registerAdmin('Amp&', '<Co>');
        const project = await freshProject([owner.uid, actor.uid]);
        const name = `SHA escaped ${uniqueSuffix()}`;

        assertOk(await addSprint(actor.api, project, name), 'create sprint as the escaped-name user');

        const row = await waitForHistory(project._id, 'Create_Sprint', name);
        expect(String(row.UserId)).toBe(actor.uid);
        expect(row.Message).toContain('Amp&amp; &lt;Co&gt;');
        expect(row.Message).not.toContain('&amp;amp;');
    });
});
