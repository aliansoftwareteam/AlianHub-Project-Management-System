jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskMongo/internals.js', () => ({ updateTaskKey: jest.fn().mockResolvedValue(undefined) }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const registry = require('../Modules/Agents/registry');
const tools = require('../Modules/Automations/engine/tools');
const mcp = require('../Modules/Mcp/tools');

const CID = '6a8ee973d625fca52e519a12';
const PID = '6a9954186dd786246031e47b';
const OWNER = '6a8ee972d625fca52e519a05';
const project = {
    _id: PID, CompanyId: CID, ProjectCode: 'AR', userId: OWNER,
    taskStatusData: [{ name: 'Done', key: 9, type: 'close' }, { name: 'To Do', key: 1, type: 'default_active' }],
    taskTypeCounts: [{ name: 'Task', key: 1 }],
};

describe('task.create — an agent can file what it found', () => {
    beforeEach(() => MongoDbCrudOpration.mockReset());

    it('is a registered, undoable write that is not in the never list', () => {
        const a = registry.get('task.create');
        expect(a).toMatchObject({ write: true, undoable: true, risk: 'medium' });
        expect(registry.NEVER).toContain('task.delete');
        expect(registry.NEVER).not.toContain('task.create');
    });

    it('is exposed over MCP with projectId and title required', () => {
        const t = mcp.manifest().find((x) => x.name === 'task.create');
        expect(t.inputSchema.required).toEqual(['projectId', 'title']);
        const tool = mcp.TOOLS.find((x) => x.name === 'task.create');
        const p = tool.params({ projectId: PID, title: 'x'.repeat(400), priority: 'nonsense' });
        expect(p.title).toHaveLength(250);
        expect(p.priority).toBe('nonsense');
    });

    it('refuses an empty title and an unknown project before touching anything', async () => {
        await expect(tools.createTask(CID, PID, { title: '   ' })).rejects.toMatchObject({ deterministic: true });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
        MongoDbCrudOpration.mockResolvedValueOnce(null);
        await expect(tools.createTask(CID, PID, { title: 'Real' })).rejects.toThrow(/not found/);
    });

    it('refuses a project from another company even if the query returned it', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce({ ...project, CompanyId: 'someone-else' });
        await expect(tools.createTask(CID, PID, { title: 'Real' })).rejects.toThrow(/not found/);
    });

    it('always files into the opening status, unassigned, and gets the project key', async () => {
        const saved = {};
        MongoDbCrudOpration
            .mockResolvedValueOnce(project)
            .mockResolvedValueOnce([])
            .mockImplementationOnce(async (_c, q) => { Object.assign(saved, q.data); return { _id: q.data._id }; })
            .mockResolvedValueOnce({ _id: 'tid', CompanyId: CID, TaskKey: 'AR-27', TaskName: 'Found it' });
        const r = await tools.createTask(CID, PID, { title: 'Found it', priority: 'high', sprintId: '' });
        expect(saved.status).toEqual({ key: 1, value: '', text: 'To Do', type: 'default_active' });
        expect(saved.statusType).toBe('default_active');
        expect(saved.AssigneeUserId).toEqual([]);
        expect(saved.Task_Leader).toBe(OWNER);
        expect(saved.watchers).toEqual([OWNER]);
        expect(saved.isParentTask).toBe(true);
        expect(saved.Task_Priority).toBe('HIGH');
        expect(r).toEqual({ changed: true, taskId: 'tid', key: 'AR-27', title: 'Found it' });
    });

    it('records the token owner as leader when one is given, and refuses when nobody can be', async () => {
        const saved = {};
        MongoDbCrudOpration
            .mockResolvedValueOnce(project)
            .mockResolvedValueOnce([])
            .mockImplementationOnce(async (_c, q) => { Object.assign(saved, q.data); return { _id: q.data._id }; })
            .mockResolvedValueOnce({ _id: 'tid', CompanyId: CID, TaskKey: 'AR-29' });
        await tools.createTask(CID, PID, { title: 'x', leaderId: 'token-owner' });
        expect(saved.Task_Leader).toBe('token-owner');
        MongoDbCrudOpration.mockReset();
        MongoDbCrudOpration.mockResolvedValueOnce({ ...project, userId: undefined });
        await expect(tools.createTask(CID, PID, { title: 'x' })).rejects.toThrow(/task leader/);
        expect(MongoDbCrudOpration).toHaveBeenCalledTimes(1);
    });

    it('falls back to MEDIUM for a priority it does not know', async () => {
        const saved = {};
        MongoDbCrudOpration
            .mockResolvedValueOnce(project)
            .mockResolvedValueOnce([])
            .mockImplementationOnce(async (_c, q) => { Object.assign(saved, q.data); return { _id: q.data._id }; })
            .mockResolvedValueOnce({ _id: 'tid', CompanyId: CID, TaskKey: 'AR-28' });
        await tools.createTask(CID, PID, { title: 'x', priority: 'asap' });
        expect(saved.Task_Priority).toBe('MEDIUM');
    });

    it('files into the project\'s oldest live list when none is given', async () => {
        const saved = {};
        MongoDbCrudOpration
            .mockResolvedValueOnce(project)
            .mockResolvedValueOnce([{ _id: 's1', sprintName: 'List' }])
            .mockImplementationOnce(async (_c, q) => { Object.assign(saved, q.data); return { _id: q.data._id }; })
            .mockResolvedValueOnce({ _id: 'tid', CompanyId: CID, TaskKey: 'AR-30' });
        await tools.createTask(CID, PID, { title: 'Filed somewhere', sprintId: '' });
        expect(saved.sprintId).toBe('s1');
        expect(saved.sprintArray).toEqual({ id: 's1', name: 'List' });
        const listQuery = MongoDbCrudOpration.mock.calls[1][1];
        expect(listQuery.data[0].deletedStatusKey).toEqual({ $in: [0, null] });
    });

    it('refuses a sprint that belongs to a different project', async () => {
        MongoDbCrudOpration
            .mockResolvedValueOnce(project)
            .mockResolvedValueOnce({ _id: '6a9954316dd786246031e558', projectId: 'other-project' });
        await expect(tools.createTask(CID, PID, { title: 'x', sprintId: '6a9954316dd786246031e558' })).rejects.toThrow(/not in this project/);
    });
});
