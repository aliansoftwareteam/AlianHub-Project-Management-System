/* A ClickUp file through the real import controller and the real task create path, on the in-memory database. */
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
const { SCHEMA_TYPE } = require('../Config/schemaType');
const importers = require('../Modules/Importers/controller');
const { mergeSummaries } = require('../Modules/Importers/helpers/clickupPlan');
const guardFixture = require('./fixtures/taskWriteGuard');
const readRows = require('./fixtures/importers/clickupRichRows');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, MEMBER, OPEN_PROJECT: PROJECT } = guardFixture;
const PRIVATE_PROJECT = '6f0000000000000000000a09';
const SPRINT = '6f0000000000000000000e01';
const PRIVATE_SPRINT = '6f0000000000000000000e02';
const LEE = '6f0000000000000000000007';
const guard = guardFixture.create(mockDb);
const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const store = (type) => mockDb.store[type] || [];
const taskNamed = (name) => store(SCHEMA_TYPE.TASKS).find((task) => task.TaskName === name);
const fieldNamed = (name) => store(SCHEMA_TYPE.CUSTOM_FIELDS).find((field) => field.fieldTitle === name);
const valueOf = (taskName, fieldName) => ((taskNamed(taskName).customField || {})[String(fieldNamed(fieldName)._id)] || {}).fieldValue;
const labelsOf = (taskName, fieldName) => (valueOf(taskName, fieldName) || []).map((id) => fieldNamed(fieldName).fieldOptions.find((option) => option.id === id).label);
const commentsOn = (taskName) => store(SCHEMA_TYPE.COMMENTS).filter((comment) => String(comment.taskId) === String(taskNamed(taskName)._id));
const writes = () => Object.fromEntries(Object.entries(mockDb.store).map(([type, rows]) => [type, rows.length]));

const seed = () => {
    guard.reset();
    Object.assign(store(SCHEMA_TYPE.PROJECTS).find((project) => project._id === PROJECT), {
        ProjectName: 'Web', ProjectCode: 'WEB', CompanyId: CID,
        taskStatusData: [{ name: 'To Do', key: 1, type: 'default_active' }],
        tagsArray: [{ uid: 'tag-launch', tagName: 'Launch', tagColor: '#000000', tagBgColor: '#00000035' }],
    });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, {
        _id: PRIVATE_PROJECT, ProjectName: 'Private', ProjectCode: 'PRV', CompanyId: CID, isGlobalPermission: true, isPrivateSpace: true, AssigneeUserId: [OWNER, MEMBER],
        taskStatusData: [{ name: 'To Do', key: 1, type: 'default_active' }],
    });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: SPRINT, name: 'Sprint 1', projectId: PROJECT });
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, name: 'Sprint 1', projectId: PRIVATE_PROJECT });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner', Employee_Email: 'owner@company.test' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: MEMBER, Employee_Name: 'Max Member', Employee_Email: 'max@member.test' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: LEE, Employee_Name: 'Lee Private', Employee_Email: 'lee@private.test' });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: LEE, roleType: 3, status: 2, isDelete: false });
    jest.clearAllMocks();
};

const call = async (handler, body, uid = OWNER) => {
    const res = { code: 200 };
    res.status = (code) => { res.code = code; return res; };
    res.send = (payload) => { res.body = payload; return res; };
    res.json = res.send;
    await handler({ uid, headers: { companyid: CID }, body }, res);
    await settle();
    return res;
};

const importRows = (over = {}, uid = OWNER) => call(importers.importFromClickUp, { rows: readRows(), projectId: PROJECT, sprintId: SPRINT, options: { createMissingStatuses: true }, ...over }, uid);
const preview = (over = {}, uid = OWNER) => call(importers.previewClickUp, { rows: readRows(), projectId: PROJECT, options: { createMissingStatuses: true }, ...over }, uid);

beforeEach(seed);

