const mockDbs = {};
const mockDbFor = (companyId) => {
    mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create();
    return mockDbs[companyId];
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method),
    validateObjectId: () => true,
}));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { create: jest.fn() } }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const controller = require('../Modules/EmailIn/controller');

const COMPANY = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000701';
const oid = (hex) => new mongoose.Types.ObjectId(hex);

const seedProject = () => mockDbFor(COMPANY).crud(COMPANY, {
    type: SCHEMA_TYPE.PROJECTS,
    data: { _id: oid(PROJECT), ProjectName: 'Shop', ProjectCode: 'SHP', deletedStatusKey: 0 },
}, 'save');

const seedSprint = (hex, extra = {}) => mockDbFor(COMPANY).crud(COMPANY, {
    type: SCHEMA_TYPE.SPRINTS,
    data: { _id: oid(hex), name: `Sprint ${hex.slice(-2)}`, projectId: oid(PROJECT), deletedStatusKey: 0, ...extra },
}, 'save');

const createInbox = async (body) => {
    const sent = {};
    await controller.createInbox(
        { headers: { companyid: COMPANY }, body },
        { send: (payload) => { sent.payload = payload; } },
    );
    return sent.payload;
};

const body = { projectId: PROJECT, userData: { id: 'u1', Employee_Name: 'Owner' } };

/* The project document's sprintsObj is a legacy copy no sprint write maintains, so an
 * inbox resolving its target sprint from it refused every project whose sprints were
 * created through the API. */
describe('POST /api/v1/email-in/inboxes default sprint', () => {
    beforeEach(() => { Object.keys(mockDbs).forEach((k) => delete mockDbs[k]); });

    it('takes the sprint from the sprints collection when the project embeds none', async () => {
        await seedProject();
        await seedSprint('6f0000000000000000000801');

        const res = await createInbox(body);

        expect(res.status).toBe(true);
        expect(res.data.sprintId).toBe('6f0000000000000000000801');
        expect(res.data.sprintArray).toMatchObject({ id: '6f0000000000000000000801', name: 'Sprint 01' });
    });

    it('prefers a top-level sprint over one inside a folder', async () => {
        await seedProject();
        await seedSprint('6f0000000000000000000802', { folderId: oid('6f0000000000000000000901') });
        await seedSprint('6f0000000000000000000803');

        expect((await createInbox(body)).data.sprintId).toBe('6f0000000000000000000803');
    });

    it('carries the folder when the only sprint lives in one', async () => {
        await seedProject();
        await seedSprint('6f0000000000000000000804', { folderId: oid('6f0000000000000000000901') });
        await mockDbFor(COMPANY).crud(COMPANY, {
            type: SCHEMA_TYPE.FOLDERS,
            data: { _id: oid('6f0000000000000000000901'), name: 'Inbound', projectId: oid(PROJECT), deletedStatusKey: 0 },
        }, 'save');

        const res = await createInbox(body);

        expect(res.data.sprintId).toBe('6f0000000000000000000804');
        expect(res.data.sprintArray).toMatchObject({ folderId: '6f0000000000000000000901', folderName: 'Inbound' });
    });

    it('skips a deleted sprint', async () => {
        await seedProject();
        await seedSprint('6f0000000000000000000805', { deletedStatusKey: 1 });
        await seedSprint('6f0000000000000000000806');

        expect((await createInbox(body)).data.sprintId).toBe('6f0000000000000000000806');
    });

    it('still refuses a project that genuinely has no sprint', async () => {
        await seedProject();

        expect(await createInbox(body)).toMatchObject({ status: false });
    });
});
