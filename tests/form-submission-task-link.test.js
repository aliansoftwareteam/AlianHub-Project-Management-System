const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(async () => 0),
    isWritable: () => true,
    fineGrainedEnforced: () => false,
}));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const forms = require('../Modules/Forms/controller');

const COMPANY = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const PUBLIC = '6f00000000000000000000a1';
const PRIVATE = '6f00000000000000000000a2';

const ROLES = { [OWNER]: 1, [MEMBER]: 3 };
const VISIBLE = { [OWNER]: [PUBLIC, PRIVATE], [MEMBER]: [PUBLIC] };

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    res.json = res.send;
    return res;
};
const list = async (uid, formId, query = {}) => {
    const res = response();
    await forms.listSubmissions(verified({ uid, params: { id: formId }, query, body: {}, headers: { companyid: COMPANY } }), res);
    return res;
};

let form;
let openSprint;
let closedSprint;

const seedTask = (over) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    TaskName: 'Refund for order 88', TaskKey: 'OPN-1', ProjectID: PUBLIC, sprintId: openSprint._id, deletedStatusKey: 0, ...over,
});
const seedSubmission = (task, taskKey) => mockDb.seed(SCHEMA_TYPE.FORM_SUBMISSIONS, {
    formId: form._id, ProjectID: PUBLIC, answers: [], deletedStatusKey: 0, createdAt: new Date(),
    taskId: task ? String(task._id) : '', taskKey: taskKey || (task ? task.TaskKey : ''),
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    getRoleType.mockImplementation(async (companyId, uid) => (companyId === COMPANY && uid in ROLES ? ROLES[uid] : null));
    visibleProjectIds.mockImplementation(async (companyId, uid) => (companyId === COMPANY ? VISIBLE[uid] || [] : []));
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PUBLIC, ProjectName: 'Open', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PRIVATE, ProjectName: 'Secret', isPrivateSpace: true, AssigneeUserId: [OWNER], deletedStatusKey: 0 });
    openSprint = mockDb.seed(SCHEMA_TYPE.SPRINTS, { projectId: PUBLIC, name: 'Open sprint', deletedStatusKey: 0 });
    closedSprint = mockDb.seed(SCHEMA_TYPE.SPRINTS, { projectId: PUBLIC, name: 'Private sprint', private: true, AssigneeUserId: [OWNER], deletedStatusKey: 0 });
    form = mockDb.seed(SCHEMA_TYPE.FORMS, { title: 'Intake', ProjectID: PUBLIC, questions: [], state: 'live', createdBy: OWNER, deletedStatusKey: 0 });
});

const rowFor = (res, taskKey) => res.body.data.submissions.find((r) => r.taskKey === taskKey);

describe('form responses link to the task they created', () => {
    it('gives a task the viewer can open the ids the task panel needs, where it lives now', async () => {
        const task = seedTask({ TaskKey: 'OPN-1', folderObjId: '6f00000000000000000000f1' });
        seedSubmission(task);

        const res = await list(MEMBER, form._id);
        expect(rowFor(res, 'OPN-1').task).toEqual({
            id: String(task._id), projectId: PUBLIC, sprintId: String(openSprint._id), folderId: '6f00000000000000000000f1',
        });
    });

    it('keeps the key but gives no link for a deleted or missing task', async () => {
        seedSubmission(seedTask({ TaskKey: 'OPN-2', deletedStatusKey: 1 }));
        seedSubmission({ _id: '6f00000000000000000000e9' }, 'OPN-3');

        const res = await list(OWNER, form._id);
        expect(rowFor(res, 'OPN-2').task).toBeNull();
        expect(rowFor(res, 'OPN-3').task).toBeNull();
    });

    it('gives no link to a task in a sprint or project the viewer cannot open, and no id either', async () => {
        const inPrivateSprint = seedTask({ TaskKey: 'OPN-4', sprintId: closedSprint._id });
        const moved = seedTask({ TaskKey: 'SEC-5', ProjectID: PRIVATE, sprintId: '' });
        seedSubmission(inPrivateSprint);
        seedSubmission(moved);

        const member = await list(MEMBER, form._id);
        expect(rowFor(member, 'OPN-4').task).toBeNull();
        expect(rowFor(member, 'SEC-5').task).toBeNull();
        const body = JSON.stringify(member.body);
        expect(body).not.toContain(String(inPrivateSprint._id));
        expect(body).not.toContain(String(moved._id));
        expect(body).not.toContain('Refund for order 88');

        const owner = await list(OWNER, form._id);
        expect(rowFor(owner, 'OPN-4').task.id).toBe(String(inPrivateSprint._id));
        expect(rowFor(owner, 'SEC-5').task.projectId).toBe(PRIVATE);
    });

    it('reads every linked task in one query, only for tasks of this company', async () => {
        seedSubmission(seedTask({ TaskKey: 'OPN-6' }));
        seedSubmission(seedTask({ TaskKey: 'OPN-7' }));
        seedSubmission(null);

        const res = await list(MEMBER, form._id);
        expect(res.body.data.submissions.find((r) => !r.taskKey).task).toBeNull();
        const taskReads = mockDb.crud.mock.calls.filter(([, op]) => op.type === SCHEMA_TYPE.TASKS);
        expect(taskReads).toHaveLength(1);
        expect(taskReads[0][0]).toBe(COMPANY);
    });

    it('leaves the link out of an export, which only needs the key', async () => {
        seedSubmission(seedTask({ TaskKey: 'OPN-8' }));
        const res = await list(OWNER, form._id, { all: '1' });
        expect(rowFor(res, 'OPN-8').taskKey).toBe('OPN-8');
        expect(rowFor(res, 'OPN-8').task).toBeUndefined();
    });
});
