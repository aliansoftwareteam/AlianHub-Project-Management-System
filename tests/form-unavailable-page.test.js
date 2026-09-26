const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { create: jest.fn() } }));
jest.mock('../Modules/Forms/helpers/formUpload', () => ({
    storeSubmissionFiles: jest.fn(async () => ({ files: {}, errors: {}, cleanup: () => {} })),
    messageFor: () => '', REPICK: '', ACCEPT_ATTR: '', MAX_FILE_BYTES: 1, MAX_FILES: 1,
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const publicForm = require('../Modules/Forms/publicForm');

const COMPANY = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const PROJECT = '6f00000000000000000000a1';
const TOKEN = 'ef'.repeat(32);
const UNKNOWN = '12'.repeat(32);
const NEXT_STEP = 'Ask the person who sent you this link for a new one.';

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    res.set = jest.fn(() => res);
    res.redirect = jest.fn(() => res);
    return res;
};

const seedForm = ({ form = {}, share = {} } = {}) => {
    const row = mockDb.seed(SCHEMA_TYPE.FORMS, {
        title: 'Intake', ProjectID: PROJECT, CompanyId: COMPANY, questions: [], state: 'live', settings: {},
        createdBy: OWNER, deletedStatusKey: 0, ...form,
    });
    const link = mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARES, { token: TOKEN, enabled: true, entityType: 'form', entityId: row._id, createdBy: OWNER, ...share });
    mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARE_INDEX, { token: TOKEN, companyId: COMPANY, shareId: link._id });
};

const open = async (token) => {
    const res = response();
    await publicForm.renderForm({ params: { token }, query: {}, headers: {} }, res);
    return res;
};

const post = async (token) => {
    const res = response();
    await publicForm.submitForm({ params: { token }, query: {}, body: {}, headers: {} }, res);
    return res;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    getRoleType.mockImplementation(async (companyId, uid) => (companyId === COMPANY && uid === OWNER ? 1 : null));
    visibleProjectIds.mockImplementation(async (companyId, uid) => (companyId === COMPANY && uid === OWNER ? [PROJECT] : []));
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Open', isPrivateSpace: false, AssigneeUserId: [OWNER], deletedStatusKey: 0 });
});

describe('the page for a form link that does not open', () => {
    it('says the form is not available and what to do next', async () => {
        const res = await open(UNKNOWN);

        expect(res.statusCode).toBe(404);
        expect(res.body).toContain('This form is not available.');
        expect(res.body).toContain(NEXT_STEP);
        expect(res.body).not.toMatch(/<script/i);
    });

    it('reads the same for a malformed token as for an unknown one', async () => {
        const unknown = await open(UNKNOWN);
        const malformed = await open('not-a-token');

        expect(malformed.statusCode).toBe(404);
        expect(malformed.body).toBe(unknown.body);
    });

    it.each([
        ['a disabled link', { share: { enabled: false } }],
        ['a deleted form', { form: { deletedStatusKey: 1 } }],
        ['an unpublished form', { form: { state: 'draft' } }],
        ['an expired link', { share: { expiresAt: new Date(Date.now() - 60000) } }],
    ])('is identical for %s and a missing form, so nothing says why', async (_label, seed) => {
        const missing = await open(UNKNOWN);
        seedForm(seed);

        const refused = await open(TOKEN);

        expect(refused.statusCode).toBe(404);
        expect(refused.body).toBe(missing.body);
    });

    it('answers a submission to a disabled link with the same page', async () => {
        const missing = await open(UNKNOWN);
        seedForm({ share: { enabled: false } });

        const refused = await post(TOKEN);

        expect(refused.statusCode).toBe(404);
        expect(refused.body).toBe(missing.body);
    });

    it('still opens a live form, so the refusals above are not a broken fixture', async () => {
        seedForm();

        const res = await open(TOKEN);

        expect(res.statusCode).toBe(200);
        expect(res.body).not.toContain(NEXT_STEP);
    });
});
