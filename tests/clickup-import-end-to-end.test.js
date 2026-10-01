/* The sample ClickUp export, the way the import dialog sends it (a preview of the whole file, then one request per ClickUp
 * list), through the real controller and the real task create path, on the in-memory database. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/tenant', () => ({ pinSessionTenant: (req) => req.headers.companyid }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => mockStub());
process.env.STORAGE_TYPE = 'server';

const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const socketEmitter = require('../event/socketEventEmitter');
const notificationCounts = require('../Modules/notification-count/controller');
const commentsController = require('../Modules/Comments/controller');
const taskNotices = require('../Modules/Tasks/helpers/handleNotification');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const importers = require('../Modules/Importers/controller');
const { mergeSummaries } = require('../Modules/Importers/helpers/clickupPlan');
const { MAX_ROWS } = require('../Modules/Importers/helpers/clickupRules');
const { taskMongo } = require('../Modules/Tasks/helpers/task_class_Mongo');
const { PROTECTED_FIELDS, TASK_ACTION_FIELDS } = require('../Modules/Tasks/helpers/taskWriteFields');
const { withoutImportFields } = require('../Modules/Comments/helpers/importFields');
const guardFixture = require('./fixtures/taskWriteGuard');
const sample = require('./fixtures/clickup-export-sample');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, MEMBER: MAX, OPEN_PROJECT: PROJECT } = guardFixture;
const SPRINT = '6f0000000000000000000e01';
const LEE = '6f0000000000000000000007';
const guard = guardFixture.create(mockDb);
const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const store = (type) => mockDb.store[type] || [];
const project = () => store(SCHEMA_TYPE.PROJECTS).find((row) => row._id === PROJECT);
const imported = () => store(SCHEMA_TYPE.TASKS).filter((task) => task.TaskName);
const tasksNamed = (name) => imported().filter((task) => task.TaskName === name);
const taskNamed = (name) => tasksNamed(name)[0];
const parentOf = (name) => (imported().find((task) => String(task._id) === String(taskNamed(name).ParentTaskId)) || {}).TaskName || '';
const childrenOf = (name) => imported().filter((task) => String(task.ParentTaskId) === String(taskNamed(name)._id)).map((task) => task.TaskName).sort();
const fieldNamed = (name) => store(SCHEMA_TYPE.CUSTOM_FIELDS).find((field) => field.fieldTitle === name);
const valueOf = (taskName, fieldName) => ((taskNamed(taskName).customField || {})[String(fieldNamed(fieldName)._id)] || {}).fieldValue;
const optionOf = (taskName, fieldName) => (valueOf(taskName, fieldName) || []).map((id) => fieldNamed(fieldName).fieldOptions.find((option) => option.id === id).label);
const commentsOn = (name) => store(SCHEMA_TYPE.COMMENTS)
    .filter((comment) => String(comment.taskId) === String(taskNamed(name)._id))
    .map((comment) => [comment.message, String(comment.userId), comment.createdAt ? comment.createdAt.toISOString() : null]);
const tagNamesOf = (name) => (taskNamed(name).tagsArray || []).map((uid) => project().tagsArray.find((tag) => tag.uid === uid).tagName);
const localDay = (date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()];
const countBy = (rows, key) => rows.reduce((counts, row) => ({ ...counts, [key(row)]: (counts[key(row)] || 0) + 1 }), {});
const written = () => Object.fromEntries(Object.entries(mockDb.store).filter(([, rows]) => rows.length).map(([type, rows]) => [type, rows.length]));

const seed = () => {
    guard.reset();
    Object.assign(project(), {
        ProjectName: 'Website', ProjectCode: 'WEB', CompanyId: CID, lastTaskId: 0,
        taskStatusData: [{ name: 'To Do', key: 1, type: 'default_active' }, { name: 'In Progress', key: 2, type: 'active' }, { name: 'Done', key: 3, type: 'close' }],
        tagsArray: [{ uid: 'tag-launch', tagName: 'Launch', tagColor: '#000000', tagBgColor: '#00000035' }],
    });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'From ClickUp', projectId: PROJECT });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner', Employee_Email: 'olivia.owner@example.test' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: MAX, Employee_Name: 'Max Member', Employee_Email: 'max.member@example.test' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: LEE, Employee_Name: 'Lee Long', Employee_Email: 'lee.long@example.test' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: LEE, roleType: 3, status: 2, isDelete: false });
    jest.clearAllMocks();
};

const call = async (handler, body, uid, params = {}) => {
    const res = { code: 200 };
    res.status = (code) => { res.code = code; return res; };
    res.send = (payload) => { res.body = payload; return res; };
    res.json = res.send;
    await handler({ uid, headers: { companyid: CID }, body, params, query: {} }, res);
    await settle();
    return res;
};

const OPTIONS = { createMissingStatuses: true };

/* What the dialog does with a file and "An existing project": preview it, then send each ClickUp list on its own. */
const importFile = async (uid = OWNER, options = OPTIONS, rows = sample.rows()) => {
    const preview = (await call(importers.previewClickUp, { rows, projectId: PROJECT, options }, uid)).body;
    const lists = [];
    for (const list of preview.data.lists) {
        const body = { rows: list.rowIndexes.map((index) => rows[index]), projectId: PROJECT, sprintId: SPRINT, options: { ...options, dayFirst: preview.data.dayFirstColumns } };
        const res = await call(importers.importFromClickUp, body, uid);
        lists.push({ name: list.name, ...res.body });
    }
    return { preview: preview.data, lists, summary: mergeSummaries(lists.map((list) => list.data.summary)) };
};

