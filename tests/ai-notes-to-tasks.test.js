/* Task 043 slice 8: call notes and doc pages become tasks through a preview. The model only reads
   what the caller can open, owners are people who belong to the company and can open the project,
   and the ticked items are created by the same preparation and create path POST /api/v2/tasks uses. */
const { create } = require('./fixtures/fakeMongo');

const COMPANY = '6a9954186dd786246031e47b';
const PROJECT_A = '6a9954186dd786246031e4a1';
const PROJECT_B = '6a9954186dd786246031e4b1';
const PROJECT_C = '6a9954186dd786246031e4c1';
const SPRINT_A = '6a9954186dd786246031e4a2';
const NOTES = '6a9954186dd786246031e4d1';
const NOTES_WITHOUT_ALICE = '6a9954186dd786246031e4d2';
const NOTES_EXTRACTED = '6a9954186dd786246031e4d3';
const PAGE = '6a9954186dd786246031e4e1';
const HIDDEN_PAGE = '6a9954186dd786246031e4e2';
const PRIVATE_PAGE = '6a9954186dd786246031e4e3';
const ALICE = '6f0000000000000000000d01';
const BOB = '6f0000000000000000000d02';
const CAROL = '6f0000000000000000000d03';
const DAVE = '6f0000000000000000000d04';

const mockDbs = {};
const mockDbFor = (companyId) => {
    const key = String(companyId);
    if (!mockDbs[key]) mockDbs[key] = create();
    return mockDbs[key];
};
const mockChat = jest.fn();
const mockCreate = jest.fn();
const mockArchive = jest.fn();

const mockOpens = {
    '6f0000000000000000000d01': ['6a9954186dd786246031e4a1', '6a9954186dd786246031e4b1'],
    '6f0000000000000000000d02': ['6a9954186dd786246031e4a1'],
    '6f0000000000000000000d03': ['6a9954186dd786246031e4a1', '6a9954186dd786246031e4b1'],
    '6f0000000000000000000d04': ['6a9954186dd786246031e4b1'],
};
const mockActive = ['6f0000000000000000000d01', '6f0000000000000000000d02', '6f0000000000000000000d04'];
const mockNames = { '6f0000000000000000000d01': 'Alice Ng', '6f0000000000000000000d02': 'Bob Stone', '6f0000000000000000000d03': 'Carol Diaz', '6f0000000000000000000d04': 'Dave Fox' };
const mockNoCreate = new Set(['6a9954186dd786246031e4b1']);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, ...rest) => mockDbFor(companyId).crud(companyId, ...rest),
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({
    visibleProjectIds: jest.fn(async (companyId, uid) => mockOpens[String(uid)] || []),
    visibleProjects: jest.fn(async (companyId, uid) => (mockOpens[String(uid)] || []).map((id) => ({ _id: id, ProjectName: `Project ${id.slice(-2)}` }))),
}));
jest.mock('../Config/contentAccess', () => ({
    projectAccess: jest.fn(async (companyId, uid, projectId) => ((mockOpens[String(uid)] || []).includes(String(projectId))
        ? { visible: true, canEdit: true, statusCode: 200 }
        : { visible: false, canEdit: false, statusCode: 404 })),
    isCompanyMember: jest.fn(async (companyId, uid) => mockActive.includes(String(uid))),
    isCompanyAdmin: jest.fn(async () => false),
}));
jest.mock('../Config/permissionGuard', () => ({
    ...jest.requireActual('../Config/permissionGuard'),
    evaluatePermission: jest.fn(async (companyId, uid, key, { projectId } = {}) => !(key === 'task.task_create' && mockNoCreate.has(String(projectId)))),
}));
jest.mock('../utils/companyMembers', () => ({
    activeMemberIds: jest.fn(async (companyId, ids) => [...new Set((ids || []).map(String))].filter((id) => mockActive.includes(id))),
    memberProfiles: jest.fn(async (companyId, ids) => [...new Set((ids || []).map(String))].map((id) => ({ _id: id, Employee_Name: mockNames[id] }))),
}));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({
    taskMongo: {
        create: (...args) => mockCreate(...args),
        updateArchiveDelete: (...args) => mockArchive(...args),
    },
}));
jest.mock('../Modules/AICore/llmProvider', () => ({
    isAnyProviderConfigured: () => true,
    getProvider: () => ({ chat: (...args) => mockChat(...args) }),
}));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const aiSwitch = require('../Modules/AICore/aiSwitch');
const { FEATURES } = require('../Modules/AICore/features');
const notesToTasks = require('../Modules/AI/notesToTasks');

