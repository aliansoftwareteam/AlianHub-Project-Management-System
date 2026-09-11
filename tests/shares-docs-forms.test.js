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

describe('PAG-09 docs and forms are limited to visible projects', () => {
    it('lists no docs of a project the guest cannot see, and none in the workspace index', async () => {
        seedPage({ title: 'Hidden plan', ProjectID: PRIVATE });
        seedPage({ title: 'Open plan', ProjectID: PUBLIC });
        seedPage({ title: 'Handbook' });

        const byProject = await call(pages.listPages, request({ uid: GUEST, query: { projectId: PRIVATE } }));
        expect(byProject.body.data || []).toHaveLength(0);

        const all = await call(pages.listPages, request({ uid: GUEST, query: { scope: 'all' } }));
        expect(all.body.data.map((p) => p.title).sort()).toEqual(['Handbook', 'Open plan']);
    });

    it('does not open a doc of a hidden project, but the owner still can', async () => {
        const hidden = seedPage({ title: 'Hidden plan', ProjectID: PRIVATE });
        expect(refused(await call(pages.getPage, request({ uid: GUEST, params: { id: hidden._id } })))).toBe(true);
        expect((await call(pages.getPage, request({ uid: OWNER, params: { id: hidden._id } }))).body.data.title).toBe('Hidden plan');
    });

    it('does not list or open a form of a hidden project', async () => {
        const form = seedForm(PRIVATE);
        const list = await call(forms.listForms, request({ uid: GUEST, query: { projectId: PRIVATE } }));
        expect(list.body.data || []).toHaveLength(0);
        expect(refused(await call(forms.getForm, request({ uid: GUEST, params: { id: form._id } })))).toBe(true);
        expect(refused(await call(forms.updateForm, request({ uid: GUEST, params: { id: form._id }, body: { title: 'Mine now' } })))).toBe(true);
        expect(rows(SCHEMA_TYPE.FORMS)[0].title).toBe('Intake');
    });

    it('keeps submissions from anyone who cannot edit the form project', async () => {
        const form = seedForm(PRIVATE);
        mockDb.seed(SCHEMA_TYPE.FORM_SUBMISSIONS, { formId: form._id, answers: [{ questionId: 'email', label: 'Email', value: 'someone@example.com' }], deletedStatusKey: 0 });

        const guest = await call(forms.listSubmissions, request({ uid: GUEST, params: { id: form._id } }));
        expect(refused(guest)).toBe(true);
        expect(JSON.stringify(guest.body)).not.toContain('someone@example.com');

        const viewer = await call(forms.listSubmissions, request({ uid: VIEWER, params: { id: form._id }, query: { all: '1' } }));
        expect(viewer.statusCode).toBe(403);
        expect(JSON.stringify(viewer.body)).not.toContain('someone@example.com');
    });

    it('lets the owner and a member of a public project read submissions', async () => {
        const privateForm = seedForm(PRIVATE);
        const publicForm = seedForm(PUBLIC);
        mockDb.seed(SCHEMA_TYPE.FORM_SUBMISSIONS, { formId: privateForm._id, answers: [], deletedStatusKey: 0 });
        mockDb.seed(SCHEMA_TYPE.FORM_SUBMISSIONS, { formId: publicForm._id, answers: [], deletedStatusKey: 0 });
        expect((await call(forms.listSubmissions, request({ uid: OWNER, params: { id: privateForm._id } }))).body.data.total).toBe(1);
        expect((await call(forms.listSubmissions, request({ uid: MEMBER, params: { id: publicForm._id } }))).body.data.total).toBe(1);
    });
});

