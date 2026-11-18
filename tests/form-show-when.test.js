const verified = require('./fixtures/verifiedRequest');
const fixture = require('./fixtures/formLogicCases.json');
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { create: jest.fn() } }));
jest.mock('../Modules/Automations/engine/formEvent', () => ({ publishFormSubmitted: jest.fn() }));
jest.mock('../Modules/Forms/helpers/formUpload', () => ({
    storeSubmissionFiles: jest.fn(async () => ({ files: new Map(), errors: {}, cleanup: () => {} })),
    discardFiles: jest.fn(),
    messageFor: () => '', REPICK: 'Please choose the file again.', ACCEPT_ATTR: '.pdf', MAX_FILE_BYTES: 1048576, MAX_FILES: 1,
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { publishFormSubmitted } = require('../Modules/Automations/engine/formEvent');
const { storeSubmissionFiles, discardFiles } = require('../Modules/Forms/helpers/formUpload');
const { normalizeQuestions } = require('../Modules/Forms/helpers/formRules');
const { mapSubmission } = require('../Modules/Forms/helpers/submissionRules');
const forms = require('../Modules/Forms/controller');
const publicForm = require('../Modules/Forms/publicForm');

const COMPANY = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const PROJECT = '6f00000000000000000000a1';
const TOKEN = 'ab'.repeat(32);
const PAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const REQUIRED = 'This field is required.';

const when = (question, op, value) => ({ all: [value === undefined ? { question, op } : { question, op, value }] });
const KINDS = [{ id: 'o1', label: 'Bug' }, { id: 'o2', label: 'Feature' }];

const INTAKE = [
    { id: 'qname', mapTo: 'TaskName', label: 'Summary', required: true },
    { id: 'qkind', type: 'dropdown', label: 'Kind', required: true, options: KINDS },
    { id: 'qsteps', type: 'long_text', label: 'Steps to reproduce', required: true, showWhen: when('qkind', 'equals', 'o1') },
    { id: 'qsev', mapTo: 'Task_Priority', label: 'Severity', showWhen: when('qkind', 'equals', 'o1') },
    { id: 'qdue', mapTo: 'DueDate', label: 'Needed by', showWhen: when('qkind', 'equals', 'o2') },
    { id: 'qwhy', type: 'short_text', label: 'Why now', showWhen: when('qsteps', 'is_not_empty') },
];

const PLAIN = [
    { id: 'qname', mapTo: 'TaskName', label: 'Summary', required: true },
    { id: 'qnote', type: 'short_text', label: 'Anything else' },
];

const stored = (raw) => {
    const normalized = normalizeQuestions(raw);
    if (!normalized.valid) throw new Error(normalized.reason);
    return normalized.questions;
};

const response = () => {
    const res = { statusCode: 200, body: undefined, location: null, headers: {} };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    res.set = jest.fn((name, value) => { res.headers[name] = value; return res; });
    res.redirect = jest.fn((code, url) => { res.statusCode = code; res.location = url; return res; });
    return res;
};

const seedLiveForm = (questions, over = {}) => {
    const form = mockDb.seed(SCHEMA_TYPE.FORMS, {
        title: 'Intake',
        ProjectID: PROJECT,
        CompanyId: COMPANY,
        questions,
        state: 'live',
        settings: { createTask: true },
        createdBy: OWNER,
        deletedStatusKey: 0,
        projectSnapshot: { _id: PROJECT, CompanyId: COMPANY, ProjectCode: 'OPN' },
        templateSnapshot: { TaskName: '', TaskKey: '-', Task_Priority: 'MEDIUM' },
        ...over,
    });
    const share = mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARES, { token: TOKEN, enabled: true, entityType: 'form', entityId: form._id, createdBy: OWNER });
    mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARE_INDEX, { token: TOKEN, companyId: COMPANY, shareId: share._id });
    return form;
};

const open = async (query = {}) => {
    const res = response();
    await publicForm.renderForm({ params: { token: TOKEN }, query, headers: {} }, res);
    return res;
};

const post = async (body, files) => {
    const res = response();
    await publicForm.submitForm({ params: { token: TOKEN }, query: {}, body, files, headers: {} }, res);
    return res;
};

const seen = (...ids) => JSON.stringify(ids);
const seenOn = (html) => {
    const field = /name="_seen" value="([^"]*)"/.exec(html);
    if (!field) return null;
    return JSON.parse(field[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
};
const rows = (type) => mockDb.store[type] || [];
const filedTask = () => taskMongo.create.mock.calls[0][0].data;
const recorded = () => Object.fromEntries(rows(SCHEMA_TYPE.FORM_SUBMISSIONS)[0].answers.map((a) => [a.questionId, a.value]));

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    getRoleType.mockImplementation(async (companyId, uid) => (companyId === COMPANY && uid === OWNER ? 1 : null));
    visibleProjectIds.mockImplementation(async (companyId, uid) => (companyId === COMPANY && uid === OWNER ? [PROJECT] : []));
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Open', isPrivateSpace: false, AssigneeUserId: [OWNER], deletedStatusKey: 0 });
    taskMongo.create.mockImplementation(async ({ data }) => {
        const task = mockDb.seed(SCHEMA_TYPE.TASKS, { ...data, _id: String(data._id), TaskKey: 'OPN-14' });
        return { status: true, id: task._id };
    });
});

