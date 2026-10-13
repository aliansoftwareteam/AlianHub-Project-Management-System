const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { listSprints, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const COMPANY_B = crypto.randomBytes(12).toString('hex');
const SUFFIX = uniqueSuffix().toLowerCase();

jest.setTimeout(120000);

let client;
let db;
let owner;
let target;

const people = {
    outsider: { _id: new ObjectId(), email: `outsider.${SUFFIX}@elsewhere.test`, name: `outsider ${SUFFIX}` },
    removed: { _id: new ObjectId(), email: `removed.${SUFFIX}@e2e.alianhub.test`, name: `removed ${SUFFIX}` },
    invited: { _id: new ObjectId(), email: `invited.${SUFFIX}@e2e.alianhub.test`, name: `invited ${SUFFIX}` },
};
const unknownEmail = `nobody.${SUFFIX}@nowhere.test`;
const memberId = () => String(state.users.member.userId);
const memberEmail = () => String(state.users.member.email).toLowerCase();
const foreignIds = () => Object.values(people).map((person) => String(person._id));

const label = (what) => `[QA import people] ${what} ${uniqueSuffix()}`;
const assigneesOf = async (name) => {
    const task = await db.collection('tasks').findOne({ TaskName: name });
    expect(task).toBeTruthy();
    return (task.AssigneeUserId || []).map(String);
};

const preview = (rows, options = {}) => owner.api.post('/api/v2/imports/csv/preview', {
    rows,
    mapping: { taskName: 'Task Name', assignee: 'Assignee' },
    projectId: target.projectId,
    options,
});

const importBody = (extra) => ({ projectId: target.projectId, sprintId: target.sprintId, userData: { id: String(owner.userId) }, ...extra });

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db(String(state.companyId));
    owner = await loginAs('owner');
    const [sprint] = await listSprints(owner.api, state.projects.shared._id);
    target = { projectId: String(state.projects.shared._id), sprintId: String(sprint._id || sprint.id) };

    await client.db('global').collection('users').insertMany(Object.values(people).map((person) => ({
        _id: person._id, Employee_Email: person.email, Employee_Name: person.name, AssignCompany: [],
    })));
    await client.db(COMPANY_B).collection('company_users').insertOne({ userId: String(people.outsider._id), userEmail: people.outsider.email, roleType: 3, status: 2 });
    await db.collection('company_users').insertMany([
        { userId: String(people.removed._id), userEmail: people.removed.email, roleType: 3, status: 2, isDelete: true },
        { userId: String(people.invited._id), userEmail: people.invited.email, roleType: 3, status: 1 },
    ]);
});

afterAll(async () => {
    if (!client) return;
    await client.db('global').collection('users').deleteMany({ _id: { $in: Object.values(people).map((person) => person._id) } }).catch(() => {});
    await db.collection('company_users').deleteMany({ userId: { $in: [String(people.removed._id), String(people.invited._id)] } }).catch(() => {});
    await client.db(COMPANY_B).dropDatabase().catch(() => {});
    await client.close();
});

describe('the CSV preview resolves people among the company\'s active members', () => {
    const answerFor = async (value) => {
        const res = await preview([
            { 'Task Name': 'one', Assignee: memberEmail() },
            { 'Task Name': 'two', Assignee: value },
        ]);
        expect(res.body.status).toBe(true);
        return JSON.stringify(res.body.data).split(value).join('<person>');
    };

    it.each([
        ['an email of another company\'s member', () => people.outsider.email],
        ['a name of another company\'s member', () => people.outsider.name],
        ['a removed member of this company', () => people.removed.email],
        ['an invitation not yet accepted', () => people.invited.email],
    ])('answers for %s exactly as for an unknown email', async (_what, value) => {
        expect(await answerFor(value())).toEqual(await answerFor(unknownEmail));
    });

    it('matches a member of the company by email', async () => {
        const res = await preview([{ 'Task Name': 'one', Assignee: memberEmail() }]);
        expect(res.body.data.matchedUsers.map((user) => user.id)).toEqual([memberId()]);
        expect(res.body.data.unknownUsers).toEqual([]);
    });
});

