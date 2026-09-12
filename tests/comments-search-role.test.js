process.env.STORAGE_TYPE = 'server';

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => []) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { getRoleType } = require('../Config/permissionGuard');
const { searchComments } = require('../Modules/Comments/controller');

const COMPANY = '6a9954186dd786246031e47b';
const USER = '6a9954186dd786246031e47c';
const PROJECT = '6a9954186dd786246031e47d';
const SPRINT_ACCESS = { $match: { 'sprintArray.isAccessible': true } };

const pipelineFor = async ({ storedRole, bodyRole }) => {
    getRoleType.mockResolvedValueOnce(storedRole);
    MongoDbCrudOpration.mockClear();
    const res = { status: jest.fn(() => res), json: jest.fn() };
    await searchComments({ headers: { companyid: COMPANY }, uid: USER, body: { pids: [PROJECT], roleType: bodyRole } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const search = MongoDbCrudOpration.mock.calls.find(([, params]) => params.type === 'comments');
    return search[1].data[0];
};

beforeEach(() => jest.clearAllMocks());

describe('comment search sprint privacy', () => {
    it('resolves the caller role from the company, not the request body', async () => {
        const pipeline = await pipelineFor({ storedRole: 3, bodyRole: 1 });
        expect(getRoleType).toHaveBeenCalledWith(COMPANY, USER);
        expect(pipeline).toContainEqual(SPRINT_ACCESS);
    });

    it.each([0, 3, null])('keeps private sprints filtered for roleType %s', async (storedRole) => {
        expect(await pipelineFor({ storedRole, bodyRole: undefined })).toContainEqual(SPRINT_ACCESS);
    });

    it.each([1, 2])('lets roleType %s see every sprint without sending a role', async (storedRole) => {
        expect(await pipelineFor({ storedRole, bodyRole: undefined })).not.toContainEqual(SPRINT_ACCESS);
    });
});
