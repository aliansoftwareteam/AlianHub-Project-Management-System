/* Migration 082 retires the Slack workspace bot (task 074): the bot token at Slack, its secrets, its row, the posts
   still waiting on it, and one bell notice to owners and admins. A person's own Slack connection is left alone, and a second run changes nothing. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/secrets', () => ({ retire: jest.fn(async () => 'revoked'), resolve: jest.fn(async ({ handle }) => (handle === 'sec_bot' ? 'xoxb-bot-token' : 'signing')) }));
jest.mock('../Modules/Connectors/providerApi', () => ({ revoke: jest.fn(async () => ({ ok: true, body: { revoked: true } })) }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Modules/Inbox/helpers/workspaceNotice', () => ({ ownersAndAdmins: jest.fn(async () => ['owner-1', 'admin-1']), sendNotice: jest.fn(async () => {}) }));

const { buildContext } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const store = require('../Config/secrets');
const { recordAudit } = require('../Modules/Audit/recorder');
const { sendNotice } = require('../Modules/Inbox/helpers/workspaceNotice');
const providerApi = require('../Modules/Connectors/providerApi');
const migration = require('../migrations/082-retire-slack-bot');

const C = '6f00000000000000000000c1';
const T = SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
const P = SCHEMA_TYPE.AGENT_PROPOSALS;
const quiet = { info: jest.fn(), error: jest.fn() };
const ctx = () => buildContext({ MongoDbCrudOpration: mockDb.crud, SCHEMA_TYPE, logger: quiet, listCompanies: async () => [{ _id: C }] });
const rows = (type) => mockDb.store[type] || [];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(T, { _id: 'bot', connector: 'slack', secretHandles: { bot_token: 'sec_bot', signing_secret: 'sec_sign' }, allowedChannels: [{ id: 'C1', name: 'general', post: true }], deletedStatusKey: 0 });
    mockDb.seed(T, { _id: 'mine', provider: 'slack', userId: 'u1', handles: { refresh: 'sec_r', access: 'sec_a' }, status: 'connected', deletedStatusKey: 0 });
    mockDb.seed(P, { _id: 'old-post', status: 'pending', changes: [{ action: 'slack.message.post', params: { channelId: 'C1', text: 'hi' } }] });
    mockDb.seed(P, { _id: 'new-post', status: 'pending', changes: [{ action: 'slack.message.post', params: { channel: 'general', text: 'hi', connectionId: 'mine' } }] });
    mockDb.seed(P, { _id: 'other', status: 'pending', changes: [{ action: 'task.comment', params: { text: 'x' } }] });
});

describe('082-retire-slack-bot', () => {
    it('asks Slack to revoke the bot token, and never sends it the signing secret', async () => {
        await migration.retireCompany(ctx(), C);
        expect(providerApi.revoke).toHaveBeenCalledTimes(1);
        expect(providerApi.revoke).toHaveBeenCalledWith(expect.objectContaining({ companyId: C, token: 'xoxb-bot-token', definition: expect.objectContaining({ id: 'slack' }) }));
        expect(recordAudit).toHaveBeenCalledWith(C, expect.objectContaining({ meta: expect.objectContaining({ atSlack: ['revoked'] }) }));
    });

    it.each([
        ['Slack cannot be reached', () => providerApi.revoke.mockRejectedValueOnce(new Error('offline')), 'failed'],
        ['Slack refuses the token', () => providerApi.revoke.mockResolvedValueOnce({ ok: false, error: 'invalid_auth' }), 'failed'],
        ['the token cannot be read', () => store.resolve.mockResolvedValueOnce(null), 'unreadable'],
    ])('still retires everything when %s', async (_why, arrange, atSlack) => {
        arrange();
        await migration.retireCompany(ctx(), C);
        expect(store.retire).toHaveBeenCalledTimes(2);
        expect(rows(T).find((r) => r._id === 'bot')).toMatchObject({ deletedStatusKey: 1, status: 'retired' });
        expect(sendNotice).toHaveBeenCalledTimes(1);
        expect(recordAudit).toHaveBeenCalledWith(C, expect.objectContaining({ meta: expect.objectContaining({ atSlack: [atSlack] }) }));
    });

    it('retires the bot secrets, closes its row, declines its waiting posts and tells owners and admins', async () => {
        await migration.retireCompany(ctx(), C);
        expect(store.retire.mock.calls.map(([arg]) => arg.handle).sort()).toEqual(['sec_bot', 'sec_sign']);
        expect(rows(T).find((r) => r._id === 'bot')).toMatchObject({ deletedStatusKey: 1, secretHandles: {}, allowedChannels: [], status: 'retired' });
        expect(rows(P).find((p) => p._id === 'old-post')).toMatchObject({ status: 'declined', declineReason: expect.stringMatching(/bot was retired/) });
        expect(sendNotice).toHaveBeenCalledWith(C, ['owner-1', 'admin-1'], expect.objectContaining({ key: 'connector_slack_bot_retired' }));
        expect(recordAudit).toHaveBeenCalledWith(C, expect.objectContaining({ action: 'connector.revoke', entityId: 'slack', meta: expect.objectContaining({ secrets: 2, expired: 1 }) }));
    });

    it('leaves a person\'s own Slack connection and their posts alone', async () => {
        await migration.retireCompany(ctx(), C);
        expect(rows(T).find((r) => r._id === 'mine')).toMatchObject({ deletedStatusKey: 0, status: 'connected', handles: { refresh: 'sec_r', access: 'sec_a' } });
        expect(rows(P).find((p) => p._id === 'new-post').status).toBe('pending');
        expect(rows(P).find((p) => p._id === 'other').status).toBe('pending');
    });

    it('changes nothing on a second run', async () => {
        await migration.up(ctx());
        jest.clearAllMocks();
        expect(await migration.retireCompany(ctx(), C)).toEqual({ retired: 0, expired: 0, told: 0 });
        expect(store.retire).not.toHaveBeenCalled();
        expect(providerApi.revoke).not.toHaveBeenCalled();
        expect(sendNotice).not.toHaveBeenCalled();
    });

    it('does nothing in a workspace that never had the bot', async () => {
        mockDb.store[T].length = 0;
        expect(await migration.retireCompany(ctx(), C)).toEqual({ retired: 0, expired: 0, told: 0 });
        expect(sendNotice).not.toHaveBeenCalled();
    });
});