const jobs = () => store(SCHEMA_TYPE.IMPORT_JOBS);
const live = () => imported().filter((task) => !task.deletedStatusKey);
const trashed = () => imported().filter((task) => task.deletedStatusKey === 1);
const undo = (jobId, body = {}, uid = OWNER) => call(importers.undoImport, { ...body }, uid, { id: String(jobId) });

beforeEach(seed);

describe('the preview of the sample export', () => {
    it('says what the file holds and what will be new, and writes nothing', async () => {
        const before = written();
        const { data } = (await call(importers.previewClickUp, { rows: sample.rows(), projectId: PROJECT, options: OPTIONS }, OWNER)).body;

        expect(data).toMatchObject({ total: 40, importable: 38, alreadyImported: 0, canAddDetails: true });
        expect(data.lists.map(({ name, folder, space, rowIndexes, tasks, subtasks }) => ({ name, folder, space, rows: rowIndexes.length, tasks, subtasks }))).toEqual([
            { name: 'Website relaunch', folder: 'Marketing', space: 'Acme', rows: 20, tasks: 14, subtasks: 6 },
            { name: 'Bugs', folder: '', space: 'Acme', rows: 18, tasks: 16, subtasks: 2 },
        ]);
        expect(data.newStatuses.map((status) => status.name)).toEqual(['In Review', 'Blocked']);
        expect(data.newTags).toEqual(['Q4', 'design', 'content', 'bug', 'safari']);
        expect(data.customFields).toEqual([
            { name: 'Budget', type: 'money' }, { name: 'Stage', type: 'dropdown' }, { name: 'Launch Date', type: 'date' },
            { name: 'Approved', type: 'checkbox' }, { name: 'Story Points', type: 'number' }, { name: 'Site', type: 'text' },
        ]);
        expect(data.matchedAssignees).toEqual(['max.member@example.test', 'lee.long@example.test']);
        expect(data.unmatchedAssignees).toEqual(['ghost.writer@example.test', 'Pat Example']);
        expect(data.skippedRows).toEqual([
            { row: 9, code: 'no_name', reason: 'The task has no name.' },
            { row: 13, code: 'repeated_id', reason: 'A row above has the same task id.' },
        ]);
        expect(data.unreadDates).toEqual([{ row: 18, name: 'Check page speed', column: 'Start Date', value: 'next sprint' }]);
        expect(data.dayFirstColumns).toEqual(['due']);
        expect(data.unreadColumns).toEqual(['Task Custom ID', 'Date Created', 'Date Created Text', 'Time Logged', 'Time Logged Text', 'Task Type', 'Dependencies']);
        expect(data.ignoredColumns).toEqual(['Internal Ref']);
        expect(written()).toEqual(before);
    });

    it('says a member may not add statuses and tags, so the dialog can leave that switched off', async () => {
        const { data } = (await call(importers.previewClickUp, { rows: sample.rows(), projectId: PROJECT, options: OPTIONS }, MAX)).body;
        expect(data.canAddDetails).toBe(false);
    });

    it('refuses a file of more than 2,000 rows', async () => {
        const rows = Array.from({ length: MAX_ROWS + 1 }, (_unused, index) => ({ 'Task ID': `t${index}`, 'Task Name': `Task ${index}` }));
        const res = await call(importers.previewClickUp, { rows }, OWNER);
        expect(res.body).toEqual({ status: false, statusText: 'At most 2000 rows per import.' });
    });
});

