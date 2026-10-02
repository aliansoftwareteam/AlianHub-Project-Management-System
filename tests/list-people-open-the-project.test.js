const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));

const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { prepareSprintUpdate } = require('../Modules/Sprints/helpers/listWrites');
const { CANNOT_OPEN_PROJECT, TEAM_NOT_ON_PROJECT, namedOnProjectRefusal, keptOnProject } = require('../Config/projectPeople');
const { NOT_A_MEMBER } = require('../Config/companyMembers');

const C = 'c00000000000000000000001';
const OWNER = 'a00000000000000000000001';
const ON_PROJECT = 'a00000000000000000000003';
const OFF_PROJECT = 'a00000000000000000000004';
const IN_TEAM = 'a00000000000000000000005';
const LEFT = 'a00000000000000000000006';
const oid = () => new mongoose.Types.ObjectId().toString();

let privateProject;
let openProject;
let projectTeam;
let otherTeam;

const seat = (userId, roleType = 3, extra = {}) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false, ...extra });
const listIn = (projectId, doc = {}) => String(mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: oid(), projectId, name: 'List', private: true, AssigneeUserId: [ON_PROJECT], deletedStatusKey: 0, ...doc })._id);
const update = (id, updateObject) => prepareSprintUpdate(C, OWNER, id, updateObject);

beforeEach(() => {
    myCache.flushAll();
    mockDb = fakeMongo.create();
    seat(OWNER, 1);
    [ON_PROJECT, OFF_PROJECT, IN_TEAM].forEach((userId) => seat(userId));
    seat(LEFT, 3, { status: 3, isDelete: true });
    projectTeam = `tId_${mockDb.seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, { _id: oid(), name: 'Design', assigneeUsersArray: [IN_TEAM] })._id}`;
    otherTeam = `tId_${mockDb.seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, { _id: oid(), name: 'Sales', assigneeUsersArray: [OFF_PROJECT] })._id}`;
    privateProject = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Private', isPrivateSpace: true, AssigneeUserId: [ON_PROJECT, projectTeam] })._id);
    openProject = String(mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: oid(), ProjectName: 'Open', isPrivateSpace: false, AssigneeUserId: [] })._id);
});

describe('who a private list of a private project can be shared with', () => {
    it.each([
        ['one person added', () => ({ $addToSet: { AssigneeUserId: OFF_PROJECT } })],
        ['the whole set replaced', () => ({ $set: { private: true, AssigneeUserId: [ON_PROJECT, OFF_PROJECT] } })],
        ['a watcher added', () => ({ $addToSet: { watchers: OFF_PROJECT } })],
    ])('refuses a person who cannot open the project: %s', async (name, build) => {
        await expect(update(listIn(privateProject), build())).rejects.toMatchObject({ statusCode: 400, message: CANNOT_OPEN_PROJECT });
    });

    it('refuses a team that is not on the project', async () => {
        await expect(update(listIn(privateProject), { $addToSet: { AssigneeUserId: otherTeam } })).rejects.toMatchObject({ statusCode: 400, message: TEAM_NOT_ON_PROJECT });
    });

    it('refuses a person with no live seat', async () => {
        await expect(update(listIn(privateProject), { $addToSet: { AssigneeUserId: LEFT } })).rejects.toMatchObject({ statusCode: 400, message: NOT_A_MEMBER });
    });

    it.each([
        ['a person on the project', () => ON_PROJECT],
        ['a person in a team of the project', () => IN_TEAM],
        ['a team of the project', () => projectTeam],
        ['an owner', () => OWNER],
    ])('takes %s', async (name, who) => {
        await expect(update(listIn(privateProject, { AssigneeUserId: [] }), { $addToSet: { AssigneeUserId: who() } })).resolves.toMatchObject({ projectId: privateProject });
    });

    it('keeps a person the list already holds', async () => {
        const id = listIn(privateProject, { AssigneeUserId: [ON_PROJECT, OFF_PROJECT] });
        await expect(update(id, { $set: { AssigneeUserId: [OFF_PROJECT] } })).resolves.toMatchObject({ projectId: privateProject });
    });

    it('lets anyone be taken off', async () => {
        const id = listIn(privateProject, { AssigneeUserId: [ON_PROJECT, OFF_PROJECT] });
        await expect(update(id, { $pull: { AssigneeUserId: OFF_PROJECT } })).resolves.toMatchObject({ projectId: privateProject });
    });
});

describe('who a list of an open project can be shared with', () => {
    it('takes any member and any team of the company', async () => {
        const id = listIn(openProject);
        await expect(update(id, { $addToSet: { AssigneeUserId: OFF_PROJECT } })).resolves.toMatchObject({ projectId: openProject });
        await expect(update(id, { $addToSet: { AssigneeUserId: otherTeam } })).resolves.toMatchObject({ projectId: openProject });
    });

    it('refuses a person with no live seat', async () => {
        await expect(update(listIn(openProject), { $addToSet: { AssigneeUserId: LEFT } })).rejects.toMatchObject({ statusCode: 400 });
    });
});

describe('a chat channel', () => {
    it('is not held to a project', async () => {
        const space = String(mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: oid(), default: false })._id);
        const id = listIn(space);
        await expect(update(id, { $addToSet: { AssigneeUserId: OFF_PROJECT } })).resolves.toMatchObject({ projectId: space });
    });
});

describe('the people and teams a project lets be named', () => {
    it('answers why a name cannot be put on the project', async () => {
        expect(await namedOnProjectRefusal(C, privateProject, [ON_PROJECT, projectTeam])).toBe('');
        expect(await namedOnProjectRefusal(C, privateProject, [OFF_PROJECT])).toBe(CANNOT_OPEN_PROJECT);
        expect(await namedOnProjectRefusal(C, privateProject, [otherTeam])).toBe(TEAM_NOT_ON_PROJECT);
        expect(await namedOnProjectRefusal(C, privateProject, [`tId_${oid()}`])).toBe(TEAM_NOT_ON_PROJECT);
        expect(await namedOnProjectRefusal(C, openProject, [OFF_PROJECT, otherTeam])).toBe('');
    });

    it('keeps the ones who may be named, asking once for each', async () => {
        const kept = keptOnProject(C, privateProject);
        expect(await kept([ON_PROJECT, OFF_PROJECT, LEFT, projectTeam, otherTeam, IN_TEAM])).toEqual([ON_PROJECT, projectTeam, IN_TEAM]);
        const reads = mockDb.calls.length;
        expect(await kept([OFF_PROJECT, ON_PROJECT])).toEqual([ON_PROJECT]);
        expect(mockDb.calls.length).toBe(reads);
    });
});
