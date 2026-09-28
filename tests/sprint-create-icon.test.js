const mockDb = require('./fixtures/fakeMongo').create({ mongooseCasting: true });

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ unsetAllCounts: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(() => Promise.resolve()) }));
jest.mock('../Modules/Sprints/helpers/sprintHistory', () => ({
    storedNames: jest.fn(async () => ({ projectName: 'Launch', folderName: '' })),
    notifySprintCreated: jest.fn(() => Promise.resolve()),
    notifyFolderCreated: jest.fn(() => Promise.resolve()),
}));
jest.mock('../utils/planHelper', () => ({ getCachedCompanyData: jest.fn(async () => ({ data: {} })) }));
jest.mock('../Modules/Company/helpers/companyCounters', () => ({
    stepCompanyCounters: jest.fn(async () => ({ data: { projectCount: {}, planFeature: { maxPrivateChannels: null, maxPublicChannels: null } } })),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { addSprintFun } = require('../Modules/Sprints/controller');

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const PROJECT = '6f0000000000000000000a01';
const ELSEWHERE = '6f0000000000000000000a02';
const SPACE = '6f0000000000000000000c01';

const FORGED = {
    projectId: ELSEWHERE,
    private: true,
    AssigneeUserId: [OWNER],
    watchers: [OWNER],
    deletedStatusKey: 1,
    tasks: 99,
    folderId: '6f0000000000000000000f09',
    isScrum: true,
    isBacklog: true,
    state: 'active',
    name: 'forged',
};

const saved = () => (mockDb.store[SCHEMA_TYPE.SPRINTS] || []).at(-1);

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
});

describe('POST /api/v1/sprint takes only the icon\'s own fields from the icon', () => {
    it('keeps a glyph icon the channel sidebar sends', async () => {
        await addSprintFun({ body: { companyId: CID, projectId: SPACE, sprintName: 'general', mainChat: true, AssigneeUserId: [OWNER], icon: { prefix: 'fas', iconName: 'hashtag', type: 'icon' } } });
        expect(saved()).toMatchObject({ name: 'general', prefix: 'fas', iconName: 'hashtag', type: 'icon', private: false });
    });

    it('keeps an uploaded image icon', async () => {
        await addSprintFun({ body: { companyId: CID, projectId: SPACE, sprintName: 'design', mainChat: true, icon: { url: 'chats/x/channelImages/a.png', type: 'image' } } });
        expect(saved()).toMatchObject({ url: 'chats/x/channelImages/a.png', type: 'image' });
    });

    it.each([
        ['a list', { companyId: CID, projectId: PROJECT, sprintName: 'Sprint 2', userData: { Employee_Name: 'Olivia' } }],
        ['a channel', { companyId: CID, projectId: SPACE, sprintName: 'random', mainChat: true, AssigneeUserId: [] }],
    ])('ignores every other field an icon carries on %s', async (_label, body) => {
        const result = await addSprintFun({ body: { ...body, icon: { prefix: 'fas', iconName: 'bolt', type: 'icon', ...FORGED } } });
        expect(result).toMatchObject({ status: true });
        const sprint = saved();
        expect(String(sprint.projectId)).toBe(body.projectId);
        expect(sprint).toMatchObject({ name: body.sprintName, private: false, deletedStatusKey: 0, tasks: 0, iconName: 'bolt' });
        ['watchers', 'folderId', 'isScrum', 'isBacklog', 'state'].forEach((field) => expect(sprint).not.toHaveProperty(field));
        expect(sprint.AssigneeUserId || []).toEqual(body.AssigneeUserId || []);
    });

    it('drops icon fields that are not text', async () => {
        await addSprintFun({ body: { companyId: CID, projectId: SPACE, sprintName: 'ops', mainChat: true, icon: { iconName: { $gt: '' }, prefix: ['fas'], type: 'icon' } } });
        expect(saved()).not.toHaveProperty('iconName');
        expect(saved()).not.toHaveProperty('prefix');
    });
});