describe('a submission to a form whose questions depend on earlier answers', () => {
    it('reads only the answers to the questions those answers call for', async () => {
        seedLiveForm(stored(INTAKE));

        const res = await post({ qname: 'Export to CSV', qkind: 'Feature', qsteps: 'posted anyway', qsev: 'URGENT', qdue: '2026-11-01', qwhy: 'posted anyway too' });

        expect(res.statusCode).toBe(303);
        expect(recorded()).toEqual({ qname: 'Export to CSV', qkind: 'Feature', qdue: '2026-11-01' });
        const task = filedTask();
        expect(task.TaskName).toBe('Export to CSV');
        expect(task.Task_Priority).toBe('MEDIUM');
        expect(task.DueDate).toEqual(new Date('2026-11-01'));
        expect(JSON.stringify(task)).not.toContain('posted anyway');
        expect(JSON.stringify(publishFormSubmitted.mock.calls[0][0].answers)).not.toContain('posted anyway');
    });

    it('maps the other branch when the answers call for it', async () => {
        seedLiveForm(stored(INTAKE));

        const res = await post({ qname: 'Login fails', qkind: 'Bug', qsteps: 'Open the page', qsev: 'URGENT', qdue: '2026-11-01', qwhy: 'Customers are blocked' });

        expect(res.statusCode).toBe(303);
        expect(recorded()).toEqual({ qname: 'Login fails', qkind: 'Bug', qsteps: 'Open the page', qsev: 'URGENT', qwhy: 'Customers are blocked' });
        expect(filedTask().Task_Priority).toBe('URGENT');
        expect(filedTask().DueDate).toBeFalsy();
    });

    it('does not ask for a required question that is not shown', async () => {
        seedLiveForm(stored(INTAKE));

        const res = await post({ qname: 'Export to CSV', qkind: 'Feature' });

        expect(res.statusCode).toBe(303);
        expect(rows(SCHEMA_TYPE.FORM_SUBMISSIONS)).toHaveLength(1);
    });

    it('refuses a submission that leaves out a required question that is shown, and stores nothing', async () => {
        seedLiveForm(stored(INTAKE));

        const res = await post({ qname: 'Login fails', qkind: 'Bug' });

        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('Steps to reproduce');
        expect(res.body).toContain(REQUIRED);
        expect(rows(SCHEMA_TYPE.FORM_SUBMISSIONS)).toHaveLength(0);
        expect(taskMongo.create).not.toHaveBeenCalled();
    });

    it('does not check an answer to a question that is not shown', () => {
        const form = { questions: stored([...INTAKE, { id: 'qmail', type: 'email', label: 'Reporter', required: true, showWhen: when('qkind', 'equals', 'o1') }]) };

        const mapped = mapSubmission(form, { qname: 'Export to CSV', qkind: 'Feature', qmail: 'not an address' });

        expect(mapped.valid).toBe(true);
        expect(mapped.record.map((row) => row.questionId)).toEqual(['qname', 'qkind', 'qdue']);
    });

    it('stores a file only for a file question that is shown', async () => {
        seedLiveForm(stored([...INTAKE, { id: 'qshot', type: 'files', label: 'Screenshot', showWhen: when('qkind', 'equals', 'o1') }]));

        await post({ qname: 'Export to CSV', qkind: 'Feature' }, [{ fieldname: 'qshot', path: '/tmp/x' }]);

        expect(storeSubmissionFiles.mock.calls[0][0].questions.map((q) => q.id)).toEqual(['qname', 'qkind', 'qdue']);
    });
});