describe('PAG-10 deleting a doc', () => {
    it("refuses a member deleting someone else's private doc and deletes nothing", async () => {
        const doc = seedPage({ title: 'Salary notes', ProjectID: PUBLIC, visibility: 'private', createdBy: OWNER });
        seedPage({ title: 'Child', ProjectID: PUBLIC, parentPageId: doc._id, createdBy: OWNER });
        const res = await call(pages.deletePage, request({ uid: MEMBER, params: { id: doc._id } }));
        expect(refused(res)).toBe(true);
        expect(rows(SCHEMA_TYPE.PAGES).every((p) => p.deletedStatusKey === 0)).toBe(true);
    });

    it('answers an unknown id as not found', async () => {
        const res = await call(pages.deletePage, request({ uid: OWNER, params: { id: '6f00000000000000000000ff' } }));
        expect(refused(res)).toBe(true);
    });

    it('refuses a guest deleting a shared doc of a project they cannot edit', async () => {
        const doc = seedPage({ title: 'Plan', ProjectID: PRIVATE });
        expect(refused(await call(pages.deletePage, request({ uid: GUEST, params: { id: doc._id } })))).toBe(true);
        expect(refused(await call(pages.deletePage, request({ uid: VIEWER, params: { id: doc._id } })))).toBe(true);
        expect(rows(SCHEMA_TYPE.PAGES)[0].deletedStatusKey).toBe(0);
    });

    it('lets the author, and an admin, delete a private doc', async () => {
        const mine = seedPage({ title: 'Mine', ProjectID: PUBLIC, visibility: 'private', createdBy: MEMBER });
        const theirs = seedPage({ title: 'Theirs', ProjectID: PUBLIC, visibility: 'private', createdBy: MEMBER });
        expect((await call(pages.deletePage, request({ uid: MEMBER, params: { id: mine._id } }))).body.status).toBe(true);
        expect((await call(pages.deletePage, request({ uid: ADMIN, params: { id: theirs._id } }))).body.status).toBe(true);
        expect(rows(SCHEMA_TYPE.PAGES).every((p) => p.deletedStatusKey === 1)).toBe(true);
    });

    it("deletes a shared doc's visible subtree but not a child the caller cannot see", async () => {
        const parent = seedPage({ title: 'Parent', ProjectID: PUBLIC, createdBy: OWNER });
        const child = seedPage({ title: 'Child', ProjectID: PUBLIC, parentPageId: parent._id, createdBy: OWNER });
        const grandchild = seedPage({ title: 'Grandchild', ProjectID: PUBLIC, parentPageId: child._id, createdBy: OWNER });
        const secret = seedPage({ title: 'Secret', ProjectID: PUBLIC, parentPageId: parent._id, visibility: 'private', createdBy: OWNER });
        const underSecret = seedPage({ title: 'Under secret', ProjectID: PUBLIC, parentPageId: secret._id, createdBy: OWNER });

        const res = await call(pages.deletePage, request({ uid: MEMBER, params: { id: parent._id } }));
        expect(res.body.data.deleted).toBe(3);
        const state = Object.fromEntries(rows(SCHEMA_TYPE.PAGES).map((p) => [p.title, p.deletedStatusKey]));
        expect(state).toEqual({ Parent: 1, Child: 1, Grandchild: 1, Secret: 0, 'Under secret': 0 });
        expect([grandchild, underSecret]).toHaveLength(2);
    });
});

describe('PAG-11 a submission records its task key', () => {
    it('stores the key of the task the submission created', async () => {
        const form = seedForm(PUBLIC, {
            state: 'live',
            settings: { createTask: true },
            projectSnapshot: { _id: PUBLIC, CompanyId: COMPANY, ProjectCode: 'OPN' },
            templateSnapshot: { TaskName: '', TaskKey: '-' },
            CompanyId: COMPANY,
        });
        const share = seedShare({ entityType: 'form', entityId: form._id, createdBy: OWNER });
        taskMongo.create.mockImplementation(async ({ data }) => {
            const task = mockDb.seed(SCHEMA_TYPE.TASKS, { ...data, _id: String(data._id), TaskKey: 'OPN-14' });
            return { status: true, id: task._id, message: 'Task created successfully.' };
        });

        const res = await call(publicForm.submitForm, { params: { token: share.token }, query: {}, body: { qname: 'Filed from a form' }, headers: {} });
        expect(res.statusCode).toBe(303);
        const [submission] = rows(SCHEMA_TYPE.FORM_SUBMISSIONS);
        expect(submission.taskKey).toBe('OPN-14');
        expect(submission.taskId).toBe(rows(SCHEMA_TYPE.TASKS)[0]._id);
    });
});
