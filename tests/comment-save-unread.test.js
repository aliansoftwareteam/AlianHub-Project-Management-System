process.env.STORAGE_TYPE = 'server';

const mockSaved = [];

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: async (companyId, { data }, method) => {
        if (method === 'save') {
            const saved = { _id: `c${mockSaved.length + 1}`, ...data };
            mockSaved.push(saved);
            return saved;
        }
        return null;
    },
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Comments/helpers/threadWriteAccess', () => ({
    ...jest.requireActual('../Modules/Comments/helpers/threadWriteAccess'),
    canPostToThread: async () => ({ allowed: true }),
}));
jest.mock('../Modules/Comments/helpers/commentThreads', () => ({
    ...jest.requireActual('../Modules/Comments/helpers/commentThreads'),
    placeReply: async (companyId, data) => (data.parentId
        ? { allowed: true, data, parent: { _id: data.parentId } }
        : { allowed: true, data }),
}));
jest.mock('../Modules/Comments/helpers/commentNotifications', () => ({
    resolveMentionIds: jest.fn(async () => []),
    deliverMentions: jest.fn(async () => []),
}));
jest.mock('../Modules/Comments/helpers/threadNotices', () => ({ notifyReply: jest.fn(async () => undefined) }));
jest.mock('../Modules/Comments/helpers/unreadBumps', () => ({ bumpUnreadCounts: jest.fn(async () => undefined) }));

const { resolveMentionIds } = require('../Modules/Comments/helpers/commentNotifications');
const { bumpUnreadCounts } = require('../Modules/Comments/helpers/unreadBumps');
const { save } = require('../Modules/Comments/controller');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const MENTIONED = '6f0000000000000000000005';
const PROJECT = '6f0000000000000000000b01';
const SPRINT = '6f0000000000000000000d01';
const TASK = '6f0000000000000000000e01';
const PARENT = '6f0000000000000000000f01';

const call = async (data) => {
    const r = { code: 200 };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    await save({ headers: { companyid: C }, uid: ME, body: { data } }, r);
    return r;
};

beforeEach(() => {
    jest.clearAllMocks();
    mockSaved.length = 0;
});

describe('saving a comment', () => {
    it('raises the thread\'s unread counts on the server, with the mentions it resolved', async () => {
        resolveMentionIds.mockResolvedValueOnce([MENTIONED]);
        const r = await call({ message: 'hello', type: 'text', objId: { projectId: PROJECT, sprintId: SPRINT, taskId: TASK } });

        expect(r.code).toBe(200);
        expect(bumpUnreadCounts).toHaveBeenCalledTimes(1);
        const [companyId, comment, mentionIds] = bumpUnreadCounts.mock.calls[0];
        expect(companyId).toBe(C);
        expect({ ...comment, projectId: String(comment.projectId), sprintId: String(comment.sprintId), taskId: String(comment.taskId) })
            .toMatchObject({ _id: 'c1', userId: ME, projectId: PROJECT, sprintId: SPRINT, taskId: TASK });
        expect(mentionIds).toEqual([MENTIONED]);
    });

    it('raises no unread count for a thread reply, as the reply panel never did', async () => {
        await call({ message: 'reply', type: 'text', parentId: PARENT, objId: { projectId: PROJECT, sprintId: SPRINT, taskId: TASK } });

        expect(bumpUnreadCounts).not.toHaveBeenCalled();
    });

    it('still answers when raising the counts fails', async () => {
        bumpUnreadCounts.mockRejectedValueOnce(new Error('down'));
        const r = await call({ message: 'hello', type: 'text', objId: { projectId: PROJECT } });

        expect(r.code).toBe(200);
        expect(r.body.status).toBe(true);
    });
});
