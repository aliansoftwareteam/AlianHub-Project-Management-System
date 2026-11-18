const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { getRoleType } = require('../Config/permissionGuard');
const { taskSchema, pagesSchema } = require('../utils/mongo-handler/createSchema');
const { askSources } = require('../Modules/Knowledge/askSources');

/* Followup 71: with retrieval on, a question naming a task key finds that task first, a key
 * the asker cannot see finds nothing, and a task's ref is its key. */

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000011';
const MEMBER = '6f0000000000000000000013';
const SPRINTER = '6f0000000000000000000014';
const SHARED = '6f0000000000000000000a01';
const SECRET = '6f0000000000000000000a02';
const PRIVATE_SPRINT = '6f0000000000000000000d02';

const ROLES = { [OWNER]: 1, [MEMBER]: 3, [SPRINTER]: 3 };
const PROJECTS = { [OWNER]: [SHARED, SECRET], [MEMBER]: [SHARED], [SPRINTER]: [SHARED] };
const PROJECT_ROWS = [{ _id: SHARED, ProjectName: 'Ops' }, { _id: SECRET, ProjectName: 'Secret' }];

const task = (over) => mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: SHARED, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over });

const sourcesFor = (uid, question) => askSources({
    companyId: C,
    uid,
    question,
    projects: PROJECT_ROWS.filter((p) => PROJECTS[uid].includes(p._id)),
});

let target;
let secret;
let hidden;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    myCache.flushAll();
    mockDb.textFromSchema(SCHEMA_TYPE.TASKS, taskSchema);
    mockDb.textFromSchema(SCHEMA_TYPE.PAGES, pagesSchema);
    getRoleType.mockImplementation(async (companyId, uid) => ROLES[uid]);
    visibleProjectIds.mockImplementation(async (companyId, uid) => PROJECTS[uid] || []);
    mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C });
    PROJECT_ROWS.forEach((p) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { ...p, deletedStatusKey: 0 }));
    mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, projectId: SHARED, private: true, AssigneeUserId: [SPRINTER] });
    [OWNER, MEMBER, SPRINTER].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, isDelete: false }));

    target = task({ TaskKey: 'OPS-12', TaskName: 'Renew vendor contract', rawDescription: 'Legal wants a signed copy.' });
    task({ TaskKey: 'OPS-3', TaskName: 'Status status status report', rawDescription: 'Weekly status for ops, item 12.' });
    task({ TaskKey: 'OPS-4', TaskName: 'Ops standup 12', rawDescription: 'What is the status?' });
    mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Status of every ops project', rawText: 'status status status ops 12', ProjectID: SHARED, visibility: 'project', deletedStatusKey: 0, updatedAt: new Date() });
    secret = task({ TaskKey: 'SEC-7', TaskName: 'Board payroll', ProjectID: SECRET });
    hidden = task({ TaskKey: 'OPS-99', TaskName: 'Quiet acquisition', sprintId: PRIVATE_SPRINT });
});

describe('a question naming a task key', () => {
    it('retrieves that task first and cites it by its key and name', async () => {
        const sources = await sourcesFor(MEMBER, 'What is the status of OPS-12?');

        expect(sources[0]).toMatchObject({ kind: 'task', id: String(target._id), ref: 'OPS-12', title: 'Renew vendor contract', project: 'Ops' });
    });

    it('matches the key however it is cased', async () => {
        const sources = await sourcesFor(MEMBER, 'any news on ops-12');

        expect(sources[0]).toMatchObject({ id: String(target._id), ref: 'OPS-12' });
    });

    it('refers to every retrieved task by its key rather than kind:id', async () => {
        const sources = await sourcesFor(MEMBER, 'status');
        const tasks = sources.filter((s) => s.kind === 'task');

        expect(tasks.length).toBeGreaterThan(0);
        tasks.forEach((s) => expect(s.ref).toMatch(/^OPS-\d+$/));
    });
});

describe('a key the asker cannot see', () => {
    it('finds a task in a project the asker cannot open for someone who can', async () => {
        const sources = await sourcesFor(OWNER, 'Where is SEC-7 at?');

        expect(sources[0]).toMatchObject({ id: String(secret._id), ref: 'SEC-7' });
    });

    it('retrieves nothing for it and leaves it out of the refs', async () => {
        const sources = await sourcesFor(MEMBER, 'Where is SEC-7 at?');

        expect(sources.map((s) => s.id)).not.toContain(String(secret._id));
        expect(sources.map((s) => s.ref)).not.toContain('SEC-7');
        expect(JSON.stringify(sources)).not.toContain('Board payroll');
    });

    it('keeps a task in a private sprint from a member the sprint is not shared with', async () => {
        const member = await sourcesFor(MEMBER, 'OPS-99');
        const sprinter = await sourcesFor(SPRINTER, 'OPS-99');

        expect(member.map((s) => s.ref)).not.toContain('OPS-99');
        expect(member.map((s) => s.id)).not.toContain(String(hidden._id));
        expect(sprinter[0]).toMatchObject({ id: String(hidden._id), ref: 'OPS-99' });
    });
});
