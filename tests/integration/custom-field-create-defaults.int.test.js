const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();

jest.setTimeout(60000);

let client;
let owner;
let project;

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    owner = await loginAs('owner');
    project = await createProject(owner.api, { name: `Custom field defaults ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
});

afterAll(async () => {
    if (client) await client.close();
});

it('creates a custom field sent without isDelete, stored as not deleted', async () => {
    const title = `Budget ${uniqueSuffix()}`;
    const res = await owner.api.post('/api/v1/customField', {
        type: 'save',
        updateObject: { fieldTitle: title, fieldType: 'text', type: 'project', global: false, projectId: [String(project._id)], fieldPlaceholder: '', fieldDescription: '' },
    });
    expect(res.status).toBe(200);

    const stored = await client.db(state.companyId).collection('customFields').findOne({ _id: new ObjectId(String(res.body._id)) })
        || await client.db(state.companyId).collection('customField').findOne({ _id: new ObjectId(String(res.body._id)) });
    expect(stored).toMatchObject({ fieldTitle: title, isDelete: false });
});
