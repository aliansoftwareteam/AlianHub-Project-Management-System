const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Automations/engine/tools', () => ({ oid: (id) => (/^[0-9a-fA-F]{24}$/.test(String(id)) ? String(id) : null) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const scope = require('../Modules/Agents/scope');
const { buildBrief } = require('../Modules/Mcp/brief');

const C = '6f0000000000000000000c01';
const IN_SCOPE = '6f0000000000000000000a01';
const OUT_OF_SCOPE = '6f0000000000000000000a02';
const HIDDEN = '6f0000000000000000000a03';
const USER = '6f0000000000000000000001';

const ctx = (projectIds = []) => ({ companyId: C, userId: USER, projectIds });
const task = (ProjectID) => mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Brief me', TaskKey: 'K-1', CompanyId: C, ProjectID, deletedStatusKey: 0 });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    scope.visibleProjectIds.mockResolvedValue([IN_SCOPE, OUT_OF_SCOPE]);
});

describe('AUT-08 task.get stays inside the token scope and what the holder can see', () => {
    it('answers task not found for a task outside the projects the token is scoped to', async () => {
        const outside = task(OUT_OF_SCOPE);
        expect(await buildBrief(ctx([IN_SCOPE]), outside._id)).toEqual({ error: 'task not found' });
    });

    it('answers task not found for a task in a project the holder cannot open, even with no token scope', async () => {
        const hidden = task(HIDDEN);
        expect(await buildBrief(ctx(), hidden._id)).toEqual({ error: 'task not found' });
    });

    it('answers task not found for an invalid or missing id', async () => {
        expect(await buildBrief(ctx(), 'nope')).toEqual({ error: 'task not found' });
        expect(await buildBrief(ctx(), '6f00000000000000000000ff')).toEqual({ error: 'task not found' });
    });

    it('returns the brief for a task inside the scope', async () => {
        const inside = task(IN_SCOPE);
        const brief = await buildBrief(ctx([IN_SCOPE]), inside._id);
        expect(brief).toMatchObject({ taskId: inside._id, key: 'K-1', title: 'Brief me' });
    });
});