describe('the sample export imported by an owner into one list of an existing project', () => {
    let out;
    beforeEach(async () => { out = await importFile(); });

    it('creates every named row, and the counts match what the preview promised', () => {
        expect(out.lists.map((list) => [list.name, list.status, list.data.created])).toEqual([['Website relaunch', true, 20], ['Bugs', true, 18]]);
        expect(imported()).toHaveLength(38);
        imported().forEach((task) => expect([String(task.ProjectID), String(task.sprintId)]).toEqual([PROJECT, SPRINT]));
        expect(imported().map((task) => task.TaskKey).sort()).toEqual(Array.from({ length: 38 }, (_unused, index) => `WEB-${index + 1}`).sort());
        expect(out.summary).toEqual(out.preview.plan);
        expect(out.summary).toMatchObject({ tasks: 30, subtasks: { level2: 5, level3: 3 }, checklistItems: 4, links: 2, existing: { skipped: 0, updated: 0 } });
        expect(jobs().map(({ source, status, total, created }) => ({ source, status, total, created }))).toEqual([
            { source: 'clickup', status: 'done', total: 20, created: 20 },
            { source: 'clickup', status: 'done', total: 18, created: 18 },
        ]);
    });

    it('marks every task, comment and field it creates with its import, and each task with its ClickUp id', () => {
        const [first, second] = jobs().map((job) => String(job._id));
        expect(countBy(imported(), (task) => String(task.importJobId))).toEqual({ [first]: 20, [second]: 18 });
        expect(taskNamed('Plan the relaunch').importSourceId).toBe('86c0a01');
        expect(taskNamed('Login fails on Safari').importSourceId).toBe('86c0b01');
        expect(countBy(store(SCHEMA_TYPE.COMMENTS), (comment) => String(comment.importJobId))).toEqual({ [first]: 4, [second]: 1 });
        store(SCHEMA_TYPE.CUSTOM_FIELDS).forEach((field) => expect(String(field.importJobId)).toBe(first));
    });

    it('keeps the tree to three levels and says which rows it had to move', () => {
        expect(childrenOf('Plan the relaunch')).toEqual(['Design the home page']);
        expect(childrenOf('Design the home page')).toEqual(['Export the SVG', 'Hero illustration']);
        expect(taskNamed('Hero illustration').ancestors.map(String)).toEqual([taskNamed('Plan the relaunch'), taskNamed('Design the home page')].map((task) => String(task._id)));
        expect(childrenOf('Set up analytics')).toEqual(['Check the consent banner', 'Tag the buttons']);
        expect(parentOf('Reproduce on iOS 18')).toBe('Login fails on Safari');
        expect(parentOf('Write the regression test')).toBe('Reproduce on iOS 18');

        expect(out.lists[0].data.adjusted).toEqual({ tooDeep: 1, parentMissing: 0, cycle: 0, rows: [{ name: 'Export the SVG', reason: 'TOO_DEEP' }] });
        expect(out.lists[1].data.adjusted).toMatchObject({ parentMissing: 2, rows: [{ name: 'Old ticket from the archive' }, { name: 'Fix the hero image alt text' }] });
        expect(parentOf('Old ticket from the archive')).toBe('');
        expect(parentOf('Fix the hero image alt text')).toBe('');
        expect(out.lists[0].statusText).toBe('Imported 20 tasks from clickup (0 skipped). 1 subtask was deeper than three levels and was placed under its nearest parent.');
    });

    it('lands each status on one of the same name or kind, and adds the two the project lacked', () => {
        expect(project().taskStatusData.map((status) => [status.name, status.type])).toEqual([
            ['To Do', 'default_active'], ['In Progress', 'active'], ['Done', 'close'], ['In Review', 'active'], ['Blocked', 'active'],
        ]);
        const statusOf = (name) => taskNamed(name).status.text;
        expect({
            'to do': statusOf('Hero illustration'),
            'in progress': statusOf('Plan the relaunch'),
            'in review': statusOf('Design the home page'),
            blocked: statusOf('Order the stand banner'),
            complete: statusOf('Write the pricing page'),
            backlog: statusOf('Collect customer quotes'),
        }).toEqual({ 'to do': 'To Do', 'in progress': 'In Progress', 'in review': 'In Review', blocked: 'Blocked', complete: 'Done', backlog: 'To Do' });
        expect(countBy(imported(), (task) => task.status.text)).toEqual({ 'To Do': 17, 'In Progress': 5, 'In Review': 4, Blocked: 4, Done: 8 });
        expect(taskNamed('Write the pricing page')).toMatchObject({ statusType: 'close', statusKey: 3 });
    });

    it('assigns the people it finds by email, and names the ones it does not', () => {
        expect(taskNamed('Plan the relaunch').AssigneeUserId).toEqual([MAX, LEE]);
        expect(taskNamed('Hero illustration').AssigneeUserId).toEqual([LEE]);
        expect(taskNamed('Collect customer quotes').AssigneeUserId).toEqual([]);
        expect(countBy(imported().flatMap((task) => task.AssigneeUserId), String)).toEqual({ [MAX]: 6, [LEE]: 5 });
        expect(out.lists[0].data.unmatchedAssignees).toEqual(['ghost.writer@example.test', 'Pat Example']);
        expect(out.summary.people).toEqual({ unmatched: ['ghost.writer@example.test', 'Pat Example'], cannotOpen: [] });
        imported().forEach((task) => expect(task.Task_Leader).toBe(OWNER));
    });

    it('keeps dates, estimates and priorities, with urgent becoming high', () => {
        const launch = taskNamed('Plan the relaunch');
        expect([launch.DueDate.toISOString(), launch.startDate.toISOString(), launch.totalEstimatedTime]).toEqual(['2025-12-01T09:00:00.000Z', '2025-11-03T09:00:00.000Z', 150]);
        expect(taskNamed('Set up analytics').DueDate.toISOString()).toBe('2025-12-10T00:00:00.000Z');
        expect(localDay(taskNamed('Design the home page').DueDate)).toEqual([2025, 12, 5]);
        expect(taskNamed('Design the home page').totalEstimatedTime).toBe(90);

        const priorityOf = (name) => taskNamed(name).Task_Priority;
        expect([priorityOf('Plan the relaunch'), priorityOf('Design the home page'), priorityOf('Hero illustration'), priorityOf('Export the SVG'), priorityOf('Write the pricing page')])
            .toEqual(['HIGH', 'HIGH', 'MEDIUM', 'LOW', 'MEDIUM']);
    });

    it('reuses a tag the project has, whatever its capitals, and adds the rest', () => {
        expect(project().tagsArray.map((tag) => tag.tagName)).toEqual(['Launch', 'Q4', 'design', 'content', 'bug', 'safari']);
        expect(tagNamesOf('Plan the relaunch')).toEqual(['Launch', 'Q4']);
        expect(tagNamesOf('Login fails on Safari')).toEqual(['bug', 'safari']);
        expect(out.summary.tags).toEqual({ added: ['Q4', 'design', 'content', 'bug', 'safari'], skipped: [] });
    });

    it('brings checklists with what was ticked', () => {
        const rowsOf = (name) => taskNamed(name).checklistArray.map((row) => [row.name, row.isChecked, row.parentId ? 'item' : 'checklist']);
        expect(rowsOf('Plan the relaunch')).toEqual([['Before go-live', false, 'checklist'], ['Redirects mapped', true, 'item'], ['Backup taken', false, 'item']]);
        expect(rowsOf('Check the consent banner')).toEqual([['Checklist', false, 'checklist'], ['Cookie text', false, 'item'], ['Legal sign-off', false, 'item']]);
    });

    it('keeps a member\'s comments theirs, with their time, and puts a stranger\'s under the owner with the name in front', () => {
        expect(commentsOn('Plan the relaunch')).toEqual([
            ['Kick-off moved to Monday', MAX, '2025-11-03T10:00:00.000Z'],
            ['Agency confirmed the budget', OWNER, '2025-11-04T10:30:00.000Z'],
            ['Pat Example: Bitte die Preise prüfen – danke!', OWNER, '2025-11-05T08:00:00.000Z'],
        ]);
        expect(commentsOn('Hero illustration').map(([message, userId]) => [message, userId])).toEqual([['ghost.writer@example.test: First sketch is in the shared folder', OWNER]]);
        expect(commentsOn('Login fails on Safari')).toEqual([['Happens on Safari 17 only', LEE, '2025-11-06T14:00:00.000Z']]);
        store(SCHEMA_TYPE.COMMENTS).forEach((comment) => expect(comment).toMatchObject({ type: 'text', importedFrom: 'clickup', project: false }));
        expect(out.summary.comments).toEqual({ imported: 5, skipped: 0, reason: '', unmatchedAuthors: ['Pat Example', 'ghost.writer@example.test'] });
    });

    it('creates each custom field once for the project and fills the values that fit', () => {
        expect(store(SCHEMA_TYPE.CUSTOM_FIELDS).map((field) => [field.fieldTitle, field.fieldType, field.global, field.projectId])).toEqual([
            ['Budget', 'money', false, [PROJECT]], ['Stage', 'dropdown', false, [PROJECT]], ['Launch Date', 'date', false, [PROJECT]],
            ['Approved', 'checkbox', false, [PROJECT]], ['Story Points', 'number', false, [PROJECT]], ['Site', 'text', false, [PROJECT]],
        ]);
        expect(fieldNamed('Stage').fieldOptions.map((option) => option.label)).toEqual(['Design', 'Build', 'Triage']);

        expect(valueOf('Plan the relaunch', 'Budget')).toBe('12500');
        expect(optionOf('Plan the relaunch', 'Stage')).toEqual(['Design']);
        expect(valueOf('Plan the relaunch', 'Launch Date')).toBe('2025-12-01T00:00:00.000Z');
        expect(valueOf('Plan the relaunch', 'Approved')).toBe(true);
        expect(valueOf('Plan the relaunch', 'Story Points')).toBe('8');
        expect(valueOf('Plan the relaunch', 'Site')).toBe('Halle 4, Köln');
        expect(valueOf('Write the pricing page', 'Launch Date')).toBe('2025-11-20T00:00:00.000Z');
        expect(valueOf('Write the pricing page', 'Approved')).toBe(true);
        expect(optionOf('Login fails on Safari', 'Stage')).toEqual(['Triage']);
        expect(valueOf('Wrong currency on invoices', 'Budget')).toBe('450');

        expect(valueOf('Design the home page', 'Budget')).toBeUndefined();
        expect(valueOf('Hero illustration', 'Approved')).toBeUndefined();
        expect(valueOf('Slow list with 500 rows', 'Story Points')).toBeUndefined();
        expect(out.summary.fields).toEqual({
            created: ['Budget', 'Stage', 'Launch Date', 'Approved', 'Story Points', 'Site'], reused: [], asText: ['Site'], skipped: [], reason: '', valuesSet: 16, valuesDropped: 3,
        });
    });

    it('turns an attachment into a link on the task and copies no file', () => {
        const linksOf = (name) => (taskNamed(name).links || []).map(({ url, label, kind }) => ({ url, label, kind }));
        expect(linksOf('Plan the relaunch')).toEqual([{ url: 'https://files.example.test/a01/brief.pdf', label: 'brief.pdf', kind: 'link' }]);
        expect(linksOf('Set up analytics')).toEqual([{ url: 'https://files.example.test/a10/plan.xlsx', label: 'plan.xlsx', kind: 'link' }]);
        imported().forEach((task) => expect(task.attachments || []).toEqual([]));
    });

    it('shows a description in the task panel: headings, lists and links kept, other markdown as typed, HTML as text', () => {
        const launch = taskNamed('Plan the relaunch');
        expect(launch.rawDescription.split('\n')[0]).toBe('# Goal');
        expect(launch.descriptionBlock.blocks).toEqual([
            { type: 'header', data: { text: 'Goal', level: 1 } },
            { type: 'paragraph', data: { text: 'Relaunch the site before the trade fair.' } },
            { type: 'list', data: { style: 'unordered', items: [{ content: 'New home page', items: [] }, { content: 'Pricing in € and £', items: [] }] } },
            { type: 'paragraph', data: { text: '**Deadline:** 1 December' } },
            { type: 'paragraph', data: { text: 'See the brief (<a href="https://docs.example.test/brief">https://docs.example.test/brief</a>)' } },
            { type: 'paragraph', data: { text: '&lt;b&gt;not bold&lt;/b&gt;' } },
        ]);
        expect(taskNamed('Tag the buttons').descriptionBlock).toEqual({});
    });

    it('keeps letters outside ASCII in names, descriptions, comments and field values', () => {
        const translated = taskNamed('Preise & Tarife übersetzen (日本語, Ελληνικά) ✓');
        expect(translated.descriptionBlock.blocks).toEqual([{ type: 'paragraph', data: { text: 'Übersetzung für DE und JP – „Preise“ prüfen.' } }]);
        expect(taskNamed('Search ignores umlauts (ä, ö, ü)')).toBeDefined();
    });

    it('leaves out the row with no name and the second row of a repeated id, and hangs that id\'s subtask under the first', () => {
        expect(imported().some((task) => task.rawDescription === 'A row with no name')).toBe(false);
        expect(tasksNamed('Map the redirects')).toHaveLength(1);
        expect(tasksNamed('Map the redirects (again)')).toHaveLength(0);
        expect(parentOf('List the old addresses')).toBe('Map the redirects');
    });

    it('reads a day-first date when the whole column is day-first, and names the row whose date it cannot read', () => {
        expect(localDay(taskNamed('Map the redirects').DueDate)).toEqual([2025, 12, 15]);
        expect(taskNamed('Map the redirects').startDate.toISOString()).toBe('2025-11-10T09:00:00.000Z');
        expect(taskNamed('Check page speed').startDate).toBeNull();
        expect(out.lists[0].data.unreadDates).toEqual([{ name: 'Check page speed', column: 'Start Date', value: 'next sprint' }]);
        expect(out.lists[1].data.unreadDates).toEqual([]);
    });

    it('does not read the task type, the time logged, the dependencies or the created date', () => {
        const launch = taskNamed('Plan the relaunch');
        expect(launch.TaskType).toBe('task');
        expect(Object.keys(launch).filter((key) => /logged|depend|custom ?id/i.test(key))).toEqual([]);
        expect(JSON.stringify(taskNamed('Preise & Tarife übersetzen (日本語, Ελληνικά) ✓'))).not.toMatch(/86c0a06/);
        expect(JSON.stringify(imported())).not.toMatch(/MKT-1|R-7|milestone/);
    });

    it('is quiet: tasks arrive as new tasks do, and nothing announces a comment or notifies anyone', () => {
        const events = countBy(socketEmitter.emit.mock.calls, ([event, payload]) => `${event}:${payload && payload.module}`);
        expect(Object.keys(events).sort()).toEqual(['insert:customFields', 'insert:task', 'update:project', 'update:task']);
        expect(events['insert:task']).toBe(38);
        expect(events['update:task']).toBeLessThanOrEqual(38 * 3);
        expect(events['update:project']).toBe(3);

        expect(notificationCounts.updateUnReadCommentsCountFun).not.toHaveBeenCalled();
        expect(Object.keys(commentsController).filter((name) => commentsController[name].mock.calls.length)).toEqual([]);

        // The create path offers each new task to its watchers and to no one else; an imported task has none.
        expect(countBy(taskNotices.HandleBothNotification.mock.calls, ([notice]) => notice.object.key)).toEqual({ task_create: 38 });
        imported().forEach((task) => expect(task.watchers).toEqual([]));

        expect(Object.keys(written()).sort()).toEqual([
            'comments', 'companies', 'company_users', 'customField', 'history', 'importJobs', 'projectRules', 'projects', 'rules', 'sprints', 'tasks', 'users',
        ]);
    });
});

