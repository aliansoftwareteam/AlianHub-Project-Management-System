const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Follow-up 111: history and notification text is composed where each change is saved, so the
 * routes that stored text a caller wrote are gone. */

const state = readState();
const PROJECT = state.projects.shared;
const TASK = state.tasks[0];

jest.setTimeout(60000);

let client;
let member;
let owner;

const db = () => client.db(state.companyId);
const quiet = () => new Promise((resolve) => setTimeout(resolve, 1500));

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    [member, owner] = await Promise.all([loginAs('member'), loginAs('owner')]);
});

afterAll(async () => {
    if (client) await client.close();
});

describe('the generic history and notification routes', () => {
    it('no longer store history text a caller writes', async () => {
        const message = `<b>crafted ${uniqueSuffix()}</b>`;
        const res = await member.api.post('/api/v1/handleHistory', {
            type: 'project', companyId: state.companyId, projectId: PROJECT._id, taskId: null,
            object: { key: 'Project_Name', message },
            userData: { id: owner.uid, Employee_Name: 'Olivia Owner', companyOwnerId: owner.uid },
        });
        expect(res.status).toBe(404);
        await quiet();
        expect(await db().collection('history').countDocuments({ Message: message })).toBe(0);
    });

    it('no longer send notification text a caller writes', async () => {
        const message = `crafted notice ${uniqueSuffix()}`;
        const res = await member.api.post('/api/v1/handleNotification', {
            type: 'tasks', companyId: state.companyId, projectId: PROJECT._id, taskId: TASK._id, sprintId: TASK.sprintId, folderId: '',
            object: { key: "comments_I'm_@mentioned_in", message },
            userData: { id: member.uid, Employee_Name: 'Max Member', companyOwnerId: owner.uid },
        });
        expect(res.status).toBe(404);
        await quiet();
        expect(await db().collection('notifications').countDocuments({ message })).toBe(0);
    });
});
