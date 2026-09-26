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
jest.mock('../Modules/Forms/helpers/submissionRules', () => ({
    mapSubmission: jest.fn(() => ({
        valid: true,
        record: [{ questionId: 'q1', label: 'Severity', value: 'Blocking' }],
        transcript: [],
        attachments: [],
        taskFields: { TaskName: 'Filed from a form', rawDescription: '' },
    })),
    buildDescription: () => '',
    buildDescriptionBlock: () => ({}),
}));
jest.mock('../Modules/Automations/engine/registry', () => ({ ...jest.requireActual('../Modules/Automations/engine/registry'), getAction: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const domainEventBus = require('../event/domainEventBus');
const registry = require('../Modules/Automations/engine/registry');
const runner = require('../Modules/Automations/engine/runner');
const publicForm = require('../Modules/Forms/publicForm');

const COMPANY = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const PROJECT = '6f00000000000000000000a1';
const TOKEN = 'cd'.repeat(32);

// The fields a form.submitted envelope carried before the stored id was added.
const ENVELOPE_DATA_KEYS = ['formId', 'formTitle', 'submissionId', 'ProjectID', 'sprintId', 'taskId', 'taskKey', 'TaskName', 'statusType', 'statusKey', 'Task_Priority', 'answers'];

const rows = (type) => mockDb.store[type] || [];

const response = () => {
    const res = { statusCode: 200, body: undefined, location: null };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    res.set = jest.fn(() => res);
    res.setHeader = jest.fn(() => res);
    res.type = jest.fn(() => res);
    res.header = jest.fn(() => res);
    res.redirect = jest.fn((code, url) => { res.statusCode = code; res.location = url; return res; });
    return res;
};

const seedLiveForm = (settings, questions = []) => {
    const form = mockDb.seed(SCHEMA_TYPE.FORMS, {
        title: 'Intake',
        ProjectID: PROJECT,
        CompanyId: COMPANY,
        questions,
        state: 'live',
        settings,
        createdBy: OWNER,
        deletedStatusKey: 0,
        projectSnapshot: { _id: PROJECT, CompanyId: COMPANY, ProjectCode: 'OPN' },
        templateSnapshot: { TaskName: '', TaskKey: '-' },
    });
    const share = mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARES, { token: TOKEN, enabled: true, allowIntake: false, entityType: 'form', entityId: form._id, createdBy: OWNER });
    mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARE_INDEX, { token: share.token, companyId: COMPANY, shareId: share._id });
    return form;
};

/* The task write as the task layer does it: the row it stores is not the object it was handed
 * (the key is assigned, defaults filled), and it answers with the id only. */
const storeTaskOnCreate = () => taskMongo.create.mockImplementation(async ({ data }) => {
    const task = mockDb.seed(SCHEMA_TYPE.TASKS, { ...data, _id: String(data._id), TaskKey: 'OPN-14', Task_Priority: 'HIGH', statusKey: 1, statusType: 'default_active' });
    return { status: true, id: task._id, message: 'Task created successfully.' };
});

const submit = async () => {
    const heard = [];
    const listener = (envelope) => heard.push(envelope);
    domainEventBus.bus.on('form.submitted', listener);
    try {
        const res = response();
        await publicForm.submitForm({ params: { token: TOKEN }, query: {}, body: { qname: 'Filed from a form' }, headers: {} }, res);
        return { res, heard };
    } finally {
        domainEventBus.bus.removeListener('form.submitted', listener);
    }
};

/* The trigger as it runs a matched rule: the run row keeps the envelope, and each step is
 * handed the envelope's entity and its data as the task. */
const triggerWith = async (envelope) => {
    const seen = [];
    registry.getAction.mockReturnValue({ run: async ({ entity, context }) => { seen.push({ entity, task: context.task }); return { ok: true }; } });
    const rule = mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { name: 'On submit', steps: [{ id: 's1', type: 'action', action: 'run_agent', config: { agent: 'Reviewer' } }], deletedStatusKey: 0 });
    const run = await runner.createRun(COMPANY, rule, envelope);
    const out = await runner.execute({ companyId: COMPANY, runId: run._id, ruleId: rule._id });
    return { out, seen };
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    getRoleType.mockImplementation(async (companyId, uid) => (companyId === COMPANY && uid === OWNER ? 1 : null));
    visibleProjectIds.mockImplementation(async (companyId, uid) => (companyId === COMPANY && uid === OWNER ? [PROJECT] : []));
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Open', isPrivateSpace: false, AssigneeUserId: [OWNER], deletedStatusKey: 0 });
});