describe('the sample export imported by a member', () => {
    const KEEP_PROJECT_AS_IT_IS = { createMissingStatuses: false };

    it('is refused while it would add statuses and tags, which a member may not', async () => {
        const rows = sample.rows();
        const res = await call(importers.importFromClickUp, { rows: rows.slice(0, 8), projectId: PROJECT, sprintId: SPRINT, options: OPTIONS }, MAX);
        expect([res.code, res.body.statusText]).toEqual([403, 'You do not have permission to import tasks into this project.']);
        expect(imported()).toHaveLength(0);
    });

    it('goes through with that switched off: unknown statuses fall on the first one and new tags are left out', async () => {
        const out = await importFile(MAX, KEEP_PROJECT_AS_IT_IS);
        expect(out.lists.map((list) => list.data.created)).toEqual([20, 18]);
        expect(project().taskStatusData.map((status) => status.name)).toEqual(['To Do', 'In Progress', 'Done']);
        expect([taskNamed('Design the home page').status.text, taskNamed('Order the stand banner').status.text]).toEqual(['To Do', 'To Do']);
        expect(out.summary.tags).toEqual({ added: [], skipped: ['Q4', 'design', 'content', 'bug', 'safari'] });
        expect(tagNamesOf('Plan the relaunch')).toEqual(['Launch']);
    });

    it('keeps the member\'s own comments theirs and every colleague\'s under the member, with the colleague\'s name in front', async () => {
        const out = await importFile(MAX, KEEP_PROJECT_AS_IT_IS);
        expect(out.lists.map((list) => list.data.created)).toEqual([20, 18]);
        expect(commentsOn('Plan the relaunch').map(([message, userId]) => [message, userId])).toEqual([
            ['Kick-off moved to Monday', MAX],
            ['Olivia Owner: Agency confirmed the budget', MAX],
            ['Pat Example: Bitte die Preise prüfen – danke!', MAX],
        ]);
        expect(commentsOn('Login fails on Safari').map(([message, userId]) => [message, userId])).toEqual([['lee.long@example.test: Happens on Safari 17 only', MAX]]);
        expect(out.summary.comments.unmatchedAuthors).toEqual(['Olivia Owner', 'Pat Example', 'ghost.writer@example.test', 'lee.long@example.test']);
    });
});

