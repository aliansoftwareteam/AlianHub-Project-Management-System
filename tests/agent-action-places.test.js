const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn(() => true) }));
jest.mock('../Modules/Agents/memory', () => ({ contextFor: jest.fn(async () => '') }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const actions = require('../Modules/Agents/actions');
const codeSkills = require('../Modules/Agents/skills');
const { canUsePage } = require('../Modules/Pages/helpers/pageAccess');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_OPEN, L_SECRET, T_OPEN, T_SECRET, T_PRIVATE, OPENS, settle } = world;
const { seed, rows, task } = world.create(mockDb);

const EVERYONE = [OWNER, ADMIN, INSIDER, OUTSIDER, GUEST];
const P_NOWHERE = '6f0000000000000000000aff';
const L_NOWHERE = '6f0000000000000000000bff';
const T_NOWHERE = '6f0000000000000000000dff';
const AGENT = '6f0000000000000000000f01';
const RUN = '6f0000000000000000000f02';
const BRIEF = 'Rework the checkout so a returning customer pays in one step, with saved cards and an order summary.';

/* A run of a workspace agent, started by `uid`. */
const startedBy = (uid) => ({ kind: 'agent', userId: uid, agentId: AGENT, agentName: 'Writer', runId: RUN, viaAccount: 'workspace', tokenId: null });

const perform = (uid, action, params) => actions.perform({ companyId: CID, actor: startedBy(uid), action, params, reason: 'a run', allowedActions: [action] })
    .then((out) => ({ done: true, result: out.result }), (error) => ({ done: false, name: error.name, reason: error.message }))
    .then(async (outcome) => { await settle(); return outcome; });

const pages = () => rows(SCHEMA_TYPE.PAGES);
const audits = (action) => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === action);
const readersOf = async (page) => {
    const readers = [];
    for (const uid of EVERYONE) {
        if (await canUsePage(CID, page, uid)) readers.push(uid);
    }
    return readers;
};
const opensTask = (taskId) => EVERYONE.filter((uid) => OPENS[uid].includes(taskId));

const grant = (parentKey, keys) => {
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.key === parentKey && rule.isParent)
        || mockDb.seed(SCHEMA_TYPE.RULES, { key: parentKey, name: parentKey, isParent: true, roles: [] });
    keys.forEach((key) => mockDb.seed(SCHEMA_TYPE.RULES, { key, name: key, isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: true }] }));
};

beforeEach(() => {
    seed();
    grant('project', ['project_details']);
    grant('task', ['task_attachments', 'sub_task_create', 'task_create']);
    grant('sheet_settings', ['user_timesheet']);
});

