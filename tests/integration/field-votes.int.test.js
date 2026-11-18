const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* The unit tests order two votes by hand on a database that runs one call at a time. Here several people vote in the
   same moment against MongoDB itself, and the count on the task has to be the number of voters stored. */

const state = readState();
const [task] = state.tasks;
const ROUNDS = 6;

jest.setTimeout(120000);

let client;
let fieldId;
let voters;

const voteAs = (session, vote) => session.api.post(`/api/v2/custom-fields/${fieldId}/vote`, { taskId: task._id, vote });

const stored = async () => {
    const db = client.db(state.companyId);
    const votes = await db.collection('customFieldLinks').findOne({ taskId: task._id, fieldId });
    const row = await db.collection('tasks').findOne({ _id: new ObjectId(task._id) }, { projection: { customField: 1 } });
    return { ids: [...votes.ids].sort(), version: votes.version, tally: row.customField[fieldId] };
};

const expectTallyOf = async (ids) => {
    const now = await stored();
    expect(now.ids).toEqual([...ids].sort());
    expect(now.tally.fieldValue).toBe(ids.length || undefined);
    expect(now.tally.version).toBe(now.version);
};

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    const owner = await loginAs('owner');
    const created = await owner.api.post('/api/v1/customField', {
        type: 'save',
        updateObject: { fieldTitle: `Upvotes ${uniqueSuffix()}`, fieldType: 'voting', type: 'task', global: false, isDelete: true, projectId: [task.projectId], fieldDescription: '' },
    });
    expect(created.status).toBe(200);
    fieldId = String(created.body._id);

    /* A role the permission matrix gives no access to custom fields is refused; the rest vote. */
    const sessions = await Promise.all(Object.keys(state.users).map((role) => loginAs(role)));
    const first = await Promise.all(sessions.map((session) => voteAs(session, true)));
    voters = sessions.filter((session, at) => first[at].status === 200);
});

afterAll(async () => {
    if (client) await client.close();
});

it('counts every vote cast in the same moment, and every withdrawal', async () => {
    expect(voters.length).toBeGreaterThanOrEqual(2);
    await expectTallyOf(voters.map((voter) => voter.uid));

    for (let round = 0; round < ROUNDS; round += 1) {
        const withdrawn = await Promise.all(voters.map((voter) => voteAs(voter, false)));
        expect(withdrawn.map((answer) => answer.status)).toEqual(voters.map(() => 200));
        await expectTallyOf([]);

        const cast = await Promise.all(voters.map((voter) => voteAs(voter, true)));
        expect(cast.map((answer) => answer.body.data.voted)).toEqual(voters.map(() => true));
        expect(Math.max(...cast.map((answer) => answer.body.data.count))).toBe(voters.length);
        await expectTallyOf(voters.map((voter) => voter.uid));
    }
});

it('keeps the count when votes and withdrawals cross', async () => {
    const [first, ...rest] = voters;
    for (let round = 0; round < ROUNDS; round += 1) {
        await Promise.all([voteAs(first, false), ...rest.map((voter) => voteAs(voter, true))]);
        await expectTallyOf(rest.map((voter) => voter.uid));
        await Promise.all([voteAs(first, true), ...rest.map((voter) => voteAs(voter, false))]);
        await expectTallyOf([first.uid]);
    }
});

it('stores one document for the task and the field however many first votes raced', async () => {
    const documents = await client.db(state.companyId).collection('customFieldLinks').countDocuments({ taskId: task._id, fieldId });
    expect(documents).toBe(1);
});