describe('the same file imported a second time', () => {
    const LIST = { 'List Name': 'Website relaunch', 'Folder Name': 'Marketing', 'Space Name': 'Acme', Status: 'to do' };

    it('creates nothing twice: the preview counts the tasks already here and the import leaves them alone', async () => {
        await importFile();
        const second = await importFile();

        expect(second.preview.alreadyImported).toBe(38);
        expect(second.preview.lists.map((list) => list.alreadyImported)).toEqual([20, 18]);
        expect(second.lists.map((list) => [list.status, list.data.created, list.data.alreadyImported])).toEqual([[true, 0, 20], [true, 0, 18]]);
        expect(second.summary).toEqual(second.preview.plan);
        expect(second.summary).toMatchObject({ tasks: 0, existing: { skipped: 38, updated: 0 }, comments: { imported: 0 } });

        expect(imported()).toHaveLength(38);
        expect(store(SCHEMA_TYPE.COMMENTS)).toHaveLength(5);
        expect(store(SCHEMA_TYPE.CUSTOM_FIELDS)).toHaveLength(6);
        expect(jobs()).toHaveLength(2);
    });

    it('brings in the rows that are new and hangs a new subtask under the task that is already here', async () => {
        await importFile();
        const grown = [
            ...sample.rows(),
            { ...LIST, 'Task ID': '86c0a30', 'Task Name': 'Check the 404 page', 'Parent ID': '86c0a08' },
            { ...LIST, 'Task ID': '86c0a31', 'Task Name': 'Crop for mobile', 'Parent ID': '86c0a03' },
        ];
        const second = await importFile(OWNER, OPTIONS, grown);

        expect(second.lists.map((list) => list.data.created)).toEqual([2, 0]);
        expect(imported()).toHaveLength(40);
        expect(parentOf('Check the 404 page')).toBe('Map the redirects');
        expect(taskNamed('Check the 404 page').ancestors.map(String)).toEqual([String(taskNamed('Map the redirects')._id)]);
        expect(parentOf('Crop for mobile')).toBe('Design the home page');
        expect(second.lists[0].data.adjusted).toMatchObject({ tooDeep: 1, parentMissing: 0, rows: [{ name: 'Crop for mobile', reason: 'TOO_DEEP' }] });
        expect(second.summary).toMatchObject({ tasks: 0, subtasks: { level2: 1, level3: 1 }, existing: { skipped: 38, updated: 0 } });
    });

    it('updates the tasks already here when asked to, from the cells the file fills, and never saves a comment twice', async () => {
        await importFile();
        const before = { id: String(taskNamed('Plan the relaunch')._id), job: String(taskNamed('Plan the relaunch').importJobId), history: store(SCHEMA_TYPE.HISTORY).length };
        const rows = sample.rows();
        Object.assign(rows[0], {
            'Task Name': 'Plan the relaunch, phase two',
            Status: 'complete',
            Priority: 'low',
            'Due Date': String(Date.parse('2026-01-15T09:00:00.000Z')),
            Assignees: '[lee.long@example.test]',
            Tags: '[launch, phase-2]',
            'Task Content': 'A new plan',
            'Budget (currency)': '$13,000',
            Comments: JSON.stringify([...JSON.parse(rows[0].Comments), { text: 'Phase two approved', by: 'max.member@example.test', date: '2026-01-02T09:00:00.000Z' }]),
        });
        rows.find((row) => row['Task Name'] === 'Set up analytics')['Due Date'] = '';
        jest.clearAllMocks();

        const second = await importFile(OWNER, { ...OPTIONS, existing: 'update' }, rows);

        expect(second.lists.map((list) => [list.data.created, list.data.updated])).toEqual([[0, 20], [0, 18]]);
        expect(second.summary).toEqual(second.preview.plan);
        expect(second.summary).toMatchObject({ tasks: 0, existing: { skipped: 0, updated: 38 }, comments: { imported: 1 }, tags: { added: ['phase-2'] } });
        expect(imported()).toHaveLength(38);

        const launch = taskNamed('Plan the relaunch, phase two');
        expect([String(launch._id), String(launch.importJobId)]).toEqual([before.id, before.job]);
        expect(launch).toMatchObject({ status: { text: 'Done', key: 3, type: 'close' }, statusKey: 3, statusType: 'close', Task_Priority: 'LOW', AssigneeUserId: [LEE], rawDescription: 'A new plan' });
        expect(launch.DueDate.toISOString()).toBe('2026-01-15T09:00:00.000Z');
        expect(tagNamesOf('Plan the relaunch, phase two')).toEqual(['Launch', 'phase-2']);
        expect(launch.descriptionBlock.blocks).toEqual([{ type: 'paragraph', data: { text: 'A new plan' } }]);
        expect(valueOf('Plan the relaunch, phase two', 'Budget')).toBe('13000');
        expect(valueOf('Plan the relaunch, phase two', 'Story Points')).toBe('8');
        expect(launch.checklistArray).toHaveLength(3);
        expect(launch.links).toHaveLength(1);

        expect(commentsOn('Plan the relaunch, phase two').map(([message]) => message)).toEqual([
            'Kick-off moved to Monday', 'Agency confirmed the budget', 'Pat Example: Bitte die Preise prüfen – danke!', 'Phase two approved',
        ]);
        expect(store(SCHEMA_TYPE.COMMENTS)).toHaveLength(6);
        expect(taskNamed('Set up analytics').DueDate.toISOString()).toBe('2025-12-10T00:00:00.000Z');

        expect(jobs().map(({ total, created, updated }) => [total, created, updated || 0])).toEqual([[20, 20, 0], [18, 18, 0], [20, 0, 20], [18, 0, 18]]);
        expect(taskNotices.HandleBothNotification).not.toHaveBeenCalled();
        // The one status the file changed went the way a person's change does: a history line, and who closed the task.
        expect(store(SCHEMA_TYPE.HISTORY).slice(before.history).map((line) => [line.Key, String(line.TaskId)])).toEqual([['Task_Status', before.id]]);
        expect(launch.completion.closedBy).toMatchObject({ actorId: OWNER, actorType: 'human' });
        expect(second.lists.map((list) => list.data.skippedCells)).toEqual([[], []]);
        expect(countBy(socketEmitter.emit.mock.calls, ([event, payload]) => `${event}:${payload && payload.module}`)['update:task']).toBe(38 + 2);
    });
});