describe('the public page of a form whose questions depend on earlier answers', () => {
    it('opens with the questions that need no answer yet', async () => {
        seedLiveForm(stored(INTAKE));

        const res = await open();

        expect(res.body).toContain('Summary');
        expect(res.body).toContain('Kind');
        for (const label of ['Steps to reproduce', 'Severity', 'Needed by', 'Why now']) expect(res.body).not.toContain(label);
        expect(seenOn(res.body)).toEqual(['qname', 'qkind']);
    });

    it('asks the questions an answer brings in before it reads the submission', async () => {
        seedLiveForm(stored(INTAKE));

        const res = await post({ qname: 'Login fails', qkind: 'Bug', _seen: seen('qname', 'qkind') });

        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('Your answers added 2 more questions.');
        expect(res.body).toContain('role="status"');
        expect(res.body).toContain('Steps to reproduce');
        expect(res.body).toContain('Severity');
        expect(res.body).not.toContain('Why now');
        expect(res.body).not.toContain(REQUIRED);
        expect(res.body).toContain('value="Login fails"');
        expect(res.body.match(/ autofocus /g)).toHaveLength(1);
        expect(res.body).toContain('<textarea autofocus aria-describedby="_more" id="qsteps"');
        expect(res.body.indexOf('id="_more"')).toBeLessThan(res.body.indexOf('id="qsteps"'));
        expect(seenOn(res.body)).toEqual(['qname', 'qkind', 'qsteps', 'qsev']);
        expect(rows(SCHEMA_TYPE.FORM_SUBMISSIONS)).toHaveLength(0);
        expect(taskMongo.create).not.toHaveBeenCalled();
        expect(storeSubmissionFiles).not.toHaveBeenCalled();
    });

    it('asks again when the new answers bring in another question, then files the submission', async () => {
        seedLiveForm(stored(INTAKE));
        const answers = { qname: 'Login fails', qkind: 'Bug', qsteps: 'Open the page' };

        const second = await post({ ...answers, _seen: seen('qname', 'qkind', 'qsteps', 'qsev') });

        expect(second.statusCode).toBe(200);
        expect(second.body).toContain('Your answers added one more question.');
        expect(second.body).toContain('Why now');
        expect(rows(SCHEMA_TYPE.FORM_SUBMISSIONS)).toHaveLength(0);

        const third = await post({ ...answers, _seen: JSON.stringify(seenOn(second.body)) });

        expect(third.statusCode).toBe(303);
        expect(recorded()).toEqual({ qname: 'Login fails', qkind: 'Bug', qsteps: 'Open the page', qsev: '', qwhy: '' });
    });

    it('says a picked file has to be picked again when the page comes back with more questions', async () => {
        seedLiveForm(stored([{ id: 'qshot', type: 'files', label: 'Screenshot' }, ...INTAKE]));
        const files = [{ fieldname: 'qshot', path: '/tmp/x' }];

        const res = await post({ qname: 'Login fails', qkind: 'Bug', _seen: seen('qshot', 'qname', 'qkind') }, files);

        expect(res.body).toContain('Please choose the file again.');
        expect(discardFiles).toHaveBeenCalledWith(files);
        expect(storeSubmissionFiles).not.toHaveBeenCalled();
    });

    it('does not hand back an answer to a question that is no longer shown', async () => {
        seedLiveForm(stored(INTAKE));

        const res = await post({ qkind: 'Feature', qsteps: 'typed while it was shown', _seen: seen('qname', 'qkind', 'qsteps', 'qsev', 'qdue') });

        expect(res.statusCode).toBe(200);
        expect(res.body).toContain(REQUIRED);
        expect(res.body).not.toContain('Steps to reproduce');
        expect(res.body).not.toContain('typed while it was shown');
        expect(seenOn(res.body)).toEqual(['qname', 'qkind', 'qdue']);
    });

    it.each([['nothing', undefined], ['text that is not a list', 'all of them'], ['a list in the wrong shape', '{"qname":1}']])('reads a submission that says %s about what was shown', async (_label, posted) => {
        seedLiveForm(stored(INTAKE));

        const res = await post({ qname: 'Login fails', qkind: 'Bug', qsteps: 'Open the page', _seen: posted });

        expect(res.statusCode).toBe(303);
    });

    it('still refuses a missing required answer from a visitor who claims to have seen every question', async () => {
        seedLiveForm(stored(INTAKE));

        const res = await post({ qname: 'Login fails', qkind: 'Bug', _seen: seen('qname', 'qkind', 'qsteps', 'qsev', 'qdue', 'qwhy') });

        expect(res.statusCode).toBe(200);
        expect(res.body).toContain(REQUIRED);
        expect(rows(SCHEMA_TYPE.FORM_SUBMISSIONS)).toHaveLength(0);
    });

    it('sends the same policy with and without rules, and no script either way', async () => {
        seedLiveForm(stored(PLAIN));
        const plain = await open();
        Object.keys(mockDb.store).forEach((k) => { if (k !== SCHEMA_TYPE.PROJECTS) mockDb.store[k].length = 0; });
        seedLiveForm(stored(INTAKE));

        const pages = [plain, await open(), await post({ qname: 'Login fails', qkind: 'Bug', _seen: seen('qname', 'qkind') }), await post({ qkind: 'Bug' })];

        for (const page of pages) {
            expect(page.headers['Content-Security-Policy']).toBe(PAGE_POLICY);
            expect(page.body).not.toMatch(/<script|javascript:|\son[a-z]+\s*=/i);
        }
    });
});

