jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: (r) => [1, 2].includes(r) }));
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { getRoleType } = require('../Config/permissionGuard');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { __internals } = require('../Modules/Inbox/controller');

describe('agent proposals in the main Inbox', () => {
    it('maps a pending proposal to a needs-you row for an owner', async () => {
        getRoleType.mockResolvedValueOnce(1);
        const pending = [{ _id: 'p1', agentName: 'Reporter', what: 'digest.ceo: 1 change(s) on AR-48', why: 'Board digest', changes: [{}], taskId: 't1', projectId: 'pr1', createdAt: '2026-09-04T09:36:12Z', cost: { usd: 0.003 } }];
        MongoDbCrudOpration.mockImplementation(async (companyId, { type }) => (type === SCHEMA_TYPE.AGENT_PROPOSALS ? pending : []));
        const rows = await __internals.readProposals('c1', 'u1');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ kind: 'proposal', sourceType: 'proposal', proposalId: 'p1', agentName: 'Reporter', changes: 1, unread: true });
        const [, read] = MongoDbCrudOpration.mock.calls.find(([, query]) => query.type === SCHEMA_TYPE.AGENT_PROPOSALS);
        expect(read.data[0]).toEqual({ status: 'pending' });
    });
    it('shows nothing to a member who cannot approve', async () => {
        getRoleType.mockResolvedValueOnce(3);
        expect(await __internals.readProposals('c1', 'u2')).toEqual([]);
    });
});
