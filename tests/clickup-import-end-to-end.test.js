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

const call = async (handler, body, uid) => {
    const res = { code: 200 };
    res.status = (code) => { res.code = code; return res; };
    res.send = (payload) => { res.body = payload; return res; };
    res.json = res.send;
    await handler({ uid, headers: { companyid: CID }, body }, res);
    await settle();
    return res;
};

const OPTIONS = { createMissingStatuses: true };

/* What the dialog does with a file and "An existing project": preview it, then send each ClickUp list on its own. */
const importFile = async (uid = OWNER, options = OPTIONS) => {
    const rows = sample.rows();
    const preview = (await call(importers.previewClickUp, { rows, projectId: PROJECT, options }, uid)).body;
    const lists = [];
    for (const list of preview.data.lists) {
        const res = await call(importers.importFromClickUp, { rows: list.rowIndexes.map((index) => rows[index]), projectId: PROJECT, sprintId: SPRINT, options }, uid);
        lists.push({ name: list.name, ...res.body });
    }
    return { preview: preview.data, lists, summary: mergeSummaries(lists.map((list) => list.data.summary)) };
};


beforeEach(seed);

describe('the preview of the sample export', () => {
    it('says what the file holds and what will be new, and writes nothing', async () => {
        const before = written();
        const { data } = (await call(importers.previewClickUp, { rows: sample.rows(), projectId: PROJECT, options: OPTIONS }, OWNER)).body;

        expect(data).toMatchObject({ total: 40, importable: 39 });
        expect(data.lists.map(({ name, folder, space, rowIndexes }) => ({ name, folder, space, rows: rowIndexes.length }))).toEqual([
            { name: 'Website relaunch', folder: 'Marketing', space: 'Acme', rows: 21 },
            { name: 'Bugs', folder: '', space: 'Acme', rows: 18 },
        ]);
        expect(data.newStatuses.map((status) => status.name)).toEqual(['In Review', 'Blocked']);
        expect(data.newTags).toEqual(['Q4', 'design', 'content', 'bug', 'safari']);
        expect(data.customFields).toEqual([
            { name: 'Budget', type: 'money' }, { name: 'Stage', type: 'dropdown' }, { name: 'Launch Date', type: 'date' },
            { name: 'Approved', type: 'checkbox' }, { name: 'Story Points', type: 'number' }, { name: 'Site', type: 'text' },
        ]);
        expect(data.matchedAssignees).toEqual(['max.member@example.test', 'lee.long@example.test']);
        expect(data.unmatchedAssignees).toEqual(['ghost.writer@example.test', 'Pat Example']);
        expect(data.skippedRows).toEqual([{ row: 9, code: 'no_name', reason: 'The task has no name.' }]);
        expect(data.ignoredColumns).toEqual(['Internal Ref']);
        expect(written()).toEqual(before);
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
        expect(out.lists.map((list) => [list.name, list.status, list.data.created])).toEqual([['Website relaunch', true, 21], ['Bugs', true, 18]]);
        expect(imported()).toHaveLength(39);
        imported().forEach((task) => expect([String(task.ProjectID), String(task.sprintId)]).toEqual([PROJECT, SPRINT]));
        expect(imported().map((task) => task.TaskKey).sort()).toEqual(Array.from({ length: 39 }, (_unused, index) => `WEB-${index + 1}`).sort());
        expect(out.summary).toEqual(out.preview.plan);
        expect(out.summary).toMatchObject({ tasks: 32, subtasks: { level2: 4, level3: 3 }, checklistItems: 4, links: 2 });
        expect(store(SCHEMA_TYPE.IMPORT_JOBS).map(({ source, status, total, created }) => ({ source, status, total, created }))).toEqual([
            { source: 'clickup', status: 'done', total: 21, created: 21 },
            { source: 'clickup', status: 'done', total: 18, created: 18 },
        ]);
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
        expect(out.lists[0].statusText).toBe('Imported 21 tasks from clickup (0 skipped). 1 subtask was deeper than three levels and was placed under its nearest parent.');
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
        expect(countBy(imported(), (task) => task.status.text)).toEqual({ 'To Do': 18, 'In Progress': 5, 'In Review': 4, Blocked: 4, Done: 8 });
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
            { type: 'paragraph', data: { text: 'See the brief (<a href="https://docs.example.test/brief" target="_blank" rel="noopener noreferrer">https://docs.example.test/brief</a>)' } },
            { type: 'paragraph', data: { text: '&lt;b&gt;not bold&lt;/b&gt;' } },
        ]);
        expect(taskNamed('Tag the buttons').descriptionBlock).toEqual({});
    });

    it('keeps letters outside ASCII in names, descriptions, comments and field values', () => {
        const translated = taskNamed('Preise & Tarife übersetzen (日本語, Ελληνικά) ✓');
        expect(translated.descriptionBlock.blocks).toEqual([{ type: 'paragraph', data: { text: 'Übersetzung für DE und JP – „Preise“ prüfen.' } }]);
        expect(taskNamed('Search ignores umlauts (ä, ö, ü)')).toBeDefined();
    });

    it('leaves out the row with no name, and brings the rows with a broken date or a repeated id without saying so', () => {
        expect(out.preview.skippedRows).toEqual([{ row: 9, code: 'no_name', reason: 'The task has no name.' }]);
        expect(imported().some((task) => task.rawDescription === 'A row with no name')).toBe(false);

        expect(taskNamed('Map the redirects').DueDate).toBeNull();
        expect(taskNamed('Map the redirects').startDate.toISOString()).toBe('2025-11-10T09:00:00.000Z');
        expect(tasksNamed('Map the redirects')).toHaveLength(1);
        expect(tasksNamed('Map the redirects (again)')).toHaveLength(1);
        expect(JSON.stringify(out.lists)).not.toMatch(/Map the redirects/);
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
        expect(events['insert:task']).toBe(39);
        expect(events['update:task']).toBeLessThanOrEqual(39 * 3);
        expect(events['update:project']).toBe(3);

        expect(notificationCounts.updateUnReadCommentsCountFun).not.toHaveBeenCalled();
        expect(Object.keys(commentsController).filter((name) => commentsController[name].mock.calls.length)).toEqual([]);

        // The create path offers each new task to its watchers and to no one else; an imported task has none.
        expect(countBy(taskNotices.HandleBothNotification.mock.calls, ([notice]) => notice.object.key)).toEqual({ task_create: 39 });
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
        expect(out.lists.map((list) => list.data.created)).toEqual([21, 18]);
        expect(project().taskStatusData.map((status) => status.name)).toEqual(['To Do', 'In Progress', 'Done']);
        expect([taskNamed('Design the home page').status.text, taskNamed('Order the stand banner').status.text]).toEqual(['To Do', 'To Do']);
        expect(out.summary.tags).toEqual({ added: [], skipped: ['Q4', 'design', 'content', 'bug', 'safari'] });
        expect(tagNamesOf('Plan the relaunch')).toEqual(['Launch']);
    });

    it('keeps the member\'s own comments theirs and every colleague\'s under the member, with the colleague\'s name in front', async () => {
        const out = await importFile(MAX, KEEP_PROJECT_AS_IT_IS);
        expect(out.lists.map((list) => list.data.created)).toEqual([21, 18]);
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
    it('creates every task again: nothing recognises a task that is already here', async () => {
        await importFile();
        const second = await importFile();

        expect(second.lists.map((list) => list.data.created)).toEqual([21, 18]);
        expect(imported()).toHaveLength(78);
        expect(tasksNamed('Plan the relaunch')).toHaveLength(2);
        expect(store(SCHEMA_TYPE.COMMENTS)).toHaveLength(10);

        expect(store(SCHEMA_TYPE.CUSTOM_FIELDS)).toHaveLength(6);
        expect(project().taskStatusData).toHaveLength(5);
        expect(project().tagsArray).toHaveLength(6);
        expect(second.summary.fields).toMatchObject({ created: [], reused: ['Budget', 'Stage', 'Launch Date', 'Approved', 'Story Points', 'Site'] });
        expect(second.summary.tags.added).toEqual([]);
    });
});