const oid = (id) => new mongoose.Types.ObjectId(id);

const respond = () => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    res.send = jest.fn(() => res);
    return res;
};
const statusOf = (res) => (res.status.mock.calls.length ? res.status.mock.calls[res.status.mock.calls.length - 1][0] : 200);
const bodyOf = (res) => {
    const calls = [...res.json.mock.calls, ...res.send.mock.calls];
    return calls.length ? calls[calls.length - 1][0] : undefined;
};

const call = async (handler, uid, body) => {
    const res = respond();
    await handler({ headers: { companyid: COMPANY }, aud: COMPANY, uid, body }, res);
    return { status: statusOf(res), body: bodyOf(res) };
};
const propose = (uid, body) => call(notesToTasks.proposeHandler, uid, body);
const createTasks = (uid, body) => call(notesToTasks.createHandler, uid, body);
const undo = (uid, body) => call(notesToTasks.undoHandler, uid, body);

const promptSent = () => mockChat.mock.calls[0][0].messages.map((m) => m.content).join('\n');
const db = () => mockDbFor(COMPANY);
const stored = (type, id) => db().crud(COMPANY, { type, data: [{ _id: oid(id) }] }, 'findOne');

let createdSeq = 0;

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    mockChat.mockReset();
    mockChat.mockResolvedValue({
        content: JSON.stringify({
            actionItems: [
                { title: 'Send the deck', owner: 'Bob', due: '2026-10-02' },
                { title: 'Book the venue', owner: 'Carol', due: '' },
                { title: 'Draft the budget', owner: 'Dave', due: '' },
                { title: 'Write the recap', owner: '', due: 'Friday' },
                { title: 'Tidy the wiki', owner: '', due: 'soon' },
            ],
        }),
    });
    mockCreate.mockReset();
    mockCreate.mockImplementation(async () => {
        createdSeq += 1;
        return { status: true, id: oid(`6c00000000000000000000${String(createdSeq).padStart(2, '0')}`) };
    });
    mockArchive.mockReset();
    mockArchive.mockResolvedValue({ status: true });
    delete process.env.AI_ENABLED;
    aiSwitch.forget();

    const status = { key: 1, name: 'To do', type: 'default_active', value: 'to_do' };
    db().seed(SCHEMA_TYPE.PROJECTS, {
        _id: oid(PROJECT_A), ProjectName: 'Launch', ProjectCode: 'LAU', CompanyId: COMPANY, lastTaskId: 4,
        taskStatusData: [status], taskTypeCounts: [{ key: 1, value: 'task', name: 'Task' }], deletedStatusKey: 0,
    });
    db().seed(SCHEMA_TYPE.PROJECTS, {
        _id: oid(PROJECT_B), ProjectName: 'Ops', ProjectCode: 'OPS', CompanyId: COMPANY,
        taskStatusData: [status], taskTypeCounts: [{ key: 1, value: 'task', name: 'Task' }], deletedStatusKey: 0,
    });
    db().seed(SCHEMA_TYPE.SPRINTS, { _id: oid(SPRINT_A), name: 'Backlog', projectId: oid(PROJECT_A), deletedStatusKey: 0, createdAt: new Date('2026-01-01') });

    db().seed(SCHEMA_TYPE.CALLS, {
        _id: oid(NOTES), callId: 'c1', title: 'Launch sync', projectId: PROJECT_A, participants: [ALICE, BOB, CAROL],
        transcript: 'Bob: I will send the deck by Friday. Carol: I can book the venue.', summary: 'Launch planning.',
        actionItems: [], deletedStatusKey: 0, createdAt: new Date('2026-09-28T10:00:00Z'),
    });
    db().seed(SCHEMA_TYPE.CALLS, {
        _id: oid(NOTES_WITHOUT_ALICE), callId: 'c2', title: 'Private', participants: [BOB],
        transcript: 'Bob alone: secret salary numbers', actionItems: [], deletedStatusKey: 0,
    });
    db().seed(SCHEMA_TYPE.CALLS, {
        _id: oid(NOTES_EXTRACTED), callId: 'c3', title: 'Retro', projectId: PROJECT_A, participants: [ALICE, BOB],
        transcript: 'Bob: I will fix the build.', actionItems: [{ id: 'ai_1', title: 'Fix the build', owner: 'Bob', due: '2026-10-05', at: '', done: false, taskId: '' }],
        deletedStatusKey: 0,
    });

    db().seed(SCHEMA_TYPE.PAGES, {
        _id: oid(PAGE), title: 'Launch plan', ProjectID: oid(PROJECT_A), visibility: 'project', createdBy: BOB,
        rawText: 'Launch plan. Dave will draft the budget. Bob sends the deck on 2026-10-02.', linkedTasks: [], deletedStatusKey: 0,
    });
    db().seed(SCHEMA_TYPE.PAGES, {
        _id: oid(HIDDEN_PAGE), title: 'Board', ProjectID: oid(PROJECT_C), visibility: 'project', createdBy: BOB,
        rawText: 'Board-only acquisition notes', linkedTasks: [], deletedStatusKey: 0,
    });
    db().seed(SCHEMA_TYPE.PAGES, {
        _id: oid(PRIVATE_PAGE), title: 'Mine', ProjectID: oid(PROJECT_A), visibility: 'private', createdBy: BOB,
        rawText: 'Bob private diary', linkedTasks: [], deletedStatusKey: 0,
    });
    [ALICE, BOB, DAVE].forEach((userId) => db().seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2 }));
    db().seed(SCHEMA_TYPE.COMPANY_USERS, { userId: CAROL, status: 2, isDelete: true });
});