describe('undoing an import', () => {
    const edit = (name) => mockDb.seed(SCHEMA_TYPE.HISTORY, { Type: 'task', Key: 'task_status', TaskId: taskNamed(name)._id, ProjectId: PROJECT, UserId: MAX, Message: 'changed' });
    const comment = (name) => mockDb.seed(SCHEMA_TYPE.COMMENTS, { taskId: taskNamed(name)._id, projectId: PROJECT, sprintId: SPRINT, userId: LEE, type: 'text', message: 'On it' });
    const subtask = (name) => mockDb.seed(SCHEMA_TYPE.TASKS, {
        TaskName: 'Added by hand', ProjectID: PROJECT, sprintId: SPRINT, ParentTaskId: String(taskNamed(name)._id), ancestors: [String(taskNamed(name)._id)], isParentTask: false, deletedStatusKey: 0,
    });
    const names = (rows) => rows.map((row) => row.name).sort();

    it('moves every task the import created to the trash, removes the fields nothing else uses, and leaves statuses and tags', async () => {
        await importFile();
        const [first, second] = jobs();
        jest.clearAllMocks();

        const res = await undo(first._id);

        expect(res.body).toMatchObject({ status: true, data: { trashed: 20, kept: [], fieldsRemoved: ['Launch Date', 'Approved', 'Site'], fieldsKept: ['Budget', 'Stage', 'Story Points'] } });
        expect(trashed()).toHaveLength(20);
        expect(countBy(live(), (task) => String(task.importJobId))).toEqual({ [String(second._id)]: 18 });
        expect(store(SCHEMA_TYPE.CUSTOM_FIELDS).filter((field) => field.isDelete === false).map((field) => field.fieldTitle)).toEqual(['Launch Date', 'Approved', 'Site']);
        expect(project().taskStatusData).toHaveLength(5);
        expect(project().tagsArray).toHaveLength(6);
        expect(jobs()[0]).toMatchObject({ status: 'undone', undoneBy: OWNER });
        expect(jobs()[0].undoneAt).toBeInstanceOf(Date);
        expect(taskNotices.HandleBothNotification).not.toHaveBeenCalled();
    });

    it('is refused a second time', async () => {
        await importFile();
        await undo(jobs()[0]._id);
        const again = await undo(jobs()[0]._id);
        expect([again.code, again.body.code]).toEqual([409, 'ALREADY_UNDONE']);
        expect(trashed()).toHaveLength(20);
    });

    it('is for the person who ran the import and for owners and admins, and for no one else', async () => {
        await importFile(MAX, { createMissingStatuses: false });
        const stranger = await undo(jobs()[0]._id, {}, LEE);
        expect(stranger.code).toBe(403);
        expect(trashed()).toHaveLength(0);

        expect((await undo(jobs()[0]._id, {}, MAX)).body.status).toBe(true);
        expect((await undo(jobs()[1]._id, {}, OWNER)).body.status).toBe(true);
        expect(live()).toHaveLength(0);
    });

    it('stops when someone has worked on an imported task, and says which', async () => {
        await importFile();
        edit('Hero illustration');
        comment('Set up analytics');
        subtask('Brief the sales team');

        const res = await undo(jobs()[0]._id);

        expect([res.code, res.body.code]).toEqual([409, 'EDITED']);
        expect(names(res.body.data.edited)).toEqual(['Brief the sales team', 'Hero illustration', 'Set up analytics']);
        expect(trashed()).toHaveLength(0);
        expect(jobs()[0].status).toBe('done');
    });

    it('keeps those tasks and the tasks above them when the person confirms, and trashes the rest', async () => {
        await importFile();
        edit('Hero illustration');
        comment('Set up analytics');
        subtask('Brief the sales team');

        const res = await undo(jobs()[0]._id, { keepEdited: true });

        expect(res.body.status).toBe(true);
        expect(names(res.body.data.kept)).toEqual(['Brief the sales team', 'Design the home page', 'Hero illustration', 'Plan the relaunch', 'Set up analytics']);
        expect(res.body.data.trashed).toBe(15);
        const stillHere = live().filter((task) => String(task.importJobId) === String(jobs()[0]._id)).map((task) => task.TaskName).sort();
        expect(stillHere).toEqual(['Brief the sales team', 'Design the home page', 'Hero illustration', 'Plan the relaunch', 'Set up analytics']);
        expect(taskNamed('Added by hand').deletedStatusKey).toBe(0);
        expect(taskNamed('Export the SVG').deletedStatusKey).toBe(1);
        expect(taskNamed('Tag the buttons').deletedStatusKey).toBe(1);
        expect(res.body.data.fieldsKept).toEqual(['Budget', 'Stage', 'Launch Date', 'Approved', 'Story Points', 'Site']);
    });

    it('does not touch the tasks a later import only updated', async () => {
        await importFile();
        const grown = [...sample.rows(), { 'Task ID': '86c0a40', 'Task Name': 'One more', Status: 'to do', 'List Name': 'Website relaunch', 'Folder Name': 'Marketing', 'Space Name': 'Acme' }];
        await importFile(OWNER, { ...OPTIONS, existing: 'update' }, grown);
        const third = jobs()[2];
        expect([third.created, third.updated]).toEqual([1, 20]);

        const res = await undo(third._id);

        expect(res.body.data).toMatchObject({ trashed: 1, kept: [] });
        expect(trashed().map((task) => task.TaskName)).toEqual(['One more']);
        expect(live()).toHaveLength(38);
    });

    it('lets the same file be imported afresh: a task in the trash no longer counts as already here', async () => {
        await importFile();
        await undo(jobs()[0]._id);

        const again = await importFile();

        expect(again.preview.lists.map((list) => list.alreadyImported)).toEqual([0, 18]);
        expect(again.lists.map((list) => list.data.created)).toEqual([20, 0]);
        expect(live()).toHaveLength(38);
        expect(again.summary.fields).toMatchObject({ created: ['Launch Date', 'Approved', 'Site'], reused: ['Budget', 'Stage', 'Story Points'] });
    });

    it('works for any importer, because each one marks what it creates', async () => {
        const res = await call(importers.importFromCsv, { rows: [{ Title: 'From a sheet' }, { Title: 'And another' }], projectId: PROJECT, sprintId: SPRINT }, OWNER);
        expect(res.body.status).toBe(true);
        expect(imported().map((task) => String(task.importJobId))).toEqual([String(res.body.data.jobId), String(res.body.data.jobId)]);

        expect((await undo(res.body.data.jobId)).body.data.trashed).toBe(2);
    });

    it('lists the imports a person may undo: their own, and every one for an owner', async () => {
        await importFile(MAX, { createMissingStatuses: false });
        const mine = await call(importers.listImports, {}, MAX);
        const none = await call(importers.listImports, {}, LEE);
        const all = await call(importers.listImports, {}, OWNER);
        expect([mine.body.data.length, none.body.data.length, all.body.data.length]).toEqual([2, 0, 2]);
        expect(mine.body.data[0]).toMatchObject({ source: 'clickup', status: 'done', projectId: expect.anything(), created: expect.any(Number) });
    });
});

