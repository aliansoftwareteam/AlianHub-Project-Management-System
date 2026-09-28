const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Agents/skillRecord', () => ({ listSkills: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const skillRecord = require('../Modules/Agents/skillRecord');
const { pinnedSources, withPinned, pin, pinnedProjectId, askSkill, MAX_PINNED } = require('../Modules/AI/askContext');

const C = '6f0000000000000000000c01';
const OTHER_C = '6f0000000000000000000c02';
const OPEN = '6f0000000000000000000a01';
const HIDDEN = '6f0000000000000000000a02';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';
const PRIVATE_SPRINT = '6f0000000000000000000d01';

const PROJECTS = [{ _id: OPEN, ProjectName: 'Ops' }];

const task = (over) => mockDb.seed(SCHEMA_TYPE.TASKS, { ProjectID: OPEN, TaskName: 'Budget review', TaskKey: 'OPS-1', deletedStatusKey: 0, statusType: 'default_active', ...over });
const page = (over) => mockDb.seed(SCHEMA_TYPE.PAGES, { ProjectID: OPEN, title: 'Runbook', rawText: 'Restart the worker first.', deletedStatusKey: 0, visibility: 'project', createdBy: OTHER, ...over });
const project = (over) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { ProjectName: 'Ops', description: 'Operations', deletedStatusKey: 0, ...over });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    getRoleType.mockResolvedValue(3);
});

describe('@ context is re-checked on the server', () => {
    it('keeps a task, doc and project the asker can open, marked as attached', async () => {
        const t = task();
        const p = page();
        project({ _id: OPEN });
        const out = await pinnedSources(C, ME, {
            context: [{ kind: 'task', id: String(t._id) }, { kind: 'page', id: String(p._id) }, { kind: 'project', id: OPEN }],
            projects: PROJECTS,
        });
        expect(out.map((s) => [s.kind, s.id])).toEqual([['task', String(t._id)], ['page', String(p._id)], ['project', OPEN]]);
        expect(out.every((s) => s.matchedBy === 'pinned')).toBe(true);
        expect(out[0]).toMatchObject({ ref: 'OPS-1', title: 'Budget review', project: 'Ops', projectId: OPEN });
        expect(out[1].detail).toContain('Restart the worker');
    });

    it('drops ids the asker cannot open, whatever the client sent', async () => {
        const hiddenTask = task({ ProjectID: HIDDEN, TaskName: 'Salaries' });
        const deletedTask = task({ deletedStatusKey: 1, TaskName: 'Old' });
        const privatePage = page({ visibility: 'private', createdBy: OTHER, title: 'Private notes' });
        const hiddenPage = page({ ProjectID: HIDDEN, title: 'Board minutes' });
        project({ _id: HIDDEN, ProjectName: 'Board' });
        const out = await pinnedSources(C, ME, {
            context: [
                { kind: 'task', id: String(hiddenTask._id) },
                { kind: 'task', id: String(deletedTask._id) },
                { kind: 'page', id: String(privatePage._id) },
                { kind: 'page', id: String(hiddenPage._id) },
                { kind: 'project', id: HIDDEN },
                { kind: 'task', id: 'not-an-id' },
                { kind: 'comment', id: String(hiddenTask._id) },
                { kind: 'task', id: { $ne: null } },
            ],
            projects: PROJECTS,
        });
        expect(out).toEqual([]);
    });

    it('drops a task in a private sprint the asker is not on', async () => {
        mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: PRIVATE_SPRINT, projectId: OPEN, private: true, AssigneeUserId: [OTHER], deletedStatusKey: 0 });
        const t = task({ sprintId: PRIVATE_SPRINT });
        const out = await pinnedSources(C, ME, { context: [{ kind: 'task', id: String(t._id) }], projects: PROJECTS });
        expect(out).toEqual([]);
    });

    it('keeps the asker\'s own private doc', async () => {
        const mine = page({ visibility: 'private', createdBy: ME, title: 'My draft' });
        const out = await pinnedSources(C, ME, { context: [{ kind: 'page', id: String(mine._id) }], projects: PROJECTS });
        expect(out.map((s) => s.title)).toEqual(['My draft']);
    });

    it('reads only the asking company\'s database', async () => {
        const t = task();
        await pinnedSources(C, ME, { context: [{ kind: 'task', id: String(t._id) }, { kind: 'project', id: OPEN }], projects: PROJECTS });
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect(mockDb.calls.every((call) => call.companyId === C)).toBe(true);
        expect(mockDb.calls.some((call) => call.companyId === OTHER_C)).toBe(false);
    });

    it('caps what one question can attach and ignores repeats', async () => {
        const many = Array.from({ length: MAX_PINNED + 4 }, (_, i) => task({ TaskName: `Task ${i}`, TaskKey: `OPS-${i + 10}` }));
        const context = [...many, many[0]].map((t) => ({ kind: 'task', id: String(t._id) }));
        const out = await pinnedSources(C, ME, { context, projects: PROJECTS });
        expect(out).toHaveLength(MAX_PINNED);
        expect(new Set(out.map((s) => s.id)).size).toBe(MAX_PINNED);
    });

    it('answers nothing for a missing or malformed context', async () => {
        expect(await pinnedSources(C, ME, { context: undefined, projects: PROJECTS })).toEqual([]);
        expect(await pinnedSources(C, ME, { context: 'OPS-1', projects: PROJECTS })).toEqual([]);
        expect(mockDb.calls).toHaveLength(0);
    });
});