describe('a ClickUp file imported into a project', () => {
    it('creates the tasks on three levels', async () => {
        const res = await importRows();
        expect(res.body.status).toBe(true);
        expect(res.body.data).toMatchObject({ created: 4, summary: { tasks: 2, subtasks: { level2: 1, level3: 1 } } });
        expect(String(taskNamed('Write the invite').ParentTaskId)).toBe(String(taskNamed('Plan the launch')._id));
        expect(String(taskNamed('Proofread').ParentTaskId)).toBe(String(taskNamed('Write the invite')._id));
        expect(taskNamed('Proofread').ancestors.map(String)).toEqual([String(taskNamed('Plan the launch')._id), String(taskNamed('Write the invite')._id)]);
    });

    it('creates each field once, as a field of the project, and a second import reuses them', async () => {
        const first = await importRows();
        const created = store(SCHEMA_TYPE.CUSTOM_FIELDS).filter((field) => field.fieldDescription === 'Imported from ClickUp.');
        expect(created.map((field) => [field.fieldTitle, field.fieldType])).toEqual([
            ['Budget', 'money'], ['Stage', 'dropdown'], ['Areas', 'dropdown'], ['Approved', 'checkbox'], ['Contact', 'email'], ['Phone', 'phone'],
            ['Spec', 'url'], ['Reviewers', 'people'], ['Score', 'rating'], ['Done so far', 'progress'], ['Site', 'text'], ['Story Points', 'number'],
            ['Launch Date', 'date'], ['Client', 'text'], ['Notes', 'textarea'],
        ]);
        created.forEach((field) => expect(field).toMatchObject({ global: false, projectId: [PROJECT], type: 'task', isDelete: true, userId: OWNER }));
        expect(first.body.data.summary.fields).toMatchObject({ created: created.map((field) => field.fieldTitle), reused: [], asText: ['Site'] });

        const second = await importRows();
        expect(store(SCHEMA_TYPE.CUSTOM_FIELDS).filter((field) => field.fieldDescription === 'Imported from ClickUp.')).toHaveLength(15);
        expect(second.body.data.summary.fields).toMatchObject({ created: [], reused: created.map((field) => field.fieldTitle), valuesSet: 22, valuesDropped: 7 });
    });

    it('sets the values that fit, leaves out the ones that do not, and counts both', async () => {
        const res = await importRows();
        expect(valueOf('Plan the launch', 'Budget')).toBe('1200.5');
        expect(labelsOf('Plan the launch', 'Stage')).toEqual(['Discovery']);
        expect(labelsOf('Plan the launch', 'Areas')).toEqual(['Web', 'Mobile']);
        expect(valueOf('Plan the launch', 'Approved')).toBe(true);
        expect(valueOf('Plan the launch', 'Spec')).toBe('https://example.test/spec');
        expect(valueOf('Plan the launch', 'Reviewers')).toEqual([MEMBER]);
        expect(valueOf('Plan the launch', 'Score')).toBe(4);
        expect(valueOf('Plan the launch', 'Done so far')).toBe(60);
        expect(valueOf('Plan the launch', 'Launch Date')).toBe('2026-02-01T00:00:00.000Z');
        expect(labelsOf('Proofread', 'Stage')).toEqual(['Discovery']);
        expect(valueOf('Proofread', 'Score')).toBe(7);

        const invite = taskNamed('Write the invite').customField;
        expect(Object.keys(invite).sort()).toEqual([fieldNamed('Stage'), fieldNamed('Areas'), fieldNamed('Story Points')].map((field) => String(field._id)).sort());

        expect(res.body.data.summary.fields).toMatchObject({ valuesSet: 22, valuesDropped: 7 });
        expect(res.body.data.droppedFieldValues).toBe(7);
    });

    it('brings the comments of every level, in order, each with its author and its time', async () => {
        const res = await importRows();
        expect(commentsOn('Plan the launch').filter((comment) => comment.type === 'text').map((comment) => [comment.message, String(comment.userId), comment.createdAt && comment.createdAt.toISOString()])).toEqual([
            ['Kick-off is on Monday', MEMBER, '2026-01-05T09:00:00.000Z'],
            ['Pat Example: Room is booked', OWNER, '2026-01-06T10:30:00.000Z'],
        ]);
        expect(commentsOn('Write the invite').map((comment) => [comment.message, String(comment.userId)])).toEqual([['Draft is in the doc', MEMBER]]);
        expect(commentsOn('Proofread').filter((comment) => comment.type === 'text').map((comment) => [comment.message, String(comment.userId)])).toEqual([
            ['ghost@nowhere.test: Two typos fixed', OWNER],
            ['Ready to send', OWNER],
        ]);
        commentsOn('Proofread').forEach((comment) => expect({ project: comment.project, projectId: String(comment.projectId), sprintId: String(comment.sprintId) }).toEqual({ project: false, projectId: PROJECT, sprintId: SPRINT }));
        expect(res.body.data.summary.comments).toEqual({ imported: 5, skipped: 0, reason: '', unmatchedAuthors: ['Pat Example', 'ghost@nowhere.test'] });
    });

    it('announces no imported comment: no socket event, no unread count, no notice', async () => {
        await importRows();
        expect(store(SCHEMA_TYPE.COMMENTS).length).toBeGreaterThan(0);
        expect(socketEmitter.emit.mock.calls.filter(([, payload]) => payload && String(payload.module).startsWith('comments'))).toEqual([]);
        expect(notificationCounts.updateUnReadCommentsCountFun).not.toHaveBeenCalled();
        expect(Object.keys(commentsController).filter((name) => commentsController[name].mock.calls.length)).toEqual([]);
    });

    it('stores a comment as text alone: no file key, whatever the file names', async () => {
        const rows = readRows().slice(0, 1);
        rows[0].Comments = JSON.stringify([{ text: 'see the file', by: 'Pat', mediaURL: `Project/${PROJECT}/${SPRINT}/6f0000000000000000000b99/Comments/secret.png`, attachment: { url: 'k' }, type: 'image' }]);
        await importRows({ rows });
        const comments = store(SCHEMA_TYPE.COMMENTS);
        expect(comments.map((comment) => comment.type).sort()).toEqual(['link', 'text']);
        comments.forEach((comment) => expect(Object.keys(comment).filter((field) => /media|attachment|url/i.test(field))).toEqual([]));
        expect(comments.find((comment) => comment.type === 'text').message).toBe('Pat: see the file');
        expect(comments.map((comment) => comment.importedFrom)).toEqual(['clickup', 'clickup']);
    });

    it('brings checklists with their done state, on a task and on a subtask', async () => {
        const res = await importRows();
        const rowsOf = (name) => taskNamed(name).checklistArray.map((row) => [row.name, row.isChecked, row.parentId ? 'item' : 'checklist']);
        expect(rowsOf('Plan the launch')).toEqual([['Before launch', false, 'checklist'], ['Book the room', false, 'item'], ['Send invites', false, 'item']]);
        expect(rowsOf('Write the invite')).toEqual([['Copy', false, 'checklist'], ['Draft', true, 'item'], ['Review', false, 'item']]);
        const [head, ...items] = taskNamed('Write the invite').checklistArray;
        expect(items.map((item) => item.parentId)).toEqual([head.id, head.id]);
        expect(res.body.data.summary.checklistItems).toBe(4);
    });

    it('reuses the project\'s tags and adds the missing ones', async () => {
        const res = await importRows();
        const tags = store(SCHEMA_TYPE.PROJECTS).find((project) => project._id === PROJECT).tagsArray;
        expect(tags.map((tag) => tag.tagName)).toEqual(['Launch', 'urgent', 'archive']);
        expect(taskNamed('Plan the launch').tagsArray).toEqual(['tag-launch', tags[1].uid]);
        expect(taskNamed('Write the invite').tagsArray).toEqual(['tag-launch']);
        expect(res.body.data.summary.tags).toEqual({ added: ['urgent', 'archive'], skipped: [] });
    });

    it('turns attachments into links to ClickUp: on the task, and in a comment the task panel shows; no file is stored', async () => {
        const res = await importRows();
        const launch = taskNamed('Plan the launch');
        expect(launch.links.map(({ url, kind, label, addedBy }) => ({ url, kind, label, addedBy }))).toEqual([
            { url: 'https://files.clickup.test/t1/brief.pdf', kind: 'link', label: 'brief.pdf', addedBy: OWNER },
            { url: 'https://files.clickup.test/t1/shot.png', kind: 'link', label: 'shot.png', addedBy: OWNER },
        ]);
        expect(launch.attachments).toEqual([]);
        expect(taskNamed('Proofread').links).toHaveLength(1);
        expect(commentsOn('Plan the launch').find((comment) => comment.type === 'link')).toMatchObject({
            userId: OWNER,
            message: 'Attachments in ClickUp:\nbrief.pdf: https://files.clickup.test/t1/brief.pdf\nshot.png: https://files.clickup.test/t1/shot.png',
        });
        expect(res.body.data.summary.links).toBe(3);
    });

    it('assigns members by email and reports the people it could not match', async () => {
        const res = await importRows();
        expect(taskNamed('Plan the launch').AssigneeUserId).toEqual([MEMBER, LEE]);
        expect(res.body.data.summary.people).toEqual({ unmatched: ['ghost@nowhere.test', 'Pat Example'], cannotOpen: [] });
        expect(res.body.data.unmatchedAssignees).toEqual(['ghost@nowhere.test', 'Pat Example']);
    });

    it('does not assign or name a member who cannot open the project, and reports them', async () => {
        const rows = readRows();
        rows[0]['Reviewers (users)'] = '[max@member.test, lee@private.test]';
        const res = await importRows({ rows, projectId: PRIVATE_PROJECT, sprintId: PRIVATE_SPRINT });
        expect(res.body.status).toBe(true);
        expect(taskNamed('Plan the launch').AssigneeUserId).toEqual([MEMBER]);
        expect(valueOf('Plan the launch', 'Reviewers')).toEqual([MEMBER]);
        expect(res.body.data.summary.people).toEqual({ unmatched: ['ghost@nowhere.test', 'Pat Example'], cannotOpen: ['lee@private.test'] });
    });
});