describe('a doc an agent drafts for a task', () => {
    /* The changes the PRD writer proposes for a task, as a run compiles them. */
    const prdChanges = async (taskId, uid) => {
        const skill = codeSkills.getSkill('prd.draft');
        const row = { ...task(taskId), description: BRIEF };
        const context = await skill.gather({ task: row, companyId: CID, startedBy: uid });
        return skill.toChanges({ task: row, raw: { title: 'One-step checkout', prd: '# One-step checkout\n\n## Problem\nReturning customers drop off.', questions: [], summary: 'A PRD.' }, context }).changes;
    };
    const drafted = async (taskId, uid) => {
        const change = (await prdChanges(taskId, uid)).find((entry) => entry.action === 'page.draft');
        return perform(uid, change.action, change.params);
    };

    it.each([
        ['an open list', T_OPEN, OUTSIDER, P_OPEN, 'project', EVERYONE],
        ['a private project', T_PRIVATE, INSIDER, P_PRIVATE, 'project', [OWNER, ADMIN, INSIDER]],
        ['a private list', T_SECRET, INSIDER, P_OPEN, 'private', [INSIDER]],
        ['a private list its starter reads as an owner', T_SECRET, OWNER, P_OPEN, 'private', [OWNER]],
    ])('written by the PRD writer for a task in %s is read by nobody who cannot open that task', async (label, taskId, uid, projectId, visibility, readers) => {
        expect((await drafted(taskId, uid)).done).toBe(true);

        const [page] = pages();
        expect(page).toMatchObject({ createdBy: uid, visibility, agentStatus: 'draft', createdByAgent: true });
        expect(String(page.ProjectID)).toBe(projectId);
        expect(page.linkedTasks.map(String)).toEqual([taskId]);
        expect(await readersOf(page)).toEqual(readers);
        expect(readers.filter((reader) => !opensTask(taskId).includes(reader))).toEqual([]);
    });

    it('that names a task and no project is filed in the task\'s project', async () => {
        expect((await perform(INSIDER, 'page.draft', { title: 'Plan', text: 'First', taskId: T_PRIVATE })).done).toBe(true);
        expect((await perform(INSIDER, 'page.draft', { title: 'Plan', text: 'First', taskId: T_SECRET })).done).toBe(true);

        expect(pages().map((page) => [String(page.ProjectID), page.visibility])).toEqual([[P_PRIVATE, 'project'], [P_OPEN, 'private']]);
        expect(await readersOf(pages()[0])).toEqual([OWNER, ADMIN, INSIDER]);
        expect(await readersOf(pages()[1])).toEqual([INSIDER]);
    });

    it('that names a task and another project is refused, and nothing is saved', async () => {
        const out = await perform(INSIDER, 'page.draft', { title: 'Plan', text: 'First', taskId: T_PRIVATE, projectId: P_OPEN });

        expect(out).toMatchObject({ done: false, name: 'RefusedError', reason: expect.stringMatching(/^permission_denied/) });
        expect(pages()).toEqual([]);
        expect(audits('agent.action_refused')).toHaveLength(1);
        await expect(actions.executors['page.draft']({ companyId: CID, actor: startedBy(INSIDER), params: { title: 'Plan', text: 'First', taskId: T_PRIVATE, projectId: P_OPEN } })).rejects.toThrow(/task's project/);
        expect(pages()).toEqual([]);
    });

    it('for a task in a project where its person cannot start a doc is refused', async () => {
        expect(await perform(GUEST, 'page.draft', { title: 'Plan', text: 'First', taskId: T_OPEN })).toMatchObject({ done: false, name: 'RefusedError', reason: expect.stringMatching(/^permission_denied/) });
        expect(pages()).toEqual([]);
    });

    it('that names no task is filed for the project it names, as before', async () => {
        expect((await perform(OUTSIDER, 'page.draft', { title: 'Plan', text: 'First', projectId: P_OPEN })).done).toBe(true);
        expect(pages()[0]).toMatchObject({ visibility: 'project', linkedTasks: [] });
        expect(String(pages()[0].ProjectID)).toBe(P_OPEN);
    });
});

describe('a task change an agent makes for a person', () => {
    const CHANGES = [
        ['task.status.set', (taskId) => ({ taskId, status: { name: 'In progress' } })],
        ['task.link', (taskId) => ({ taskId, url: 'https://example.com/pull/1' })],
        ['task.assign', (taskId) => ({ taskId, assigneeIds: [OUTSIDER] })],
        ['task.update', (taskId) => ({ taskId, fields: { TaskName: 'Renamed' } })],
        ['task.sprint.move', (taskId) => ({ taskId, sprintId: L_OPEN })],
        ['subtask.create', (taskId) => ({ taskId, title: 'A part' })],
        ['timelog.start', (taskId) => ({ taskId })],
        ['timelog.stop', (taskId) => ({ taskId })],
    ];
    const stored = () => JSON.stringify([rows(SCHEMA_TYPE.TASKS), rows(SCHEMA_TYPE.TIMESHEET)]);

    describe.each(CHANGES)('%s', (action, paramsFor) => {
        it.each([
            ['in a private list', T_SECRET],
            ['in a private project', T_PRIVATE],
            ['that does not exist', T_NOWHERE],
        ])('is refused and recorded for a task %s that its person cannot open', async (label, taskId) => {
            const before = stored();
            const out = await perform(OUTSIDER, action, paramsFor(taskId));

            expect(out).toMatchObject({ done: false, name: 'RefusedError', reason: expect.stringMatching(/^not_visible/) });
            expect(stored()).toBe(before);
            expect(audits('agent.action')).toHaveLength(0);
            expect(audits('agent.action_refused')[0].meta).toMatchObject({ action, ran: false });
        });

        it('answers a task its person cannot open as one that does not exist', async () => {
            expect((await perform(OUTSIDER, action, paramsFor(T_SECRET))).reason).toBe((await perform(OUTSIDER, action, paramsFor(T_NOWHERE))).reason);
        });
    });

    it('is made on a task its person can open', async () => {
        expect((await perform(INSIDER, 'task.link', { taskId: T_SECRET, url: 'https://example.com/pull/1' })).done).toBe(true);
        expect((await perform(OUTSIDER, 'task.link', { taskId: T_OPEN, url: 'https://example.com/pull/2' })).done).toBe(true);
        expect((await perform(OWNER, 'task.link', { taskId: T_PRIVATE, url: 'https://example.com/pull/3' })).done).toBe(true);
        expect((await perform(OUTSIDER, 'timelog.start', { taskId: T_OPEN })).done).toBe(true);

        expect([T_SECRET, T_OPEN, T_PRIVATE].map((taskId) => task(taskId).links.length)).toEqual([1, 1, 1]);
        expect(rows(SCHEMA_TYPE.TIMESHEET)).toHaveLength(1);
        expect(audits('agent.action_refused')).toHaveLength(0);
    });

    it('does not move a task into a list its person cannot open', async () => {
        const hidden = await perform(OUTSIDER, 'task.sprint.move', { taskId: T_OPEN, sprintId: L_SECRET });
        const missing = await perform(OUTSIDER, 'task.sprint.move', { taskId: T_OPEN, sprintId: L_NOWHERE });

        expect(hidden).toMatchObject({ done: false, name: 'RefusedError', reason: expect.stringMatching(/^not_visible/) });
        expect(hidden.reason).toBe(missing.reason);
        expect(String(task(T_OPEN).sprintId)).toBe(L_OPEN);
    });

    it('does not file a task in a project or a list its person cannot open', async () => {
        const count = rows(SCHEMA_TYPE.TASKS).length;
        const outcomes = [
            await perform(OUTSIDER, 'task.create', { projectId: P_PRIVATE, title: 'New' }),
            await perform(OUTSIDER, 'task.create', { projectId: P_NOWHERE, title: 'New' }),
            await perform(OUTSIDER, 'task.create', { projectId: P_OPEN, sprintId: L_SECRET, title: 'New' }),
            await perform(OUTSIDER, 'task.create', { projectId: P_OPEN, sprintId: L_NOWHERE, title: 'New' }),
        ];

        outcomes.forEach((out) => expect(out).toMatchObject({ done: false, name: 'RefusedError', reason: expect.stringMatching(/^not_visible/) }));
        expect(outcomes[0].reason).toBe(outcomes[1].reason);
        expect(outcomes[2].reason).toBe(outcomes[3].reason);
        expect(rows(SCHEMA_TYPE.TASKS)).toHaveLength(count);
        expect(audits('agent.action_refused')).toHaveLength(4);
    });
});
