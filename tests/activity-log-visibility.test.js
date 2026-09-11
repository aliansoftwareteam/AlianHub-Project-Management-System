jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ evaluatePermission: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { evaluatePermission } = require('../Config/permissionGuard');
const { getActivityLog } = require('../Modules/History/controller');

const C = '6f0000000000000000000c01';
const VISIBLE = '6f0000000000000000000a01';
const HIDDEN = '6f0000000000000000000a02';
const ME = '6f0000000000000000000001';
const TASK = '6f0000000000000000000b01';

const reply = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};

const readLog = async (query) => {
    const res = reply();
    await getActivityLog({ headers: { companyid: C }, uid: ME, query: { skip: '0', limit: '5', ...query } }, res);
    return res;
};

const matchOf = () => MongoDbCrudOpration.mock.calls[0][1].data[0][0][0].$match.$and;

beforeEach(() => {
    jest.clearAllMocks();
    visibleProjectIds.mockResolvedValue([VISIBLE]);
    evaluatePermission.mockResolvedValue(true);
    MongoDbCrudOpration.mockResolvedValue([{ Message: 'renamed' }]);
});

describe('TSK-06 the activity log follows project visibility', () => {
    it('answers 404 for a project the caller cannot see, without reading history', async () => {
        const res = await readLog({ fromProject: 'true', projectId: HIDDEN });
        expect(res.statusCode).toBe(404);
        expect(res.body.status).toBe(false);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('answers 404 for a task log in a project the caller cannot see', async () => {
        const res = await readLog({ fromProject: 'false', projectId: HIDDEN, taskId: TASK });
        expect(res.statusCode).toBe(404);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('answers 403 for a visible project when the project list permission is None', async () => {
        evaluatePermission.mockResolvedValue(null);
        const res = await readLog({ fromProject: 'true', projectId: VISIBLE });
        expect(res.statusCode).toBe(403);
        expect(evaluatePermission).toHaveBeenCalledWith(C, ME, 'project.project_list', { projectId: VISIBLE });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('answers 403 for a task log when Task Activity Log is not switched on', async () => {
        evaluatePermission.mockResolvedValue(false);
        const res = await readLog({ fromProject: 'false', projectId: VISIBLE, taskId: TASK });
        expect(res.statusCode).toBe(403);
        expect(evaluatePermission).toHaveBeenCalledWith(C, ME, 'task.task_activity_log', { projectId: VISIBLE });
    });

    it('returns the project log to a caller who can see the project', async () => {
        const res = await readLog({ fromProject: 'true', projectId: VISIBLE });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual([{ Message: 'renamed' }]);
        expect(matchOf()).toEqual([{ Type: 'project' }, { ProjectId: VISIBLE }]);
    });

    it('returns a task log and treats an operator in the query as a plain value', async () => {
        const res = await readLog({ fromProject: 'false', projectId: VISIBLE, taskId: { $ne: '' } });
        expect(res.statusCode).toBe(200);
        expect(matchOf()[2]).toEqual({ TaskId: '[object Object]' });
    });

    it('refuses a missing or malformed project id', async () => {
        expect((await readLog({ fromProject: 'true', projectId: { $ne: '' } })).statusCode).toBe(400);
        expect((await readLog({ fromProject: 'false', projectId: VISIBLE })).statusCode).toBe(400);
    });
});