describe('the preview of a ClickUp import', () => {
    it('writes nothing', async () => {
        const before = writes();
        const res = await preview();
        expect(res.body.status).toBe(true);
        expect(writes()).toEqual(before);
        expect(store(SCHEMA_TYPE.CUSTOM_FIELDS)).toHaveLength(0);
        expect(store(SCHEMA_TYPE.PROJECTS).find((project) => project._id === PROJECT).tagsArray).toHaveLength(1);
    });

    it('counts what the import then brings in, list by list', async () => {
        const planned = (await preview()).body.data;
        expect(planned.plan).toMatchObject({
            tasks: 2, subtasks: { level2: 1, level3: 1 }, checklistItems: 4, links: 3,
            comments: { imported: 5, skipped: 0 },
            fields: { valuesSet: 22, valuesDropped: 7, asText: ['Site'], reused: [] },
            tags: { added: ['urgent', 'archive'], skipped: [] },
            people: { unmatched: ['ghost@nowhere.test', 'Pat Example'], cannotOpen: [] },
        });
        expect(planned.plan.fields.created).toHaveLength(15);

        const rows = readRows();
        const summaries = [];
        for (const list of planned.lists) {
            const res = await importRows({ rows: list.rowIndexes.map((index) => rows[index]) });
            summaries.push(res.body.data.summary);
        }
        expect(mergeSummaries(summaries)).toEqual(planned.plan);
    });

    it('plans new projects when no project is named: every field is new to each', async () => {
        const res = await preview({ projectId: undefined });
        expect(res.body.data.plan.fields.created).toHaveLength(15);
        expect(res.body.data.plan.tags).toEqual({ added: ['launch', 'urgent', 'archive'], skipped: [] });
    });
});