describe('a form submission that files a task', () => {
    it('publishes the stored task: its _id is the row the write stored, and its fields are read from that row', async () => {
        seedLiveForm({ createTask: true });
        storeTaskOnCreate();

        const { res, heard } = await submit();

        expect(res.statusCode).toBe(303);
        expect(heard).toHaveLength(1);
        const [envelope] = heard;
        const [stored] = rows(SCHEMA_TYPE.TASKS);
        expect(envelope.entity).toEqual({ kind: 'task', id: String(stored._id), key: 'OPN-14' });
        expect(envelope.data._id).toBe(String(stored._id));
        expect(envelope.data.taskId).toBe(String(stored._id));
        expect(rows(SCHEMA_TYPE.TASKS).filter((t) => String(t._id) === envelope.data._id)).toHaveLength(1);
        expect(envelope.data).toMatchObject({ taskKey: 'OPN-14', TaskName: 'Filed from a form', Task_Priority: 'HIGH', statusKey: 1, statusType: 'default_active' });
    });

    it('adds only the stored id to the event data', async () => {
        seedLiveForm({ createTask: true });
        storeTaskOnCreate();

        const { heard: [envelope] } = await submit();

        expect(Object.keys(envelope.data).sort()).toEqual([...ENVELOPE_DATA_KEYS, '_id'].sort());
    });

    it('hands the rule the stored task, so no step runs on a task without an _id', async () => {
        seedLiveForm({ createTask: true });
        storeTaskOnCreate();
        const { heard: [envelope] } = await submit();

        const { out, seen } = await triggerWith(envelope);

        expect(out).toEqual({ status: 'success' });
        expect(seen).toHaveLength(1);
        const [{ entity, task }] = seen;
        expect(task._id).toBeTruthy();
        expect(task._id).toBe(entity.id);
        expect(rows(SCHEMA_TYPE.TASKS).map((t) => String(t._id))).toContain(task._id);
    });

    it('publishes nothing when the task was not stored', async () => {
        seedLiveForm({ createTask: true });
        taskMongo.create.mockResolvedValue({ status: false, message: 'sprint is full' });

        const { heard } = await submit();

        expect(heard).toHaveLength(0);
        expect(rows(SCHEMA_TYPE.TASKS)).toHaveLength(0);
    });
});

describe('a form submission that files no task', () => {
    it('still publishes the form as the entity, with no task id, exactly as before', async () => {
        const form = seedLiveForm({ createTask: false });

        const { res, heard } = await submit();

        expect(res.statusCode).toBe(303);
        expect(taskMongo.create).not.toHaveBeenCalled();
        expect(heard).toHaveLength(1);
        const [envelope] = heard;
        const [submission] = rows(SCHEMA_TYPE.FORM_SUBMISSIONS);
        expect(envelope.entity).toEqual({ kind: 'form', id: String(form._id), key: 'Intake' });
        expect(Object.keys(envelope.data).sort()).toEqual([...ENVELOPE_DATA_KEYS].sort());
        expect(envelope.data).toMatchObject({ formId: String(form._id), submissionId: String(submission._id), taskId: null, taskKey: null, TaskName: null, answers: { q1: 'Blocking' } });
        expect(rows(SCHEMA_TYPE.FORMS)[0].submissionCount).toBe(1);
    });
});

/* The confirmation used to fade after two seconds above an empty form, so someone who looked away
 * came back to a blank form and could send it again. */
describe('the page a sender lands on after a submission', () => {
    const QUESTIONS = [{ id: 'qname', type: 'short_text', mapTo: 'TaskName', label: 'Summary', required: true }];
    const render = async (query) => {
        const res = response();
        await publicForm.renderForm({ params: { token: TOKEN }, query }, res);
        return res;
    };

    it('is a thank-you state with a link to a fresh copy of the same form, and no form', async () => {
        seedLiveForm({ createTask: false }, QUESTIONS);
        const { res: sent } = await submit();
        expect(sent.location).toBe(`/form/${TOKEN}?sent=1`);

        const res = await render({ sent: '1' });

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatch(/<div class="note ok" role="status">.*received/);
        expect(res.body).toMatch(new RegExp(`<a [^>]*href="/form/${TOKEN}"[^>]*>Submit another response</a>`));
        expect(res.body).not.toMatch(/<form\b|<input\b|<textarea\b|<select\b|<button\b/);
    });

    it('stays on screen: the stylesheet has no animation that takes it away', async () => {
        seedLiveForm({ createTask: false }, QUESTIONS);

        const res = await render({ sent: '1' });

        expect(res.body).not.toMatch(/sent-away|@keyframes|animation/);
    });

    it('a plain visit still shows the form, without the confirmation', async () => {
        seedLiveForm({ createTask: false }, QUESTIONS);

        const res = await render({});

        expect(res.body).toMatch(new RegExp(`<form method="POST" action="/form/${TOKEN}"`));
        expect(res.body).toMatch(/<input id="qname"/);
        expect(res.body).not.toMatch(/note ok|Submit another response/);
    });
});