describe('proposing tasks from call notes', () => {
    test('a participant gets the model\'s items, built from those notes, with spend booked to them', async () => {
        const { status, body } = await propose(ALICE, { kind: 'call', id: NOTES });

        expect(status).toBe(200);
        expect(body.status).toBe(true);
        expect(body.data.items.map((item) => item.title)).toEqual(['Send the deck', 'Book the venue', 'Draft the budget', 'Write the recap', 'Tidy the wiki']);
        expect(promptSent()).toContain('I will send the deck by Friday');
        expect(mockChat.mock.calls[0][0].spend).toEqual({ feature: FEATURES.ACTION_ITEMS, companyId: COMPANY, userId: ALICE });
        expect(body.data.projectId).toBe(PROJECT_A);
        expect(body.data.projects.map((p) => p.id)).toEqual([PROJECT_A]);
    });

    test('owners are only participants who are active members and can open the project', async () => {
        const { body } = await propose(ALICE, { kind: 'call', id: NOTES });
        const owners = Object.fromEntries(body.data.items.map((item) => [item.title, item.ownerId]));

        expect(owners['Send the deck']).toBe(BOB);
        expect(owners['Book the venue']).toBe('');
        expect(owners['Draft the budget']).toBe('');
        expect(body.data.people.map((p) => p.id).sort()).toEqual([ALICE, BOB].sort());
        expect(body.data.people.find((p) => p.id === BOB).projectIds).toEqual([PROJECT_A]);
    });

    test('a stated date becomes the due date, a weekday counts from the call, and a vague one stays text', async () => {
        const { body } = await propose(ALICE, { kind: 'call', id: NOTES });
        const byTitle = Object.fromEntries(body.data.items.map((item) => [item.title, item]));

        expect(byTitle['Send the deck'].due).toBe('2026-10-02');
        expect(byTitle['Write the recap'].due).toBe('2026-10-02');
        expect(byTitle['Tidy the wiki'].due).toBe('');
        expect(byTitle['Tidy the wiki'].dueText).toBe('soon');
    });

    test('notes the caller did not take part in are not read and nothing is spent', async () => {
        const { body } = await propose(ALICE, { kind: 'call', id: NOTES_WITHOUT_ALICE });

        expect(body.status).toBe(false);
        expect(mockChat).not.toHaveBeenCalled();
    });

    test('action items already extracted are used without another model call', async () => {
        const { body } = await propose(ALICE, { kind: 'call', id: NOTES_EXTRACTED });

        expect(mockChat).not.toHaveBeenCalled();
        expect(body.data.items).toEqual([expect.objectContaining({ key: 'ai_1', title: 'Fix the build', ownerId: BOB, due: '2026-10-05' })]);
    });

    test('with AI off nothing is sent to the model', async () => {
        process.env.AI_ENABLED = 'false';
        const { status, body } = await propose(ALICE, { kind: 'call', id: NOTES });

        expect(status).toBe(403);
        expect(body.status).toBe(false);
        expect(mockChat).not.toHaveBeenCalled();
    });
});