describe('what a ClickUp import may write follows the person importing', () => {
    it('imports the tasks and skips the field columns for a member who may not edit fields', async () => {
        guard.setRule(null, 'task_custom_field', false);
        const res = await importRows({ options: { createMissingStatuses: false } }, MEMBER);
        expect(res.body.status).toBe(true);
        expect(res.body.data.created).toBe(4);
        expect(store(SCHEMA_TYPE.CUSTOM_FIELDS)).toHaveLength(0);
        expect(taskNamed('Plan the launch').customField || {}).toEqual({});
        expect(res.body.data.summary.fields).toMatchObject({ created: [], reused: [], reason: 'no_permission', valuesSet: 0, valuesDropped: 0 });
        expect(res.body.data.summary.fields.skipped).toHaveLength(15);
        expect(res.body.data.summary.comments.imported).toBe(5);
    });

    it('says the same in the preview', async () => {
        guard.setRule(null, 'task_custom_field', false);
        const res = await preview({ options: { createMissingStatuses: false } }, MEMBER);
        expect(res.body.data.plan.fields).toMatchObject({ created: [], reason: 'no_permission', valuesSet: 0 });
        expect(res.body.data.plan.fields.skipped).toHaveLength(15);
        expect(res.body.data.plan.tags).toEqual({ added: [], skipped: ['urgent', 'archive'] });
    });

    it('imports the tasks without their comments for a member who may not comment', async () => {
        guard.setRule(null, 'task_comment', false);
        const res = await importRows({ options: { createMissingStatuses: false } }, MEMBER);
        expect(res.body.status).toBe(true);
        expect(store(SCHEMA_TYPE.COMMENTS)).toHaveLength(0);
        expect(res.body.data.summary.comments).toEqual({ imported: 0, skipped: 5, reason: 'no_permission', unmatchedAuthors: [] });
        expect(taskNamed('Plan the launch').links).toHaveLength(2);
    });

    it('keeps a colleague\'s comments under the importing member, with the colleague\'s name in front', async () => {
        const res = await importRows({ options: { createMissingStatuses: false } }, LEE);
        expect(res.body.status).toBe(true);
        expect(commentsOn('Plan the launch').filter((comment) => comment.type === 'text').map((comment) => [comment.message, String(comment.userId)])).toEqual([
            ['max@member.test: Kick-off is on Monday', LEE],
            ['Pat Example: Room is booked', LEE],
        ]);
        expect(commentsOn('Write the invite').map((comment) => [comment.message, String(comment.userId)])).toEqual([['Max Member: Draft is in the doc', LEE]]);
        expect(res.body.data.summary.comments.unmatchedAuthors).toEqual(['max@member.test', 'Pat Example', 'Max Member', 'ghost@nowhere.test']);
    });

    it('keeps the importing member\'s own comments as theirs', async () => {
        await importRows({ options: { createMissingStatuses: false } }, MEMBER);
        expect(commentsOn('Write the invite').map((comment) => [comment.message, String(comment.userId)])).toEqual([['Draft is in the doc', MEMBER]]);
    });

    it('imports nothing for a member who may not create tasks', async () => {
        guard.setRule(null, 'task_create', false);
        const res = await importRows({ options: { createMissingStatuses: false } }, MEMBER);
        expect(res.code).toBe(403);
        expect(store(SCHEMA_TYPE.TASKS).filter((task) => task.TaskName)).toHaveLength(0);
        expect(store(SCHEMA_TYPE.CUSTOM_FIELDS)).toHaveLength(0);
        expect(store(SCHEMA_TYPE.COMMENTS)).toHaveLength(0);
    });
});