describe('a form with no rules', () => {
    it('renders every question and carries nothing about what was shown', async () => {
        seedLiveForm(stored(PLAIN));

        const res = await open();

        expect(res.body).toContain('Summary');
        expect(res.body).toContain('Anything else');
        expect(res.body).not.toContain('_seen');
        expect(res.body).not.toContain('autofocus');
        expect(res.body).not.toContain('role="status"');
    });

    it('files a submission as before, whatever it says was shown', async () => {
        seedLiveForm(stored(PLAIN));

        const res = await post({ qname: 'Filed from a form', _seen: '[]' });

        expect(res.statusCode).toBe(303);
        expect(recorded()).toEqual({ qname: 'Filed from a form', qnote: '' });
    });

    it('stores its questions without a rule key', () => {
        for (const question of stored(PLAIN)) expect(question).not.toHaveProperty('showWhen');
    });
});

describe('what the author wrote is shown as text', () => {
    const MARKUP = '<img src=x onerror=alert(1)>';
    const SCRIPT = '"><script>alert(2)</script>';

    it('escapes labels, help, options and the form heading on the page', async () => {
        seedLiveForm(stored([
            { id: 'qname', mapTo: 'TaskName', label: `Summary ${MARKUP}`, help: `Help ${SCRIPT}`, required: true },
            { id: 'qkind', type: 'dropdown', label: 'Kind', options: [{ id: 'o1', label: `One ${SCRIPT}` }, { id: 'o2', label: `Two ${MARKUP}` }] },
            { id: 'qpick', type: 'checkbox', label: 'Pick', required: true, options: [{ id: 'o1', label: `Yes ${SCRIPT}` }] },
            { id: 'qtags', type: 'labels', label: 'Tags', options: [{ id: 'o1', label: `Tag ${MARKUP}` }] },
            { id: 'qinfo', type: 'info_block', label: `Read this ${MARKUP}`, help: `Body ${SCRIPT}`, showWhen: when('qkind', 'is_empty') },
        ]), { title: `Intake ${MARKUP}`, description: `About ${SCRIPT}`, successMessage: `Thanks ${MARKUP}` });

        const pages = [await open(), await open({ sent: '1' }), await post({ qname: SCRIPT, qkind: `One ${SCRIPT}` })];

        for (const page of pages) {
            expect(page.body).not.toMatch(/<img|<script/i);
        }
        expect(pages[0].body).toContain('Summary &lt;img src=x onerror=alert(1)&gt;');
        expect(pages[0].body).toContain('One &quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;');
        expect(pages[0].body).toContain('Body &quot;&gt;&lt;script&gt;');
        expect(pages[1].body).toContain('Thanks &lt;img');
        expect(pages[2].body).toContain('value="&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;"');
    });

    it('escapes a question id that is used as a field name', async () => {
        seedLiveForm(stored([
            { id: 'qname', mapTo: 'TaskName', label: 'Summary' },
            { id: 'q"><b>', type: 'short_text', label: 'Odd id' },
            { id: 'qafter', type: 'short_text', label: 'After', showWhen: when('q"><b>', 'is_empty') },
        ]));

        const res = await open();

        expect(res.body).not.toContain('<b>');
        expect(seenOn(res.body)).toEqual(['qname', 'q"><b>', 'qafter']);
    });
});

