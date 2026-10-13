const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjects: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => false) }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Knowledge/flag', () => ({ enabledFor: jest.fn(async () => false) }));
jest.mock('../Modules/Knowledge/askSources', () => ({ askSources: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjects } = require('../Modules/Agents/scope');
const { getRoleType } = require('../Config/permissionGuard');
const { getProvider, isAnyProviderConfigured } = require('../Modules/AICore/llmProvider');
const knowledgeFlag = require('../Modules/Knowledge/flag');
const { askSources } = require('../Modules/Knowledge/askSources');
const { ask, gather, promptFor } = require('../Modules/AI/ask');

const C = '6f0000000000000000000c01';
const SMOKE = '6f0000000000000000000a01';
const PLATFORM = '6f0000000000000000000a02';
const ME = '6f0000000000000000000001';
const PRIYA = '6f0000000000000000000002';
const PRIVATE_SPRINT = '6f0000000000000000000d01';
const NOW = new Date('2026-09-28T10:00:00Z');
const QUESTION = 'Which tasks in Local Smoke are overdue?';

const STATUSES = [
    { type: 'default_active', name: 'To Do', key: 1 },
    { type: 'active', name: 'In Progress', key: 3 },
    { type: 'done', name: 'Done', key: 2 },
];
const PROJECTS = [
    { _id: SMOKE, ProjectName: 'Local Smoke', ProjectCode: 'SMOKE', taskStatusData: STATUSES, isPrivateSpace: false, deletedStatusKey: 0 },
    { _id: PLATFORM, ProjectName: 'AlianHub Platform', ProjectCode: 'AP', taskStatusData: STATUSES, isPrivateSpace: false, deletedStatusKey: 0 },
];

const days = (n) => new Date(NOW.getTime() + n * 86400000);
let keySeq = 0;
const task = (projectId, over) => {
    keySeq += 1;
    const code = projectId === SMOKE ? 'SMOKE' : 'AP';
    return mockDb.seed(SCHEMA_TYPE.TASKS, {
        TaskKey: `${code}-${keySeq}`, ProjectID: projectId, deletedStatusKey: 0, statusKey: 1, statusType: 'default_active',
        status: { text: 'To Do', key: 1, type: 'default_active' }, AssigneeUserId: [ME], updatedAt: days(-10), ...over,
    });
};
const filtered = (out) => out.sources.filter((s) => s.matchedBy === 'filter');
const titlesOf = (list) => list.map((s) => s.title).sort();

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    keySeq = 0;
    getRoleType.mockResolvedValue(3);
    knowledgeFlag.enabledFor.mockResolvedValue(false);
    isAnyProviderConfigured.mockReturnValue(false);
    PROJECTS.forEach((p) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { ...p }));
    visibleProjects.mockResolvedValue(PROJECTS.map((p) => ({ _id: p._id, ProjectName: p.ProjectName })));
    [ME, PRIYA].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: 3, status: 2, isDelete: false }));
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: ME, Employee_Name: 'Mevil Bhojani', Employee_FName: 'Mevil', Employee_LName: 'Bhojani' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: PRIYA, Employee_Name: 'Priya Shah', Employee_FName: 'Priya', Employee_LName: 'Shah' });

    task(SMOKE, { TaskName: 'Smoke login flow', DueDate: days(-3) });
    task(SMOKE, { TaskName: 'Smoke billing page', DueDate: days(-2), statusKey: 3, statusType: 'active', status: { text: 'In Progress', key: 3, type: 'active' } });
    task(SMOKE, { TaskName: 'Smoke invite email', DueDate: days(-1), AssigneeUserId: [PRIYA] });
    task(SMOKE, { TaskName: 'Smoke closed check', DueDate: days(-4), statusKey: 2, statusType: 'close', status: { text: 'Done', key: 2, type: 'close' } });
    task(SMOKE, { TaskName: 'Smoke later work', DueDate: days(5) });
    task(SMOKE, { TaskName: 'Smoke undated', DueDate: null });
    task(SMOKE, { TaskName: 'Smoke deleted', DueDate: days(-5), deletedStatusKey: 1 });
    task(PLATFORM, { TaskName: 'Platform overdue tasks report', DueDate: days(-6), rawDescription: 'Which tasks are overdue across the platform' });
});

