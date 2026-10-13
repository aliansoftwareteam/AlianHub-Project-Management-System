process.env.STORAGE_TYPE = 'server';

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: () => false }));
jest.mock('../Modules/Comments/helpers/threadWriteAccess', () => ({
    ...jest.requireActual('../Modules/Comments/helpers/threadWriteAccess'),
    canChangeComment: async () => ({ allowed: true }),
}));
jest.mock('../Modules/Comments/helpers/commentNotifications', () => ({
    resolveMentionIds: jest.fn(async () => []),
    deliverMentions: jest.fn(async () => []),
}));
jest.mock('../Modules/AI/taskAiValues', () => ({
    forgetSummary: jest.fn(async () => 1),
    markSummaryBehind: jest.fn(async () => ({})),
}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const kept = require('../Modules/AI/taskAiValues');
const { update } = require('../Modules/Comments/controller');

/* A kept task summary was made from the task's comments, so the comment write that removes or rewrites one reaches it. */

const COMPANY = '6a9954186dd786246031e47b';
const AUTHOR = '6a9954186dd786246031e47c';
const COMMENT = '6a9954186dd786246031e47e';
const TASK = '6a9954186dd786246031e483';
const existing = (over = {}) => ({ _id: COMMENT, userId: AUTHOR, projectId: '6a9954186dd786246031e481', sprintId: '6a9954186dd786246031e482', taskId: TASK, ...over });

const res = () => {
    const r = { code: 200 };
    r.status = jest.fn((c) => { r.code = c; return r; });
    r.json = jest.fn((b) => { r.body = b; return r; });
    return r;
};
const send = async (data, comment = existing()) => {
    MongoDbCrudOpration.mockImplementation(async (companyId, query, op) => (op === 'findOne' ? comment : { _id: COMMENT }));
    const r = res();
    await update({ headers: { companyid: COMPANY }, uid: AUTHOR, body: { id: COMMENT, data, isProjectComment: false } }, r);
    return r;
};

beforeEach(() => { jest.clearAllMocks(); });

describe('a comment write and the kept summary of its task', () => {
    it('removes the summary when the comment is deleted', async () => {
        expect((await send({ isDeleted: true })).code).toBe(200);
        expect(kept.forgetSummary).toHaveBeenCalledWith(COMPANY, TASK);
        expect(kept.markSummaryBehind).not.toHaveBeenCalled();
    });

    it('marks the summary as behind when the comment is edited', async () => {
        await send({ message: 'Shipping on Monday' });
        expect(kept.markSummaryBehind).toHaveBeenCalledWith(COMPANY, TASK);
        expect(kept.forgetSummary).not.toHaveBeenCalled();
    });

    it('leaves the summary alone for a pin, and for a chat message that belongs to no task', async () => {
        await send({ pinnedMessage: true });
        await send({ isDeleted: true }, existing({ taskId: 'default' }));
        await send({ message: 'edited' }, existing({ taskId: undefined }));
        expect(kept.forgetSummary).not.toHaveBeenCalled();
        expect(kept.markSummaryBehind).not.toHaveBeenCalled();
    });

    it('still answers the write when the summary cannot be reached', async () => {
        kept.forgetSummary.mockRejectedValueOnce(new Error('down'));
        expect((await send({ isDeleted: true })).code).toBe(200);
    });
});
