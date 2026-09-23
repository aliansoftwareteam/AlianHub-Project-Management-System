const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, firstSprint, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* A private sprint's members and a chat channel's people accept only active members of the verified company,
 * and `tId_` team references only to this company's teams. Removing someone is never checked. */

const state = readState();
const SECOND_COMPANY = crypto.randomBytes(12).toString('hex');
const OUTSIDER = new ObjectId().toHexString();
const INVITEE = new ObjectId().toHexString();
const NOBODY = new ObjectId().toHexString();
const OWN_TEAM = new ObjectId();
const FOREIGN_TEAM = new ObjectId();

let client;
let owner;
let member;
let project;
let sprintId;

const db = () => client.db(state.companyId);
const storedSprint = () => db().collection('sprints').findOne({ _id: new ObjectId(sprintId) });
const userData = () => ({ id: owner.uid, Employee_Name: 'Olivia Owner', companyOwnerId: owner.uid });

const patchSprint = (updateObject) => owner.api.patch(`/api/v1/sprint/${sprintId}`, {
    companyId: state.companyId, projectId: project._id, folderId: null, type: 'updateSprint', updateObject, userData: userData(),
    sprintName: 'List', projectData: { id: project._id, ProjectName: project.ProjectName }, folderName: '', historyData: { type: 'added', userName: 'Someone' },
});

const putSprint = (updateObject, key) => owner.api.put(`/api/v1/project/sprint/${sprintId}`, key ? { updateObject, key } : { updateObject });

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    await client.db(SECOND_COMPANY).collection('company_users').insertOne({
        companyId: SECOND_COMPANY, userId: OUTSIDER, userEmail: 'otto@outside.test', roleType: 3, designation: 0, status: 2, isDelete: false,
    });
    await client.db(SECOND_COMPANY).collection('teams_management').insertOne({ _id: FOREIGN_TEAM, name: 'Their team', assigneeUsersArray: [OUTSIDER] });
    await db().collection('company_users').insertOne({
        companyId: state.companyId, userId: INVITEE, userEmail: 'ivy@invited.test', roleType: 3, designation: 0, status: 1, isDelete: false,
    });
    owner = await loginAs('owner');
    member = await loginAs('member');
    await db().collection('teams_management').insertOne({ _id: OWN_TEAM, name: 'Our team', assigneeUsersArray: [member.uid] });
    project = await createProject(owner.api, { name: `SPM ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
    const sprint = await firstSprint(owner.api, project._id);
    sprintId = String(sprint._id || sprint.id);
    await db().collection('sprints').updateOne({ _id: new ObjectId(sprintId) }, { $set: { private: true, AssigneeUserId: [owner.uid], watchers: [owner.uid] } });
});

afterAll(async () => {
    if (!client) return;
    await db().collection('company_users').deleteMany({ userId: INVITEE });
    await db().collection('teams_management').deleteOne({ _id: OWN_TEAM });
    await client.db(SECOND_COMPANY).dropDatabase();
    await client.close();
});

describe('private sprint members', () => {
    it.each([
        ['adds another company\'s user', { $addToSet: { AssigneeUserId: OUTSIDER, watchers: OUTSIDER } }, OUTSIDER],
        ['adds a pending invitee', { $addToSet: { AssigneeUserId: INVITEE } }, INVITEE],
        ['makes the sprint private for an id nobody holds', { $set: { private: true, AssigneeUserId: [NOBODY] } }, NOBODY],
        ['adds another company\'s team', { $push: { AssigneeUserId: { $each: [`tId_${FOREIGN_TEAM}`] } } }, `tId_${FOREIGN_TEAM}`],
        ['adds another company\'s user as a watcher only', { $addToSet: { watchers: OUTSIDER } }, OUTSIDER],
    ])(
        'refuses an update that %s',
        async (_, update, named) => {
            const res = await patchSprint(update);
            expect([res.status, res.body.status]).toEqual([400, false]);
            expect(JSON.stringify(await storedSprint())).not.toContain(named);
        },
    );

    it('refuses the same through the project sprint route', async () => {
        const res = await putSprint({ AssigneeUserId: OUTSIDER }, '$addToSet');
        expect(res.status).toBe(400);
        expect((await storedSprint()).AssigneeUserId).not.toContain(OUTSIDER);
    });

    it('still adds a member and this company\'s team, and keeps or removes someone already there', async () => {
        await db().collection('sprints').updateOne({ _id: new ObjectId(sprintId) }, { $addToSet: { AssigneeUserId: NOBODY } });

        expect((await patchSprint({ $addToSet: { AssigneeUserId: member.uid, watchers: member.uid } })).body.status).toBe(true);
        expect((await patchSprint({ $addToSet: { AssigneeUserId: `tId_${OWN_TEAM}` } })).body.status).toBe(true);
        expect((await patchSprint({ $set: { AssigneeUserId: [owner.uid, NOBODY, member.uid, `tId_${OWN_TEAM}`] } })).body.status).toBe(true);
        expect((await patchSprint({ $pull: { AssigneeUserId: NOBODY } })).body.status).toBe(true);
        expect((await putSprint({ favouriteTasks: [] })).status).toBe(200);

        expect((await storedSprint()).AssigneeUserId).toEqual([owner.uid, member.uid, `tId_${OWN_TEAM}`]);
    });
});

describe('chat channels', () => {
    it('refuses a channel that names another company\'s user and stores nothing', async () => {
        const name = `SPM channel ${uniqueSuffix()}`;
        const res = await owner.api.post('/api/v1/sprint', {
            companyId: state.companyId, projectId: project._id, sprintName: name, userData: userData(), mainChat: true, private: true,
            AssigneeUserId: [owner.uid, OUTSIDER],
        });
        expect([res.status, res.body.status]).toEqual([400, false]);
        expect(await db().collection('sprints').countDocuments({ name })).toBe(0);
    });
});
