const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Pages/helpers/pageAi', () => ({ composePage: jest.fn(), isAiConfigured: () => false }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { create: jest.fn() } }));
jest.mock('../Modules/Automations/engine/formEvent', () => ({ publishFormSubmitted: jest.fn() }));
jest.mock('../Modules/Forms/helpers/formUpload', () => ({
    storeSubmissionFiles: jest.fn(async () => ({ files: {}, errors: {}, cleanup: () => {} })),
    messageFor: () => '', REPICK: '', ACCEPT_ATTR: '', MAX_FILE_BYTES: 1, MAX_FILES: 1,
}));
jest.mock('../Modules/Forms/helpers/submissionRules', () => ({
    mapSubmission: jest.fn(() => ({ valid: true, record: [], transcript: [], attachments: [], taskFields: { TaskName: 'Filed from a form', rawDescription: '' } })),
    buildDescription: () => '',
    buildDescriptionBlock: () => ({}),
}));
jest.mock('../utils/data', () => ({
    importUserNotifications: jest.fn(async () => undefined),
    importSettingTemplate: jest.fn((companyId, templates, cb) => cb({ status: true, statusText: 'Imported.' })),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const importData = require('../utils/data');
const shares = require('../Modules/PublicShares/controller');
const renderer = require('../Modules/PublicShares/publicRenderer');
const pages = require('../Modules/Pages/controller');
const forms = require('../Modules/Forms/controller');
const publicForm = require('../Modules/Forms/publicForm');
const importSettings = require('../Modules/ImportSettings/controller');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const GUEST = '6f0000000000000000000004';
const VIEWER = '6f0000000000000000000005';
const PUBLIC = '6f00000000000000000000a1';
const PRIVATE = '6f00000000000000000000a2';

const ROLES = { [OWNER]: 1, [ADMIN]: 2, [MEMBER]: 3, [GUEST]: 0, [VIEWER]: 3 };
const VISIBLE = { [OWNER]: [PUBLIC, PRIVATE], [ADMIN]: [PUBLIC, PRIVATE], [MEMBER]: [PUBLIC], [GUEST]: [PUBLIC], [VIEWER]: [PUBLIC, PRIVATE] };

const response = () => {
    const res = { statusCode: 200, body: undefined, location: null };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.set = jest.fn(() => res);
    res.setHeader = jest.fn(() => res);
    res.type = jest.fn(() => res);
    res.header = jest.fn(() => res);
    res.redirect = jest.fn((code, url) => { res.statusCode = code; res.location = url; return res; });
    return res;
};
const request = ({ uid, body = {}, params = {}, query = {} }) => ({ uid, body, params, query, headers: { companyid: COMPANY } });
const call = async (handler, req) => { const res = response(); await handler(req, res); return res; };
const refused = (res) => res.statusCode >= 400 || (res.body && res.body.status === false);
const rows = (type) => mockDb.store[type] || [];

const seedProjects = () => {
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PUBLIC, ProjectName: 'Open', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PRIVATE, ProjectName: 'Secret', isPrivateSpace: true, AssigneeUserId: [OWNER], deletedStatusKey: 0 });
};
const seedSprint = (projectId) => mockDb.seed(SCHEMA_TYPE.SPRINTS, { projectId, name: `Sprint of ${projectId}`, deletedStatusKey: 0 });
const seedPage = (over) => mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Doc', visibility: 'project', createdBy: OWNER, deletedStatusKey: 0, order: 1, ...over });
const seedForm = (projectId, over = {}) => mockDb.seed(SCHEMA_TYPE.FORMS, { title: 'Intake', ProjectID: projectId, questions: [], state: 'draft', createdBy: OWNER, deletedStatusKey: 0, ...over });
const seedShare = (over) => {
    const share = mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARES, { token: 'ab'.repeat(32), enabled: true, allowIntake: false, ...over });
    mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARE_INDEX, { token: share.token, companyId: COMPANY, shareId: share._id });
    return share;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    getRoleType.mockImplementation(async (companyId, uid) => (companyId === COMPANY && uid in ROLES ? ROLES[uid] : null));
    visibleProjectIds.mockImplementation(async (companyId, uid) => (companyId === COMPANY ? VISIBLE[uid] || [] : []));
    seedProjects();
});