describe('the mark of an import is the server\'s alone', () => {
    const newTask = (over) => ({
        TaskName: 'Typed in', TaskKey: '-', TaskType: 'task', TaskTypeKey: 1, ProjectID: PROJECT, CompanyId: CID, sprintId: SPRINT,
        sprintArray: { id: SPRINT, name: 'From ClickUp' }, AssigneeUserId: [], watchers: [], isParentTask: true, ParentTaskId: '', deletedStatusKey: 0,
        status: { text: 'To Do', key: 1, type: 'default_active' }, statusType: 'default_active', statusKey: 1, Task_Priority: 'MEDIUM', ...over,
    });

    it('is no field a task route lets a body write', () => {
        expect(PROTECTED_FIELDS).toEqual(expect.arrayContaining(['importJobId', 'importSourceId']));
        expect(TASK_ACTION_FIELDS.create.writes.data).not.toEqual(expect.arrayContaining(['importJobId']));
        expect(TASK_ACTION_FIELDS.create.writes.data).not.toEqual(expect.arrayContaining(['importSourceId']));
        expect(TASK_ACTION_FIELDS.create.params).not.toContain('importMark');
        expect(TASK_ACTION_FIELDS.createMultipleTasks.params).not.toContain('importMark');
    });

    it('is dropped from a task saved any other way, a copy of an imported task included', async () => {
        const result = await taskMongo.create({
            data: newTask({ importJobId: '6f0000000000000000000f01', importSourceId: '86c0a01' }),
            user: { id: OWNER, Employee_Name: 'Olivia Owner' }, projectData: { _id: PROJECT, CompanyId: CID, ProjectCode: 'WEB' }, indexObj: {},
        });
        await settle();
        const stored = imported().find((task) => String(task._id) === String(result.id));
        expect([stored.importJobId, stored.importSourceId]).toEqual([undefined, undefined]);
    });

    it('is dropped from a comment a person posts or edits', () => {
        expect(withoutImportFields({ message: 'hello', importedFrom: 'clickup', importJobId: 'x', importKey: 'y' })).toEqual({ message: 'hello' });
    });
});
