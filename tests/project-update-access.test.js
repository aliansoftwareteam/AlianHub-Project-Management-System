const mongoose = require('mongoose');

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(), validateObjectId: jest.fn(() => true) }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { getRoleType } = require('../Config/permissionGuard');
const { canUpdateProject, isOwnPreferenceUpdate } = require('../Modules/Project/helpers/projectUpdateAccess');
const { updateProject } = require('../Modules/Project/controller/updateProject');

const COMPANY = 'c1';
const UID = new mongoose.Types.ObjectId().toString();
const OTHER = new mongoose.Types.ObjectId().toString();
const TEAM = new mongoose.Types.ObjectId().toString();
const PROJECT = new mongoose.Types.ObjectId().toString();

const rename = { ProjectName: 'Renamed' };
const access = (over = {}) => canUpdateProject({ companyId: COMPANY, uid: UID, projectId: PROJECT, updateObject: rename, key: '', ...over });

const stubMongo = ({ project = null, team = null } = {}) => {
    MongoDbCrudOpration.mockImplementation(async (companyId, { type }) => {
        if (type === 'projects') return project;
        if (type === 'teams_management') return team;
        return { _id: PROJECT };
    });
};

beforeEach(() => {
    jest.clearAllMocks();
    getRoleType.mockResolvedValue(3);
});

describe('canUpdateProject', () => {
    test.each([1, 2])('lets roleType %i edit without reading the project', async (roleType) => {
        getRoleType.mockResolvedValue(roleType);
        await expect(access()).resolves.toBe(true);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    test('refuses a caller who is not in the company', async () => {
        getRoleType.mockResolvedValue(null);
        await expect(access()).resolves.toBe(false);
    });

    test('refuses a request without a user', async () => {
        await expect(access({ uid: undefined })).resolves.toBe(false);
        expect(getRoleType).not.toHaveBeenCalled();
    });

    test('lets a directly assigned member edit', async () => {
        stubMongo({ project: { AssigneeUserId: [OTHER, UID] } });
        await expect(access()).resolves.toBe(true);
    });

    test('refuses a member who is not assigned', async () => {
        stubMongo({ project: { AssigneeUserId: [OTHER] } });
        await expect(access()).resolves.toBe(false);
    });

    test('refuses when the project does not exist', async () => {
        stubMongo({ project: null });
        await expect(access()).resolves.toBe(false);
    });

    test('lets a member of an assigned team edit', async () => {
        stubMongo({ project: { AssigneeUserId: [OTHER, `tId_${TEAM}`] }, team: { _id: TEAM } });
        await expect(access()).resolves.toBe(true);
        const teamCall = MongoDbCrudOpration.mock.calls.find(([, query]) => query.type === 'teams_management');
        expect(teamCall[1].data[0]).toEqual({ _id: { $in: [TEAM] }, assigneeUsersArray: { $in: [UID] } });
    });

    test('refuses when no assigned team holds the caller', async () => {
        stubMongo({ project: { AssigneeUserId: [`tId_${TEAM}`] }, team: null });
        await expect(access()).resolves.toBe(false);
    });

    test('lets any member star, unstar and watch for themself', async () => {
        stubMongo({ project: { AssigneeUserId: [OTHER] } });
        await expect(access({ updateObject: { favouriteTasks: { userId: UID } }, key: '$addToSet' })).resolves.toBe(true);
        await expect(access({ updateObject: { favouriteTasks: { userId: UID } }, key: '$pull' })).resolves.toBe(true);
        await expect(access({ updateObject: { [`watchers.${UID}`]: 'all_activity' } })).resolves.toBe(true);
        await expect(access({ updateObject: { [`watchers.${UID}`]: 1 }, key: '$unset' })).resolves.toBe(true);
    });
});

describe('isOwnPreferenceUpdate', () => {
    test('rejects entries for another user', () => {
        expect(isOwnPreferenceUpdate(UID, { favouriteTasks: { userId: OTHER } }, '$addToSet')).toBe(false);
        expect(isOwnPreferenceUpdate(UID, { [`watchers.${OTHER}`]: 'all_activity' }, '')).toBe(false);
    });

    test('rejects a preference bundled with a project field', () => {
        expect(isOwnPreferenceUpdate(UID, { favouriteTasks: { userId: UID }, ProjectName: 'x' }, '$addToSet')).toBe(false);
        expect(isOwnPreferenceUpdate(UID, { [`watchers.${UID}`]: 'all_activity', ProjectName: 'x' }, '')).toBe(false);
    });

    test('rejects replacing the whole list or smuggling extra keys', () => {
        expect(isOwnPreferenceUpdate(UID, { favouriteTasks: { userId: UID } }, '$set')).toBe(false);
        expect(isOwnPreferenceUpdate(UID, { favouriteTasks: { userId: UID, pinned: true } }, '$addToSet')).toBe(false);
        expect(isOwnPreferenceUpdate(UID, { watchers: { [UID]: 'all_activity' } }, '')).toBe(false);
    });
});

describe('PUT /api/v1/project/:id', () => {
    const mockRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
    const request = (updateObject) => ({ params: { id: PROJECT }, body: { updateObject }, headers: { companyid: COMPANY }, uid: UID });

    test('answers 403 in the standard shape and writes nothing', async () => {
        stubMongo({ project: { AssigneeUserId: [OTHER] } });
        const res = mockRes();
        await updateProject(request(rename), res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ status: false, statusText: 'You do not have permission to update this project.' });
        expect(MongoDbCrudOpration.mock.calls.some(([, , op]) => op === 'findOneAndUpdate')).toBe(false);
    });

    test('lets an assignee through to the write', async () => {
        stubMongo({ project: { AssigneeUserId: [UID] } });
        const res = mockRes();
        await updateProject(request(rename), res);
        await new Promise(setImmediate);
        expect(MongoDbCrudOpration.mock.calls.some(([, , op]) => op === 'findOneAndUpdate')).toBe(true);
        expect(res.status).toHaveBeenCalledWith(200);
    });
});
