const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Follow-up 111: project source, proposal ID and custom fields are described on the server. Every read is scoped to a project this suite created. */

const state = readState();
const DEADLINE_MS = 10000;
const HTML = '<img src=x onerror=alert(1)>';

jest.setTimeout(60000);

let client;
let owner;
let project;

const db = () => client.db(state.companyId);
const historyOf = (key) => db().collection('history').find({ ProjectId: String(project._id), Key: key }).toArray();
const nameOf = async (uid) => (await client.db('global').collection('users').findOne({ _id: new ObjectId(String(uid)) })).Employee_Name;

const waitFor = async (read, what) => {
    const deadline = Date.now() + DEADLINE_MS;
    for (;;) {
        const found = await read();
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`${what} did not happen within ${DEADLINE_MS}ms`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
};
const rowsOf = (read, what) => waitFor(async () => { const rows = await read(); return rows.length ? rows : null; }, what);
const quiet = () => new Promise((resolve) => setTimeout(resolve, 500));

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    owner = await loginAs('owner');
    project = await createProject(owner.api, { name: `FU111 detail ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
});

afterAll(async () => {
    if (client) await client.close();
});

describe('a project source change', () => {
    it('stores the server text, not the text the generic route is sent', async () => {
        const res = await owner.api.put(`/api/v1/project/${project._id}`, { updateObject: { source: 'fiverr' } });
        expect(res.status).toBe(200);

        const ownerName = await nameOf(owner.uid);
        const [row] = await rowsOf(() => historyOf('Project_Source'), 'the source row');
        expect(row.Message).toBe(`<b>${ownerName}</b> has changed <b> Source</b> as <b>Fiverr</b>.`);

        await owner.api.post('/api/v1/handleHistory', {
            type: 'project', companyId: state.companyId, projectId: String(project._id), taskId: null,
            object: { key: 'Project_Source', message: `<b>${HTML}</b>` },
            userData: { id: owner.uid, Employee_Name: HTML, companyOwnerId: owner.uid },
        });
        await quiet();
        expect((await historyOf('Project_Source')).map((found) => found.Message)).toEqual([row.Message]);
    });
});

describe('a project custom field', () => {
    it('records its creation and its value from stored names', async () => {
        const title = `Client ${uniqueSuffix()}`;
        const created = await owner.api.post('/api/v1/customField', {
            type: 'save',
            updateObject: { fieldTitle: title, fieldType: 'text', type: 'project', global: false, projectId: [String(project._id)], fieldPlaceholder: '', fieldDescription: '', isDelete: false },
        });
        expect(created.status).toBe(200);
        const fieldId = String(created.body._id);

        const res = await owner.api.put(`/api/v1/project/${project._id}`, { updateObject: { [`customField.${fieldId}`]: { _id: fieldId, fieldValue: `ACME ${HTML}` } } });
        expect(res.status).toBe(200);

        const ownerName = await nameOf(owner.uid);
        const rows = await waitFor(async () => {
            const found = await historyOf('Project_CustomField');
            return found.length >= 2 ? found : null;
        }, 'the custom field rows');
        expect(rows.map((row) => row.Message).sort()).toEqual([
            `<b>${ownerName}</b> has Created <b> Custom Field </b> as <b>${title}</b> for project.`,
            `<b>${ownerName}</b> has added value in <b> ${title}</b> Custom Field as <b>ACME &lt;img src=x onerror=alert&#40;1&#41;&gt;</b> for project.`,
        ].sort());
    });
});