describe('proposing tasks from a doc page', () => {
    test('the model reads the page and the tasks go to the page\'s project', async () => {
        const { body } = await propose(ALICE, { kind: 'page', id: PAGE });

        expect(body.status).toBe(true);
        expect(promptSent()).toContain('Dave will draft the budget');
        expect(body.data.projectId).toBe(PROJECT_A);
        expect(body.data.fixedProject).toBe(true);
        const owners = Object.fromEntries(body.data.items.map((item) => [item.title, item.ownerId]));
        expect(owners['Send the deck']).toBe(BOB);
        expect(owners['Draft the budget']).toBe('');
    });

    test('a page in a project the caller cannot open is never read', async () => {
        const { body } = await propose(ALICE, { kind: 'page', id: HIDDEN_PAGE });

        expect(body.status).toBe(false);
        expect(mockChat).not.toHaveBeenCalled();
    });

    test('someone else\'s private page is never read', async () => {
        const { body } = await propose(ALICE, { kind: 'page', id: PRIVATE_PAGE });

        expect(body.status).toBe(false);
        expect(mockChat).not.toHaveBeenCalled();
    });
});

describe('creating the ticked items', () => {
    const items = [
        { key: 'a', title: 'Send the deck', ownerId: BOB, due: '2026-10-02' },
        { key: 'b', title: 'Book the venue', ownerId: CAROL, due: '' },
        { key: 'c', title: 'Draft the budget', ownerId: DAVE, due: '' },
    ];

    test('each item goes through the task create path with a link back to the notes', async () => {
        const { body } = await createTasks(ALICE, { kind: 'call', id: NOTES, projectId: PROJECT_A, items });

        expect(body.status).toBe(true);
        expect(mockCreate).toHaveBeenCalledTimes(3);
        const [first] = mockCreate.mock.calls[0];
        expect(first.data).toEqual(expect.objectContaining({
            TaskName: 'Send the deck', ProjectID: PROJECT_A, CompanyId: COMPANY, sprintId: SPRINT_A,
            Task_Leader: ALICE, AssigneeUserId: [BOB], isParentTask: true, deletedStatusKey: 0,
        }));
        expect(new Date(first.data.DueDate).toISOString().slice(0, 10)).toBe('2026-10-02');
        expect(first.data.description).toContain(`#/${COMPANY}/chat-notes/${NOTES}`);
        expect(first.user).toEqual(expect.objectContaining({ id: ALICE }));
        expect(first.projectData).toEqual(expect.objectContaining({ _id: PROJECT_A, CompanyId: COMPANY, ProjectCode: 'LAU' }));
        expect(body.data.created.map((row) => row.key)).toEqual(['a', 'b', 'c']);
    });

    test('an owner outside the company or the project is dropped, not assigned', async () => {
        await createTasks(ALICE, { kind: 'call', id: NOTES, projectId: PROJECT_A, items });

        const assignees = mockCreate.mock.calls.map(([payload]) => payload.data.AssigneeUserId);
        expect(assignees).toEqual([[BOB], [], []]);
    });

    test('the notes remember which tasks their items became', async () => {
        const { body } = await createTasks(ALICE, { kind: 'call', id: NOTES_EXTRACTED, projectId: PROJECT_A, items: [{ key: 'ai_1', title: 'Fix the build', ownerId: BOB, due: '' }] });
        const notes = await stored(SCHEMA_TYPE.CALLS, NOTES_EXTRACTED);

        expect(notes.actionItems[0].taskId).toBe(body.data.created[0].taskId);
        expect(notes.actionItems[0].projectId).toBe(PROJECT_A);
    });

    test('a doc page links the new tasks and each task links back to the page', async () => {
        const { body } = await createTasks(ALICE, { kind: 'page', id: PAGE, items: [items[0]] });
        const page = await stored(SCHEMA_TYPE.PAGES, PAGE);

        expect(body.status).toBe(true);
        expect(mockCreate.mock.calls[0][0].data.ProjectID).toBe(PROJECT_A);
        expect(mockCreate.mock.calls[0][0].data.description).toContain(`#/${COMPANY}/pages/${PAGE}`);
        expect(page.linkedTasks.map(String)).toEqual([body.data.created[0].taskId]);
    });

    test('a project the caller cannot create tasks in gets nothing', async () => {
        const { status, body } = await createTasks(ALICE, { kind: 'call', id: NOTES, projectId: PROJECT_B, items });

        expect(status).toBe(403);
        expect(body.status).toBe(false);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    test('access to the notes is checked again when creating', async () => {
        const { body } = await createTasks(ALICE, { kind: 'call', id: NOTES_WITHOUT_ALICE, projectId: PROJECT_A, items });

        expect(body.status).toBe(false);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    test('access to the page is checked again when creating', async () => {
        const { body } = await createTasks(ALICE, { kind: 'page', id: HIDDEN_PAGE, items });

        expect(body.status).toBe(false);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    test('creating calls no model', async () => {
        await createTasks(ALICE, { kind: 'call', id: NOTES, projectId: PROJECT_A, items });

        expect(mockChat).not.toHaveBeenCalled();
    });
});

describe('undo', () => {
    test('moves the created tasks to the trash and unlinks them from the source', async () => {
        const { body: made } = await createTasks(ALICE, { kind: 'page', id: PAGE, items: [{ key: 'a', title: 'Send the deck', ownerId: '', due: '' }] });
        const taskId = made.data.created[0].taskId;
        db().seed(SCHEMA_TYPE.TASKS, { _id: oid(taskId), TaskName: 'Send the deck', ProjectID: oid(PROJECT_A), Task_Leader: ALICE, deletedStatusKey: 0 });

        const { body } = await undo(ALICE, { kind: 'page', id: PAGE, taskIds: [taskId] });
        const page = await stored(SCHEMA_TYPE.PAGES, PAGE);

        expect(body.status).toBe(true);
        expect(mockArchive).toHaveBeenCalledWith(expect.objectContaining({ companyId: COMPANY, deletedStatusKey: 1, task: expect.objectContaining({ _id: expect.anything() }) }));
        expect(page.linkedTasks).toEqual([]);
    });

    test('leaves alone a task the source did not create', async () => {
        const stranger = '6c00000000000000000000ff';
        db().seed(SCHEMA_TYPE.TASKS, { _id: oid(stranger), TaskName: 'Someone else\'s', ProjectID: oid(PROJECT_A), Task_Leader: BOB, deletedStatusKey: 0 });

        const { body } = await undo(ALICE, { kind: 'page', id: PAGE, taskIds: [stranger] });

        expect(body.data.removed).toEqual([]);
        expect(mockArchive).not.toHaveBeenCalled();
    });
});

describe('parseDue', () => {
    test('reads ISO dates and the relative words the model may still return', () => {
        const today = new Date('2026-09-28T09:00:00Z');
        expect(notesToTasks.parseDue('2026-10-02', today)).toBe('2026-10-02');
        expect(notesToTasks.parseDue('tomorrow', today)).toBe('2026-09-29');
        expect(notesToTasks.parseDue('Fri', today)).toBe('2026-10-02');
        expect(notesToTasks.parseDue('soon', today)).toBe('');
        expect(notesToTasks.parseDue('2026-02-31', today)).toBe('');
    });
});
