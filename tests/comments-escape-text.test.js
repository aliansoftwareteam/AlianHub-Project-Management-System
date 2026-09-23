process.env.STORAGE_TYPE = 'server';

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: () => false }));
jest.mock('../Modules/Comments/helpers/threadWriteAccess', () => ({
    threadOf: () => ({}),
    canPostToThread: async () => ({ allowed: true }),
    canChangeComment: async () => ({ allowed: true }),
    changesThreadOrAuthor: () => false,
}));

jest.mock('../Modules/Comments/helpers/commentNotifications', () => {
    const { parseMentionIds } = jest.requireActual('../Modules/Comments/helpers/parseMentions');
    return { resolveMentionIds: async (companyId, authorId, thread, message) => parseMentionIds(message), deliverMentions: async () => [] };
});

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { save, update } = require('../Modules/Comments/controller');

const COMPANY = '6a9954186dd786246031e47b';
const USER = '6a9954186dd786246031e47c';
const COMMENT = '6a9954186dd786246031e47e';
const RAW = `<img src=x onerror="alert('1')"> & more`;
const ESCAPED = '&lt;img src=x onerror=&quot;alert(&#039;1&#039;)&quot;&gt; &amp; more';

const res = () => {
    const r = { status: jest.fn(() => r), json: jest.fn() };
    return r;
};

const storedOnSave = async (data) => {
    MongoDbCrudOpration.mockImplementation(async (companyId, query) => ({ _id: COMMENT, ...query.data }));
    await save({ headers: { companyid: COMPANY }, uid: USER, body: { data: { taskId: 'default', type: 'text', ...data } } }, res());
    return MongoDbCrudOpration.mock.calls.find(([, q, op]) => op === 'save' && q.type === 'comments')[1].data;
};

const storedOnUpdate = async (data) => {
    MongoDbCrudOpration.mockImplementation(async (companyId, query, op) => (op === 'findOne' ? { _id: COMMENT, userId: USER } : { _id: COMMENT }));
    await update({ headers: { companyid: COMPANY }, uid: USER, body: { id: COMMENT, data } }, res());
    return MongoDbCrudOpration.mock.calls.find(([, , op]) => op === 'findOneAndUpdate')[1].data[1].$set;
};

beforeEach(() => jest.clearAllMocks());

describe('comment text is stored as plain text', () => {
    it('escapes message and reply_message on create', async () => {
        const stored = await storedOnSave({ message: RAW, reply_message: RAW });
        expect(stored.message).toBe(ESCAPED);
        expect(stored.reply_message).toBe(ESCAPED);
    });

    it('escapes message and reply_message on update', async () => {
        const stored = await storedOnUpdate({ message: RAW, reply_message: RAW });
        expect(stored.message).toBe(ESCAPED);
        expect(stored.reply_message).toBe(ESCAPED);
    });

    it('stores what the web app sends unchanged', async () => {
        const fromApp = await storedOnSave({ message: ESCAPED, reply_message: 'a &amp; b' });
        expect(fromApp.message).toBe(ESCAPED);
        expect(fromApp.reply_message).toBe('a &amp; b');
        expect((await storedOnUpdate({ message: ESCAPED })).message).toBe(ESCAPED);
    });

    it('keeps mention tokens readable for mention parsing', async () => {
        const stored = await storedOnSave({ message: `hi @[Max Member](${USER}) <b>` });
        expect(stored.message).toBe(`hi @[Max Member](${USER}) &lt;b&gt;`);
        expect(stored.mentionIds).toEqual([USER]);
    });

    it('leaves other fields and a pin toggle alone', async () => {
        const stored = await storedOnUpdate({ pinnedMessage: true });
        expect(stored).toEqual({ pinnedMessage: true });
    });
});
