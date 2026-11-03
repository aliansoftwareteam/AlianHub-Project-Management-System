const saved = [];

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: async (db, query, method) => {
        if (method === 'save') { saved.push({ db, row: query.data }); return { ...query.data, _id: `n${saved.length}` }; }
        return [];
    },
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({ status: true })) }));

const mongoose = require('mongoose');
const { schema } = require('../utils/mongo-handler/schema');
const { sendNotice } = require('../Modules/Inbox/helpers/workspaceNotice');
const logger = require('../Config/loggerConfig');

const Notification = mongoose.model('WorkspaceNoticeCheck', new mongoose.Schema(schema.notifications));

beforeEach(() => { saved.length = 0; jest.clearAllMocks(); });

test('a notice saves a row the notifications schema accepts, for the company and its global copy', async () => {
    await sendNotice('6f0000000000000000000c01', ['6f0000000000000000000a03'], {
        key: 'agent_approval_decided', type: 'agent', scope: 'agents', from: '6f0000000000000000000a01', message: 'Your request was approved.', changeData: { agentId: 'a1' },
    });

    expect(saved.map((s) => s.db)).toEqual(['6f0000000000000000000c01', 'global']);
    saved.forEach(({ row }) => expect(new Notification(row).validateSync()).toBeUndefined());
    expect(logger.error).not.toHaveBeenCalled();
});

test('each person gets a row of their own', async () => {
    await sendNotice('6f0000000000000000000c01', ['6f0000000000000000000a03', '6f0000000000000000000a04'], { key: 'agent_approval_requested', type: 'agent', scope: 'agents', from: 'x', message: 'm' });

    const companyRows = saved.filter((s) => s.db !== 'global').map((s) => s.row);
    expect(companyRows.map((r) => r.receiverID)).toEqual(['6f0000000000000000000a03', '6f0000000000000000000a04']);
    expect(new Set(companyRows.map((r) => r.uniqueId)).size).toBe(2);
});
