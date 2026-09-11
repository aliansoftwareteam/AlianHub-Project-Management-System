const mockChat = jest.fn();
const mockCrud = jest.fn(async () => []);

jest.mock('../Modules/AICore/llmProvider', () => ({
    getProvider: () => ({ name: 'fake', chat: (...a) => mockChat(...a) }),
    isAnyProviderConfigured: () => true,
}));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async () => []), getActiveSkillSlugs: jest.fn(async () => []) }));
jest.mock('../Modules/AIProjectGenerator/orchestrator', () => ({ normalizePlanColors: (p) => p }));
jest.mock('../Modules/AIProjectGenerator/sseEmitter', () => ({ emit: jest.fn(), handleEvents: jest.fn(), COMPLETE_EVENT: 'complete' }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    evaluatePermission: jest.fn(),
    isWritable: (value) => value === true || value === 1 || value === 2,
}));

const scope = require('../Modules/Agents/scope');
const guard = require('../Config/permissionGuard');
const { canEditProject } = require('../Modules/AIProjectGenerator/projectAccess');
const ctrl = require('../Modules/AIProjectGenerator/controller');

const C = '6f0000000000000000000c01';
const OPEN = '6f0000000000000000000a01';
const PRIVATE = '6f0000000000000000000a02';
const GUEST = '6f0000000000000000000004';

const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (projectId, body) => ({ headers: { companyid: C }, aud: [C], uid: GUEST, params: { projectId }, body });

beforeEach(() => {
    jest.clearAllMocks();
    scope.visibleProjectIds.mockResolvedValue([OPEN]);
    guard.evaluatePermission.mockResolvedValue(true);
});

describe('AUT-07 canEditProject', () => {
    it('hides a project the caller cannot open', async () => {
        expect(await canEditProject({ companyId: C, uid: GUEST, projectId: PRIVATE, permissions: ['task.task_create'] })).toEqual({ hidden: true });
        expect(guard.evaluatePermission).not.toHaveBeenCalled();
    });

    it('forbids a visible project when a permission is not writable there', async () => {
        guard.evaluatePermission.mockResolvedValue(false);
        expect(await canEditProject({ companyId: C, uid: GUEST, projectId: OPEN, permissions: ['task.task_create'] })).toEqual({ forbidden: 'task.task_create' });
        expect(guard.evaluatePermission).toHaveBeenCalledWith(C, GUEST, 'task.task_create', { projectId: OPEN });
    });

    it('forbids when the rules cannot be read', async () => {
        guard.evaluatePermission.mockRejectedValue(new Error('db down'));
        expect((await canEditProject({ companyId: C, uid: GUEST, projectId: OPEN, permissions: ['task.task_create'] })).forbidden).toBe('task.task_create');
    });

    it('allows a visible project with every permission writable', async () => {
        expect(await canEditProject({ companyId: C, uid: GUEST, projectId: OPEN, permissions: ['project.project_sprint_create'] })).toEqual({ projectId: OPEN });
    });
});

describe('AUT-07 AI task generation refuses projects the caller cannot open', () => {
    it('answers 404 to tasks/execute on a hidden project and writes nothing', async () => {
        const out = res();
        await ctrl.tasksExecute(req(PRIVATE, { mode: 'sprints', plan: { sprints: [{ sprintName: 'Injected' }] } }), out);
        expect(out.code).toBe(404);
        expect(out.body).toEqual({ status: false, statusText: 'Project not found' });
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('answers 403 to tasks/execute when the caller may not create sprints there', async () => {
        guard.evaluatePermission.mockResolvedValue(false);
        const out = res();
        await ctrl.tasksExecute(req(OPEN, { mode: 'sprints', plan: { sprints: [{ sprintName: 'Injected' }] } }), out);
        expect(out.code).toBe(403);
        expect(guard.evaluatePermission).toHaveBeenCalledWith(C, GUEST, 'project.project_sprint_create', { projectId: OPEN });
    });

    it('answers 404 to tasks/plan on a hidden project before any model call', async () => {
        const out = res();
        await ctrl.tasksPlan(req(PRIVATE, { mode: 'full' }), out);
        expect(out.code).toBe(404);
        expect(mockChat).not.toHaveBeenCalled();
    });
});