afterEach(() => jest.useRealTimers());

describe('Ask answers a structured question from a scoped task query', () => {
    it('returns the three overdue Local Smoke tasks, ahead of text passages', async () => {
        const out = await gather(C, ME, { question: QUESTION, now: NOW });
        expect(titlesOf(filtered(out))).toEqual(['Smoke billing page', 'Smoke invite email', 'Smoke login flow']);
        expect(out.sources.slice(0, 3).every((s) => s.matchedBy === 'filter')).toBe(true);
        expect(out.sources.some((s) => s.projectId === PLATFORM)).toBe(false);
        expect(out.intent).toMatchObject({ projects: [{ id: SMOKE, name: 'Local Smoke' }], due: 'overdue', total: 3, listed: 3, timeZone: 'UTC' });
    });

    it('describes each row by key, status, assignee and due date', async () => {
        const out = await gather(C, ME, { question: QUESTION, now: NOW });
        const row = filtered(out).find((s) => s.title === 'Smoke invite email');
        expect(row).toMatchObject({ kind: 'task', ref: 'SMOKE-3', project: 'Local Smoke', projectId: SMOKE, status: 'To Do', assignees: ['Priya Shah'] });
        expect(row.detail).toContain('Priya Shah');
        expect(row.detail).toContain('2026-09-27');
    });

    it('tells the model the list is complete for the filter, with its count', () => {
        const intent = { projects: [{ id: SMOKE, name: 'Local Smoke' }], due: 'overdue', dueBefore: '2026-09-28', total: 3, listed: 3, timeZone: 'UTC', today: '2026-09-28' };
        const prompt = promptFor(QUESTION, [{ kind: 'task', ref: 'SMOKE-1', project: 'Local Smoke', title: 'Smoke login flow', detail: 'To Do', matchedBy: 'filter' }], intent);
        expect(prompt).toMatch(/3 tasks/);
        expect(prompt).toMatch(/complete/i);
        expect(prompt).toContain('Local Smoke');
        expect(prompt).toContain('[SMOKE-1]');
    });

    it('keeps promptFor working with the two arguments it always took', () => {
        const prompt = promptFor('budget', [{ kind: 'task', ref: 'OPS-1', project: 'Ops', title: 'Budget review', detail: '' }]);
        expect(prompt).toBe('QUESTION:\nbudget\n\nSOURCES:\n[OPS-1] task · Ops · Budget review');
    });

    it('reads due dates in the asker\'s own timezone', async () => {
        mockDb.store[SCHEMA_TYPE.USERS].find((u) => u._id === ME).Time_Zone = 'Asia/Kolkata';
        task(SMOKE, { TaskName: 'Smoke due this Kolkata morning', DueDate: new Date('2026-09-27T20:00:00Z') });
        const out = await gather(C, ME, { question: QUESTION, now: NOW });
        expect(titlesOf(filtered(out))).not.toContain('Smoke due this Kolkata morning');
        expect(out.intent.timeZone).toBe('Asia/Kolkata');

        mockDb.store[SCHEMA_TYPE.USERS].find((u) => u._id === ME).Time_Zone = '';
        const utc = await gather(C, ME, { question: QUESTION, now: NOW });
        expect(titlesOf(filtered(utc))).toContain('Smoke due this Kolkata morning');
    });

    it('narrows to the asker\'s own tasks for "my"', async () => {
        const out = await gather(C, ME, { question: 'Which of my tasks in Local Smoke are overdue?', now: NOW });
        expect(titlesOf(filtered(out))).toEqual(['Smoke billing page', 'Smoke login flow']);
    });

    it('narrows to a named member', async () => {
        const out = await gather(C, ME, { question: 'What is overdue for Priya Shah?', now: NOW });
        expect(titlesOf(filtered(out))).toEqual(['Smoke invite email']);
    });

    it('returns the response additively, with the intent beside the sources', async () => {
        jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        isAnyProviderConfigured.mockReturnValue(true);
        const chat = jest.fn(async () => ({ content: 'Three are overdue [SMOKE-1] [SMOKE-2] [SMOKE-3].', totalTokens: 10, model: 'm' }));
        getProvider.mockReturnValue({ chat });
        const res = { send: jest.fn() };
        await ask({ headers: { companyid: C }, uid: ME, body: { question: QUESTION } }, res);
        const { data } = res.send.mock.calls[0][0];
        expect(Object.keys(data)).toEqual(expect.arrayContaining(['configured', 'mode', 'answer', 'cited', 'sources', 'scope', 'usage', 'intent']));
        expect(data.intent).toMatchObject({ due: 'overdue', total: 3 });
        expect(data.cited).toHaveLength(3);
        expect(chat.mock.calls[0][0].messages[0].content).toMatch(/3 tasks/);
    });

    it('adds the structured rows ahead of retrieval passages when knowledge retrieval is on', async () => {
        knowledgeFlag.enabledFor.mockResolvedValue(true);
        askSources.mockResolvedValue([{ kind: 'page', id: '6f0000000000000000000b01', ref: 'page:000b01', title: 'Smoke plan', project: 'Local Smoke', projectId: SMOKE, detail: '' }]);
        const out = await gather(C, ME, { question: QUESTION, now: NOW });
        expect(out.sources.map((s) => s.title)).toEqual(['Smoke login flow', 'Smoke billing page', 'Smoke invite email', 'Smoke plan']);
        expect(askSources.mock.calls[0][0].projectId).toBe(SMOKE);
    });
});

