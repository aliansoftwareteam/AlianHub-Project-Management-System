process.env.STORAGE_TYPE = 'server';

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: () => true }));
jest.mock('../Modules/Comments/helpers/threadWriteAccess', () => ({
    ...jest.requireActual('../Modules/Comments/helpers/threadWriteAccess'),
    canChangeComment: async () => ({ allowed: true }),
}));
jest.mock('../Modules/Comments/helpers/commentNotifications', () => ({
    resolveMentionIds: jest.fn(),
    deliverMentions: jest.fn(async () => []),
}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { resolveMentionIds, deliverMentions } = require('../Modules/Comments/helpers/commentNotifications');
const { update } = require('../Modules/Comments/controller');

const COMPANY = '6a9954186dd786246031e47b';
const AUTHOR = '6a9954186dd786246031e47c';
const ADMIN = '6a9954186dd786246031e47d';
const COMMENT = '6a9954186dd786246031e47e';
const VISIBLE = '6a9954186dd786246031e47f';
const HIDDEN = '6a9954186dd786246031e480';
const EXISTING = {
    _id: COMMENT,
    userId: AUTHOR,
    projectId: '6a9954186dd786246031e481',
    sprintId: '6a9954186dd786246031e482',
    taskId: '6a9954186dd786246031e483',
    mentionIds: [VISIBLE],
};

const res = () => {
    const r = { status: jest.fn(() => r), json: jest.fn() };
    return r;
};

const storedOnUpdate = async (uid, data) => {
    MongoDbCrudOpration.mockImplementation(async (companyId, query, op) => (op === 'findOne' ? EXISTING : { _id: COMMENT }));
    await update({ headers: { companyid: COMPANY }, uid, body: { id: COMMENT, data } }, res());
    return MongoDbCrudOpration.mock.calls.find(([, , op]) => op === 'findOneAndUpdate')[1].data[1].$set;
};

beforeEach(() => {
    jest.clearAllMocks();
    resolveMentionIds.mockResolvedValue([VISIBLE]);
});

describe('editing a comment', () => {
    it('stores the mentions the server resolves for the thread and the original author', async () => {
        const message = `@[V](${VISIBLE}) @[H](${HIDDEN}) @[Me](${AUTHOR}) edited`;
        const stored = await storedOnUpdate(ADMIN, { message });

        expect(resolveMentionIds).toHaveBeenCalledWith(COMPANY, AUTHOR, {
            projectId: EXISTING.projectId, sprintId: EXISTING.sprintId, taskId: EXISTING.taskId,
        }, message);
        expect(stored.mentionIds).toEqual([VISIBLE]);
    });

    it('ignores a mention list sent by the caller', async () => {
        const withText = await storedOnUpdate(AUTHOR, { message: 'no mentions', mentionIds: [HIDDEN] });
        expect(withText.mentionIds).toEqual([VISIBLE]);

        const withoutText = await storedOnUpdate(AUTHOR, { mentionIds: [HIDDEN] });
        expect(withoutText).not.toHaveProperty('mentionIds');
    });

    it('sends no mention record or notice', async () => {
        await storedOnUpdate(AUTHOR, { message: `@[V](${VISIBLE}) again` });
        expect(deliverMentions).not.toHaveBeenCalled();
    });
});