describe('attached sources lead the gathered ones', () => {
    it('lists attached sources first and drops the same source found by the search', () => {
        const found = { kind: 'task', id: 'a', ref: 'OPS-1' };
        const other = { kind: 'page', id: 'b', ref: 'page:b' };
        const attached = { kind: 'task', id: 'a', ref: 'OPS-1', matchedBy: 'pinned' };
        const out = withPinned({ sources: [found, other], projects: PROJECTS }, [attached]);
        expect(out.sources).toEqual([attached, other]);
        expect(out.projects).toBe(PROJECTS);
    });

    it('uses a single attached project as the scope when none was chosen', () => {
        expect(pinnedProjectId([{ kind: 'project', id: OPEN }])).toBe(OPEN);
        expect(pinnedProjectId([{ kind: 'project', id: OPEN }, { kind: 'project', id: HIDDEN }])).toBe('');
        expect(pinnedProjectId([{ kind: 'task', id: OPEN }])).toBe('');
        expect(pinnedProjectId(null)).toBe('');
    });

    it('pin() adds attached sources and tells the model they were attached', async () => {
        const t = task();
        const out = await pin(C, ME, { sources: [], projects: PROJECTS }, { context: [{ kind: 'task', id: String(t._id) }] });
        expect(out.gathered.sources.map((s) => s.id)).toEqual([String(t._id)]);
        expect(out.system).toMatch(/attached/i);
    });

    it('pin() changes nothing without context or skill', async () => {
        const gathered = { sources: [{ kind: 'task', id: 'a' }], projects: PROJECTS };
        const out = await pin(C, ME, gathered, {});
        expect(out.gathered).toEqual(gathered);
        expect(out.system).toBe('');
    });
});

describe('/ skill', () => {
    it('resolves a live skill of the company by key and shapes the prompt with it', async () => {
        skillRecord.listSkills.mockResolvedValue([
            { key: 'digest.ceo', name: 'Reporter', description: 'Posts a short digest.', enabled: true },
            { key: 'off', name: 'Off', description: 'x', enabled: false },
        ]);
        expect(await askSkill(C, 'digest.ceo')).toEqual({ key: 'digest.ceo', name: 'Reporter', description: 'Posts a short digest.' });
        expect(skillRecord.listSkills).toHaveBeenCalledWith(C);
        expect(await askSkill(C, 'off')).toBeNull();
        expect(await askSkill(C, 'missing')).toBeNull();
        expect(await askSkill(C, '')).toBeNull();

        const out = await pin(C, ME, { sources: [], projects: PROJECTS }, { skill: 'digest.ceo' });
        expect(out.system).toContain('Reporter');
        expect(out.system).toMatch(/not acting|changes nothing/i);
    });
});