describe('the structured query never widens access', () => {
    it('returns nothing from a project the asker cannot open, and says nothing about it', async () => {
        visibleProjects.mockResolvedValue([{ _id: PLATFORM, ProjectName: 'AlianHub Platform' }]);
        const hidden = await gather(C, ME, { question: QUESTION, now: NOW });
        const missing = await gather(C, ME, { question: 'Which tasks in Nothing Here are overdue?', now: NOW });
        expect(hidden.sources.some((s) => s.projectId === SMOKE)).toBe(false);
        expect(hidden.intent.projects).toBeUndefined();
        expect(hidden.intent).toEqual(missing.intent);
    });

    it('keeps an API token inside the projects it is narrowed to', async () => {
        const out = await gather(C, ME, { question: QUESTION, now: NOW, tokenProjectIds: [PLATFORM] });
        expect(out.sources.some((s) => s.projectId === SMOKE)).toBe(false);
        expect(out.intent.projects).toBeUndefined();
    });

    it('leaves out a task in a private sprint the asker is not on', async () => {
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, projectId: SMOKE, private: true, AssigneeUserId: [PRIYA], deletedStatusKey: 0 });
        task(SMOKE, { TaskName: 'Smoke private sprint work', DueDate: days(-2), sprintId: PRIVATE_SPRINT });
        const out = await gather(C, ME, { question: QUESTION, now: NOW });
        expect(titlesOf(filtered(out))).not.toContain('Smoke private sprint work');
        expect(out.intent.total).toBe(3);
    });

    it('keeps the private-sprint task for an admin', async () => {
        getRoleType.mockResolvedValue(2);
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, projectId: SMOKE, private: true, AssigneeUserId: [PRIYA], deletedStatusKey: 0 });
        task(SMOKE, { TaskName: 'Smoke private sprint work', DueDate: days(-2), sprintId: PRIVATE_SPRINT });
        const out = await gather(C, ME, { question: QUESTION, now: NOW });
        expect(titlesOf(filtered(out))).toContain('Smoke private sprint work');
    });

    it('does not resolve a name outside the company', async () => {
        mockDb.store[SCHEMA_TYPE.COMPANY_USERS].find((m) => m.userId === PRIYA).isDelete = true;
        const out = await gather(C, ME, { question: 'What is overdue for Priya Shah?', now: NOW });
        expect(out.intent.assignee).toBeUndefined();
    });

    it('leaves a plain text question exactly as before', async () => {
        const out = await gather(C, ME, { question: 'platform report', now: NOW });
        expect(out.intent).toBeUndefined();
        expect(out.sources.map((s) => s.title)).toEqual(['Platform overdue tasks report']);
    });
});