describe('saving a form with rules', () => {
    const questionsWith = (rule) => fixture.malformedForm.map((q) => (q.id === 't' ? { ...q, showWhen: rule } : q));

    it.each(fixture.malformed.map((entry) => [entry.name, entry.rule]))('refuses %s', (_name, rule) => {
        const normalized = normalizeQuestions(questionsWith(rule));

        expect(normalized.valid).toBe(false);
        expect(normalized.reason).toContain('Question "T"');
        expect(normalized.questions).toBeUndefined();
    });

    it('says a rule may only look up the form', () => {
        expect(normalizeQuestions(questionsWith(when('z', 'is_empty'))).reason).toBe('Question "T" can only be shown by an answer to a question above it.');
        expect(normalizeQuestions(questionsWith(when('t', 'is_empty'))).reason).toBe('Question "T" can only be shown by an answer to a question above it.');
    });

    it('keeps the question that names the task always shown', () => {
        const normalized = normalizeQuestions([
            { id: 'qkind', type: 'dropdown', label: 'Kind', options: KINDS },
            { id: 'qname', mapTo: 'TaskName', label: 'Summary', showWhen: when('qkind', 'equals', 'o1') },
        ]);

        expect(normalized).toEqual({ valid: false, reason: 'Question "Summary" names the task, so it is always shown.' });
    });

    it('stores an accepted rule rebuilt from the keys it reads, and drops an empty one', () => {
        const [, , steps, severity, , why] = stored(INTAKE);
        const [, empty] = stored([{ id: 'a', type: 'short_text', label: 'A' }, { id: 'b', type: 'short_text', label: 'B', showWhen: { any: [] } }]);

        expect(steps.showWhen).toEqual({ all: [{ question: 'qkind', op: 'equals', value: 'o1' }] });
        expect(severity.showWhen).toEqual({ all: [{ question: 'qkind', op: 'equals', value: 'o1' }] });
        expect(why.showWhen).toEqual({ all: [{ question: 'qsteps', op: 'is_not_empty' }] });
        expect(empty).not.toHaveProperty('showWhen');
    });

    it('lets a rule read a task field question by its fixed values', () => {
        const [, , target] = stored([
            { id: 'qname', mapTo: 'TaskName', label: 'Summary' },
            { id: 'qsev', mapTo: 'Task_Priority', label: 'Severity' },
            { id: 'qwho', type: 'short_text', label: 'Who to call', showWhen: { any: [{ question: 'qsev', op: 'one_of', value: ['HIGH', 'URGENT'] }] } },
        ]);

        expect(target.showWhen).toEqual({ any: [{ question: 'qsev', op: 'one_of', value: ['HIGH', 'URGENT'] }] });
    });

    it('gives every option its own id and keeps the page field names for itself', () => {
        const [kind, seenId, moreId] = stored([
            { id: 'qkind', type: 'dropdown', label: 'Kind', options: [{ id: 'o1', label: 'Bug' }, { id: 'o1', label: 'Feature' }, { label: 'Question' }] },
            { id: '_seen', type: 'short_text', label: 'A' },
            { id: '_more', type: 'short_text', label: 'B' },
        ]);

        expect(new Set(kind.options.map((o) => o.id)).size).toBe(3);
        expect(kind.options.map((o) => o.label)).toEqual(['Bug', 'Feature', 'Question']);
        expect(seenId.id).not.toBe('_seen');
        expect(moreId.id).not.toBe('_more');
    });

    it('refuses the save through the API and leaves the stored form alone', async () => {
        const form = mockDb.seed(SCHEMA_TYPE.FORMS, { title: 'Intake', ProjectID: PROJECT, questions: [], state: 'draft', createdBy: OWNER, deletedStatusKey: 0 });
        const put = async (questions) => {
            const res = response();
            await forms.updateForm(verified({ uid: OWNER, body: { questions }, params: { id: form._id }, query: {}, headers: { companyid: COMPANY } }), res);
            return res.body;
        };

        const refused = await put(questionsWith(when('z', 'is_empty')));

        expect(refused.status).toBe(false);
        expect(refused.statusText).toContain('above it');
        expect(rows(SCHEMA_TYPE.FORMS)[0].questions).toEqual([]);

        const saved = await put(INTAKE);

        expect(saved.status).toBe(true);
        expect(saved.data.questions[2].showWhen).toEqual({ all: [{ question: 'qkind', op: 'equals', value: 'o1' }] });
        expect(rows(SCHEMA_TYPE.FORMS)[0].questions[5].showWhen).toEqual({ all: [{ question: 'qsteps', op: 'is_not_empty' }] });
    });
});
