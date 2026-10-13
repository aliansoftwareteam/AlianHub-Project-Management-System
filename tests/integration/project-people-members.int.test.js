const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Project writes that name people accept only active members of the verified company, and `tId_` team
 * references only to this company's teams. Removing someone is never checked. */

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

const db = () => client.db(state.companyId);
const storedProject = () => db().collection('projects').findOne({ _id: new ObjectId(String(project._id)) });
const put = (updateObject, key) => owner.api.put(`/api/v1/project/${project._id}`, key ? { updateObject, key } : { updateObject });

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
    project = await createProject(owner.api, { name: `PPM ${uniqueSuffix()}`, assigneeIds: [owner.uid], createdBy: owner.uid });
});

afterAll(async () => {
    if (!client) return;
    await db().collection('company_users').deleteMany({ userId: INVITEE });
    await db().collection('teams_management').deleteOne({ _id: OWN_TEAM });
    await client.db(SECOND_COMPANY).dropDatabase();
    await client.close();
});

describe('creating a project', () => {
    it.each([
        ['another company\'s user as an assignee', (ids) => ({ assigneeIds: [ids.owner, OUTSIDER] })],
        ['a pending invitee as an assignee', (ids) => ({ assigneeIds: [ids.owner, INVITEE] })],
        ['an id nobody holds as an assignee', (ids) => ({ assigneeIds: [ids.owner, NOBODY] })],
        ['another company\'s team', (ids) => ({ assigneeIds: [ids.owner, `tId_${FOREIGN_TEAM}`] })],
    ])('refuses %s and stores no project', async (_, people) => {
        const name = `PPM refused ${uniqueSuffix()}`;
        await expect(createProject(owner.api, { name, createdBy: owner.uid, ...people({ owner: owner.uid }) })).rejects.toThrow(/\(400\)/);
        expect(await db().collection('projects').countDocuments({ ProjectName: name })).toBe(0);
    });

    it('refuses another company\'s user as the project lead', async () => {
        const name = `PPM lead ${uniqueSuffix()}`;
        const withLead = { ...owner.api, post: (path, body) => owner.api.post(path, { ...body, LeadUserId: [OUTSIDER] }) };
        await expect(createProject(withLead, { name, assigneeIds: [owner.uid], createdBy: owner.uid })).rejects.toThrow(/\(400\)/);
        expect(await db().collection('projects').countDocuments({ ProjectName: name })).toBe(0);
    });

    it('still creates a project for members and this company\'s team', async () => {
        const created = await createProject(owner.api, { name: `PPM ok ${uniqueSuffix()}`, assigneeIds: [owner.uid, member.uid, `tId_${OWN_TEAM}`], createdBy: owner.uid });
        expect(created.AssigneeUserId).toEqual([owner.uid, member.uid, `tId_${OWN_TEAM}`]);
    });
});

describe('updating a project', () => {
    it.each([
        ['adds another company\'s user', { AssigneeUserId: OUTSIDER }, '$addToSet', OUTSIDER],
        ['adds a pending invitee as lead', { LeadUserId: INVITEE }, '$addToSet', INVITEE],
        ['replaces the list with one naming an id nobody holds', { AssigneeUserId: [NOBODY] }, '$set', NOBODY],
        ['pushes another company\'s team', { AssigneeUserId: { $each: [`tId_${FOREIGN_TEAM}`] } }, '$push', `tId_${FOREIGN_TEAM}`],
        ['sets another company\'s user as a watcher', { [`watchers.${OUTSIDER}`]: 'all_activity' }, '', OUTSIDER],
    ])('refuses a write that %s', async (_, updateObject, key, named) => {
        const res = await put(updateObject, key);
        expect(res.status).toBe(400);
        expect(JSON.stringify(await storedProject())).not.toContain(named);
    });

    it('still adds a member and this company\'s team, and keeps or removes someone already there', async () => {
        await db().collection('projects').updateOne({ _id: new ObjectId(String(project._id)) }, { $addToSet: { AssigneeUserId: NOBODY } });

        expect((await put({ AssigneeUserId: member.uid, LeadUserId: member.uid }, '$addToSet')).status).toBe(200);
        expect((await put({ AssigneeUserId: `tId_${OWN_TEAM}` }, '$addToSet')).status).toBe(200);
        expect((await put({ [`watchers.${member.uid}`]: 'all_activity' })).status).toBe(200);
        expect((await put({ AssigneeUserId: [owner.uid, member.uid, NOBODY, `tId_${OWN_TEAM}`] })).status).toBe(200);
        expect((await put({ AssigneeUserId: NOBODY }, '$pull')).status).toBe(200);

        const doc = await storedProject();
        expect(doc.AssigneeUserId).toEqual([owner.uid, member.uid, `tId_${OWN_TEAM}`]);
        expect(doc.LeadUserId).toContain(member.uid);
    });
});