describe('PAG-08 public links need edit rights on the linked project', () => {
    it('refuses a guest a link to a sprint of a private project with 404, and writes nothing', async () => {
        const sprint = seedSprint(PRIVATE);
        const res = await call(shares.createShare, request({ uid: GUEST, body: { entityType: 'sprint', entityId: sprint._id } }));
        expect(res.statusCode).toBe(404);
        expect(res.body.status).toBe(false);
        expect(rows(SCHEMA_TYPE.PUBLIC_SHARES)).toHaveLength(0);
        expect(rows(SCHEMA_TYPE.PUBLIC_SHARE_INDEX)).toHaveLength(0);
    });

    it('refuses with 403 someone who can see the private project but is not assigned to it', async () => {
        const sprint = seedSprint(PRIVATE);
        const res = await call(shares.createShare, request({ uid: VIEWER, body: { entityType: 'sprint', entityId: sprint._id } }));
        expect(res.statusCode).toBe(403);
        expect(rows(SCHEMA_TYPE.PUBLIC_SHARES)).toHaveLength(0);
    });

    it('refuses a project client view and an unfiltered report to a member', async () => {
        const report = mockDb.seed(SCHEMA_TYPE.SAVED_REPORTS, { name: 'All work', filters: {}, deletedStatusKey: 0 });
        expect(refused(await call(shares.createShare, request({ uid: MEMBER, body: { entityType: 'client_view', entityId: PRIVATE } })))).toBe(true);
        expect(refused(await call(shares.createShare, request({ uid: MEMBER, body: { entityType: 'report', entityId: report._id } })))).toBe(true);
        expect(rows(SCHEMA_TYPE.PUBLIC_SHARES)).toHaveLength(0);
    });

    it('lets the owner link a private sprint and a member link a sprint of a public project', async () => {
        const privateSprint = seedSprint(PRIVATE);
        const publicSprint = seedSprint(PUBLIC);
        const own = await call(shares.createShare, request({ uid: OWNER, body: { entityType: 'sprint', entityId: privateSprint._id } }));
        const mine = await call(shares.createShare, request({ uid: MEMBER, body: { entityType: 'sprint', entityId: publicSprint._id } }));
        expect(own.body.status).toBe(true);
        expect(mine.body.status).toBe(true);
        expect(mine.body.data.createdBy).toBe(MEMBER);
        expect(rows(SCHEMA_TYPE.PUBLIC_SHARES)).toHaveLength(2);
    });

    it('does not hand an existing token, or let it be changed or revoked, to a guest', async () => {
        const sprint = seedSprint(PRIVATE);
        const share = seedShare({ entityType: 'sprint', entityId: sprint._id, createdBy: OWNER });

        const read = await call(shares.getShare, request({ uid: GUEST, query: { entityId: sprint._id } }));
        expect(JSON.stringify(read.body)).not.toContain(share.token);
        expect(refused(read)).toBe(true);

        const update = await call(shares.updateShare, request({ uid: GUEST, params: { id: share._id }, body: { enabled: false } }));
        expect(update.statusCode).toBe(404);
        expect(rows(SCHEMA_TYPE.PUBLIC_SHARES)[0].enabled).toBe(true);

        const revoke = await call(shares.deleteShare, request({ uid: GUEST, params: { id: share._id } }));
        expect(revoke.statusCode).toBe(404);
        expect(rows(SCHEMA_TYPE.PUBLIC_SHARES)).toHaveLength(1);
    });

    it('lets the owner read, change and revoke their link', async () => {
        const sprint = seedSprint(PRIVATE);
        const share = seedShare({ entityType: 'sprint', entityId: sprint._id, createdBy: OWNER });
        expect((await call(shares.getShare, request({ uid: OWNER, query: { entityId: sprint._id } }))).body.data.token).toBe(share.token);
        expect((await call(shares.updateShare, request({ uid: OWNER, params: { id: share._id }, body: { enabled: false } }))).body.status).toBe(true);
        expect((await call(shares.deleteShare, request({ uid: OWNER, params: { id: share._id } }))).body.status).toBe(true);
        expect(rows(SCHEMA_TYPE.PUBLIC_SHARES)).toHaveLength(0);
    });

    it('keeps intake submissions of a private project from a guest', async () => {
        const sprint = seedSprint(PRIVATE);
        const share = seedShare({ entityType: 'sprint', entityId: sprint._id, createdBy: OWNER, allowIntake: true });
        mockDb.seed(SCHEMA_TYPE.INTAKE_ITEMS, { publicShareId: share._id, title: 'Help', email: 'someone@example.com', status: 'pending' });
        const res = await call(shares.listIntake, request({ uid: GUEST, query: { shareId: share._id } }));
        expect(refused(res)).toBe(true);
        expect(JSON.stringify(res.body)).not.toContain('someone@example.com');
    });

    it('stops serving an existing link whose creator no longer has access', async () => {
        const sprint = seedSprint(PRIVATE);
        mockDb.seed(SCHEMA_TYPE.TASKS, { sprintId: sprint._id, TaskName: 'Secret roadmap', deletedStatusKey: 0, isParentTask: true, status: { text: 'Open' } });
        const share = seedShare({ entityType: 'sprint', entityId: sprint._id, createdBy: GUEST });
        const res = await call(renderer.renderShare, { params: { token: share.token }, query: {}, body: {}, method: 'GET', headers: {} });
        expect(res.statusCode).toBe(404);
        expect(String(res.body)).not.toContain('Secret roadmap');
    });

    it('still serves a link whose creator can edit the project', async () => {
        const sprint = seedSprint(PRIVATE);
        mockDb.seed(SCHEMA_TYPE.TASKS, { sprintId: sprint._id, TaskName: 'Roadmap', deletedStatusKey: 0, isParentTask: true, status: { text: 'Open' } });
        const share = seedShare({ entityType: 'sprint', entityId: sprint._id, createdBy: OWNER });
        const res = await call(renderer.renderShare, { params: { token: share.token }, query: {}, body: {}, method: 'GET', headers: {} });
        expect(res.statusCode).toBe(200);
        expect(String(res.body)).toContain('Roadmap');
    });
});
