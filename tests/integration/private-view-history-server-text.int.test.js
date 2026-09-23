const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Follow-up 111: private views are saved on the member, and the project history row is written by the server. */

const state = readState();
const DEADLINE_MS = 10000;
const HTML = '<img src=x onerror=alert(1)>';
const ESCAPED = '&lt;img src=x onerror=alert&#40;1&#41;&gt;';

jest.setTimeout(60000);

let client;
let owner;
let member;
let memberRowId;
let project;
let hidden;

const db = () => client.db(state.companyId);
const historyOf = (projectId) => db().collection('history').find({ ProjectId: String(projectId), Key: 'Project_Name' }).sort({ _id: 1 }).toArray();
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
const rowCount = (projectId, count, what) => waitFor(async () => { const rows = await historyOf(projectId); return rows.length >= count ? rows : null; }, what);
const quiet = () => new Promise((resolve) => setTimeout(resolve, 1000));

const privateView = (body) => member.api.post('/api/v1/members/private-view', { id: memberRowId, ...body });

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    [owner, member] = await Promise.all([loginAs('owner'), loginAs('member')]);
    const row = await db().collection('company_users').findOne({ userId: member.uid });
    memberRowId = String(row._id);
    project = await createProject(owner.api, { name: `FU111 private views ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
    hidden = await createProject(owner.api, { name: `FU111 hidden ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
});

afterAll(async () => {
    if (client) await client.close();
});

describe('a private view', () => {
    it('writes the project history row for the member who added, renamed and removed it', async () => {
        const memberName = await nameOf(member.uid);
        const id = `pv${uniqueSuffix()}`;

        let res = await privateView({ operation: 'push', data: { id, name: 'Board', keyName: 'ProjectKanban', isPin: true, isPrivate: true, projectId: String(project._id) } });
        expect(res.status).toBe(200);
        let rows = await rowCount(project._id, 1, 'the added row');
        expect(rows.map((row) => row.Message)).toEqual([`<b>${memberName}</b> has added the <b> pinned private View </b> as <b>Board</b>`]);
        expect(String(rows[0].UserId)).toBe(member.uid);

        const embed = `pe${uniqueSuffix()}`;
        await privateView({ operation: 'push', data: { id: embed, name: 'Sheet', url: 'https://example.com', isPin: false, isPrivate: true, projectId: String(project._id) } });
        await privateView({ operation: 'update', key: 'name', data: { id: embed, name: HTML } });
        await privateView({ operation: 'delete', data: { id: embed } });
        rows = await rowCount(project._id, 4, 'the embed rows');
        expect(rows.slice(1).map((row) => row.Message)).toEqual([
            `<b>${memberName}</b> has added the <b>  private Embed View </b> as <b>Sheet</b>`,
            `<b>${memberName}</b> has changed the  <b> Embed View name </b> as <b> ${ESCAPED} </b>  from <b>Sheet </b>`,
            `<b> ${memberName} </b> has deleted the  <b> Embed View ${ESCAPED} </b>`,
        ]);
    });

    it('writes nothing to a project the member cannot see', async () => {
        const res = await privateView({ operation: 'push', data: { id: `ph${uniqueSuffix()}`, name: 'Peek', keyName: 'ProjectKanban', isPrivate: true, projectId: String(hidden._id) } });
        expect(res.status).toBe(200);
        await quiet();
        expect(await historyOf(hidden._id)).toEqual([]);
    });

    it('writes nothing when a rename keeps the name', async () => {
        const id = `pr${uniqueSuffix()}`;
        await privateView({ operation: 'push', data: { id, name: 'Same', url: 'https://example.com', isPrivate: true, projectId: String(project._id) } });
        const before = (await rowCount(project._id, 5, 'the added row')).length;
        await privateView({ operation: 'update', key: 'name', data: { id, name: 'Same' } });
        await quiet();
        expect(await historyOf(project._id)).toHaveLength(before);
    });
});