describe('an import assigns only the company\'s active members', () => {
    it('leaves a CSV row naming another company\'s member unassigned and assigns the member', async () => {
        const outside = label('csv outsider');
        const inside = label('csv member');
        const res = await owner.api.post('/api/v2/imports/csv', importBody({
            rows: [{ 'Task Name': outside, Assignee: people.outsider.email }, { 'Task Name': inside, Assignee: memberEmail() }],
            mapping: { taskName: 'Task Name', assignee: 'Assignee' },
        }));
        expect(res.body.status).toBe(true);
        expect(await assigneesOf(outside)).not.toContain(String(people.outsider._id));
        expect(await assigneesOf(inside)).toContain(memberId());
    });

    it('drops a CSV person mapping that points outside the company\'s active members', async () => {
        const names = { outsider: label('map outsider'), removed: label('map removed'), member: label('map member') };
        const res = await owner.api.post('/api/v2/imports/csv', importBody({
            rows: [
                { 'Task Name': names.outsider, Assignee: 'Someone A' },
                { 'Task Name': names.removed, Assignee: 'Someone B' },
                { 'Task Name': names.member, Assignee: 'Someone C' },
            ],
            mapping: { taskName: 'Task Name', assignee: 'Assignee' },
            options: { userMap: { 'Someone A': String(people.outsider._id), 'Someone B': String(people.removed._id), 'Someone C': memberId() } },
        }));
        expect(res.body.status).toBe(true);
        expect(await assigneesOf(names.outsider)).toEqual([]);
        expect(await assigneesOf(names.removed)).toEqual([]);
        expect(await assigneesOf(names.member)).toEqual([memberId()]);
    });

    it('leaves a Trello card with another company\'s member unassigned and assigns the member', async () => {
        const outside = label('trello outsider');
        const inside = label('trello member');
        const res = await owner.api.post('/api/v2/imports/trello', importBody({
            board: {
                name: 'board',
                lists: [{ id: 'l1', name: 'To Do', closed: false }],
                members: [{ id: 'm1', email: people.outsider.email }, { id: 'm2', email: memberEmail() }, { id: 'm3', email: people.removed.email }],
                cards: [
                    { id: 'c1', name: outside, idList: 'l1', closed: false, idMembers: ['m1', 'm3'] },
                    { id: 'c2', name: inside, idList: 'l1', closed: false, idMembers: ['m2'] },
                ],
            },
        }));
        expect(res.body.status).toBe(true);
        const outsideAssignees = await assigneesOf(outside);
        foreignIds().forEach((id) => expect(outsideAssignees).not.toContain(id));
        expect(await assigneesOf(inside)).toContain(memberId());
    });

    it('leaves an Asana task with another company\'s member unassigned and assigns the member', async () => {
        const outside = label('asana outsider');
        const inside = label('asana member');
        const res = await owner.api.post('/api/v2/imports/asana', importBody({
            asana: { tasks: [
                { name: outside, assignee: { email: people.outsider.email } },
                { name: inside, assignee: { email: memberEmail() } },
            ] },
        }));
        expect(res.body.status).toBe(true);
        expect(await assigneesOf(outside)).not.toContain(String(people.outsider._id));
        expect(await assigneesOf(inside)).toContain(memberId());
    });

    it('leaves a Jira row naming another company\'s member unassigned', async () => {
        const name = label('jira outsider');
        const res = await owner.api.post('/api/v2/imports/jira', importBody({ rows: [{ Summary: name, Assignee: people.outsider.email }] }));
        expect(res.body.status).toBe(true);
        expect(await assigneesOf(name)).not.toContain(String(people.outsider._id));
    });
});
