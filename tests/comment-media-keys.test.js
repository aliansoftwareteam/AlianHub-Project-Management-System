process.env.STORAGE_TYPE = 'server';

const mockDb = { saved: [], updates: [], inserted: [], comments: [], existing: null };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: jest.fn(async (companyId, { type, data }, method) => {
        if (method === 'save') {
            const saved = { _id: `c${mockDb.saved.length + 1}`, ...data };
            mockDb.saved.push(saved);
            return saved;
        }
        if (type === 'main_chats') return String(data[0]._id) === mockDb.directSpace ? { _id: mockDb.directSpace, default: true } : null;
        if (type === 'comments' && method === 'findOne') return mockDb.existing;
        if (type === 'comments' && method === 'find') return mockDb.comments;
        if (type === 'comments' && method === 'findOneAndUpdate') {
            mockDb.updates.push(data[1]);
            return { _id: String(data[0]._id) };
        }
        if (type === 'comments' && method === 'insertMany') {
            mockDb.inserted.push(...data[0]);
            return data[0];
        }
        return null;
    }),
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn(), getCompanyDataFun: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: () => false }));
jest.mock('../Modules/storage/downloadScope', () => ({ judge: jest.fn(async ({ key }) => ({ allowed: !key.includes('unreadable') })) }));
jest.mock('../Modules/Comments/helpers/threadWriteAccess', () => ({
    ...jest.requireActual('../Modules/Comments/helpers/threadWriteAccess'),
    canPostToThread: async () => ({ allowed: true }),
    canChangeComment: async () => ({ allowed: true }),
}));
jest.mock('../Modules/Comments/helpers/commentThreads', () => ({
    ...jest.requireActual('../Modules/Comments/helpers/commentThreads'),
    placeReply: async (companyId, data) => ({ allowed: true, data }),
}));
jest.mock('../Modules/Comments/helpers/commentNotifications', () => ({
    resolveMentionIds: jest.fn(async () => []),
    deliverMentions: jest.fn(async () => []),
}));
jest.mock('../Modules/Comments/helpers/threadNotices', () => ({ notifyReply: jest.fn(async () => undefined) }));
jest.mock('../Modules/Comments/helpers/unreadBumps', () => ({ bumpUnreadCounts: jest.fn(async () => undefined) }));

const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { judge } = require('../Modules/storage/downloadScope');
const { save, update, addCommentCollection } = require('../Modules/Comments/controller');

const COMPANY = crypto.randomBytes(12).toString('hex');
const OTHER_COMPANY = crypto.randomBytes(12).toString('hex');
const STORAGE_ROOT = path.resolve(__dirname, '..', 'storage');
const ME = '6f0000000000000000000001';
const COLLEAGUE = '6f0000000000000000000002';
const PROJECT = '6f0000000000000000000a01';
const OLD_PROJECT = '6f0000000000000000000a02';
const OTHER_PROJECT = '6f0000000000000000000a03';
const DIRECT_SPACE = '6f0000000000000000000c01';
const SPRINT = '6f0000000000000000000e01';
const OLD_SPRINT = '6f0000000000000000000e02';
const CHANNEL = '6f0000000000000000000e03';
const OTHER_CHANNEL = '6f0000000000000000000e04';
const TASK = '6f0000000000000000000b01';
const OTHER_TASK = '6f0000000000000000000b02';
const NEW_TASK = '6f0000000000000000000b03';
const COMMENT = '6f0000000000000000000701';

const TASK_THREAD = { projectId: PROJECT, sprintId: SPRINT, taskId: TASK };
const DIRECT_THREAD = { projectId: DIRECT_SPACE, sprintId: SPRINT, taskId: TASK };
const CHANNEL_THREAD = { projectId: PROJECT, sprintId: CHANNEL };
const PROJECT_THREAD = { projectId: PROJECT };

const taskFile = (name, taskId = TASK, projectId = PROJECT, sprintId = SPRINT) => `Project/${projectId}/${sprintId}/${taskId}/Comments/${name}`;
const channelFile = (channelId, name = 'room.png') => `Project/${PROJECT}/${channelId}/default/Comments/${name}`;
const projectFile = (projectId, name = 'chat.png') => `Project/${projectId}/Comments/${name}`;
const clip = (userId, companyId = COMPANY) => `Clips/${companyId}/${userId}/clip.webm`;

const response = () => {
    const r = { code: 200 };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
};

const post = async (thread, mediaURL, extra = {}) => {
    const r = response();
    await save({ headers: { companyid: COMPANY }, uid: ME, body: { data: { message: '', type: 'image', mediaURL, objId: thread, ...extra } } }, r);
    return r;
};

const edit = async (data) => {
    const r = response();
    await update({ headers: { companyid: COMPANY }, uid: ME, body: { id: COMMENT, data } }, r);
    return r;
};

beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(mockDb, { saved: [], updates: [], inserted: [], comments: [], existing: null, directSpace: DIRECT_SPACE });
});

afterAll(() => fs.rmSync(path.join(STORAGE_ROOT, COMPANY), { recursive: true, force: true }));

describe('the file a new comment names', () => {
    it.each([
        ['no file', TASK_THREAD, undefined, {}],
        ['an empty key', TASK_THREAD, '', {}],
        ['a file of its own task thread', TASK_THREAD, taskFile('photo.png'), {}],
        ['a file stored for its task before the task moved', TASK_THREAD, taskFile('photo.png', TASK, OLD_PROJECT, OLD_SPRINT), {}],
        ['a file of its own channel', CHANNEL_THREAD, channelFile(CHANNEL), { taskId: 'default' }],
        ['a file of its own project chat', PROJECT_THREAD, projectFile(PROJECT), {}],
        ["a clip from the writer's own library", TASK_THREAD, clip(ME), {}],
        ['a link', TASK_THREAD, 'https://example.com/picture.png', {}],
        ['the first file of a new direct conversation', DIRECT_THREAD, projectFile(DIRECT_SPACE), {}],
    ])('accepts %s', async (_label, thread, mediaURL, extra) => {
        const r = await post(thread, mediaURL, extra);
        expect(r.code).toBe(200);
        expect(mockDb.saved).toHaveLength(1);
    });

    it.each([
        ["a file of another task's thread", TASK_THREAD, taskFile('secret.png', OTHER_TASK), {}],
        ['a task attachment', TASK_THREAD, `Project/${PROJECT}/Sprint/${TASK}/Attachment/spec.pdf`, {}],
        ['a project chat file, for a task comment', TASK_THREAD, projectFile(PROJECT), {}],
        ['a channel file, for a task comment', TASK_THREAD, channelFile(CHANNEL), {}],
        ['a file of another channel', CHANNEL_THREAD, channelFile(OTHER_CHANNEL), { taskId: 'default' }],
        ['a task thread file, for a channel message', CHANNEL_THREAD, taskFile('photo.png'), { taskId: 'default' }],
        ["a file of another project's chat", PROJECT_THREAD, projectFile(OTHER_PROJECT), {}],
        ["a colleague's clip", TASK_THREAD, clip(COLLEAGUE), {}],
        ['a clip filed under another company', TASK_THREAD, clip(ME, OTHER_COMPANY), {}],
        ['a key with a .. name in its own folder', TASK_THREAD, taskFile('..'), {}],
        ['a key outside every layout', TASK_THREAD, 'backups/company.zip', {}],
        ['a key that is not text', TASK_THREAD, { $ne: '' }, {}],
    ])('refuses %s, and saves nothing', async (_label, thread, mediaURL, extra) => {
        const r = await post(thread, mediaURL, extra);
        expect(r.code).toBe(400);
        expect(r.body).toMatchObject({ status: false, message: 'A comment can only carry a file stored for its own thread.' });
        expect(mockDb.saved).toHaveLength(0);
    });

    it('takes the folder of a chat space as a first file only in the direct-message space', async () => {
        mockDb.directSpace = OTHER_PROJECT;
        const r = await post(DIRECT_THREAD, projectFile(DIRECT_SPACE));
        expect(r.code).toBe(400);
        expect(mockDb.saved).toHaveLength(0);
    });
});

describe('the file an edited comment names', () => {
    const stored = taskFile('photo.png', TASK, OLD_PROJECT, OLD_SPRINT);
    beforeEach(() => { mockDb.existing = { _id: COMMENT, userId: ME, ...TASK_THREAD, mediaURL: stored }; });

    it('keeps the key it already has, as the web app resends it', async () => {
        const r = await edit({ message: 'edited', mediaURL: stored });
        expect(r.code).toBe(200);
        expect(mockDb.updates).toHaveLength(1);
    });

    it('may be cleared, or moved to another file of the same thread', async () => {
        expect((await edit({ mediaURL: '' })).code).toBe(200);
        expect((await edit({ mediaURL: taskFile('other.png') })).code).toBe(200);
        expect(mockDb.updates).toHaveLength(2);
    });

    it.each([
        ["a file of another task's thread", taskFile('secret.png', OTHER_TASK)],
        ['a task attachment', `Project/${PROJECT}/Sprint/${TASK}/Attachment/spec.pdf`],
        ["a colleague's clip", clip(COLLEAGUE)],
    ])('refuses a change to %s, and writes nothing', async (_label, mediaURL) => {
        const r = await edit({ message: 'edited', mediaURL });
        expect(r.code).toBe(400);
        expect(mockDb.updates).toHaveLength(0);
    });
});

describe('copying comment files to a duplicated task', () => {
    const onDisk = (key) => path.join(STORAGE_ROOT, COMPANY, key);
    const seed = (key) => {
        fs.mkdirSync(path.dirname(onDisk(key)), { recursive: true });
        fs.writeFileSync(onDisk(key), `bytes of ${key}`);
    };
    const newFolder = `Project/${OTHER_PROJECT}/${CHANNEL}/${NEW_TASK}/Comments`;
    const copied = () => (fs.existsSync(onDisk(newFolder)) ? fs.readdirSync(onDisk(newFolder)).sort() : []);
    const row = (id, mediaURL) => ({ _id: id, userId: COLLEAGUE, projectId: PROJECT, sprintId: SPRINT, taskId: TASK, type: 'image', mediaURL });
    const duplicate = () => addCommentCollection(COMPANY, { id: OTHER_PROJECT }, { _id: TASK, sprintId: SPRINT }, { id: NEW_TASK }, { id: CHANNEL }, { id: ME });

    beforeEach(() => {
        fs.rmSync(path.join(STORAGE_ROOT, COMPANY), { recursive: true, force: true });
        [taskFile('first.png'), taskFile('second.png'), taskFile('beside.png'), taskFile('unreadable.png'),
            taskFile('secret.png', OTHER_TASK), taskFile('other-secret.png', OTHER_TASK), clip(COLLEAGUE)].forEach(seed);
    });

    it('copies each file of the task thread on its own, and nothing stored beside it', async () => {
        mockDb.comments = [row('1', taskFile('first.png')), row('2', taskFile('second.png')), row('3', '')];
        await duplicate();

        expect(copied()).toEqual(['first.png', 'second.png']);
        expect(mockDb.inserted.map((comment) => comment.mediaURL)).toEqual([`${newFolder}/first.png`, `${newFolder}/second.png`, '']);
        expect(judge).toHaveBeenCalledWith(expect.objectContaining({ companyId: COMPANY, uid: ME, key: taskFile('first.png') }));
    });

    it('copies nothing for a key outside the comment\'s own thread folder, and keeps the key as it was', async () => {
        const foreign = [taskFile('secret.png', OTHER_TASK), clip(COLLEAGUE), `Project/${PROJECT}/Sprint/${OTHER_TASK}/Attachment/spec.pdf`];
        mockDb.comments = foreign.map((key, at) => row(String(at), key));
        await duplicate();

        expect(copied()).toEqual([]);
        expect(mockDb.inserted.map((comment) => comment.mediaURL)).toEqual(foreign);
    });

    it('copies nothing the person duplicating may not read', async () => {
        mockDb.comments = [row('1', taskFile('unreadable.png'))];
        await duplicate();

        expect(copied()).toEqual([]);
    });

    it('still files the copied comments under the new task', async () => {
        mockDb.comments = [row('1', taskFile('first.png'))];
        await duplicate();

        expect(mockDb.inserted).toHaveLength(1);
        expect(mockDb.inserted[0]).toMatchObject({ userId: COLLEAGUE, type: 'image' });
        expect(String(mockDb.inserted[0].taskId)).toBe(NEW_TASK);
        expect(String(mockDb.inserted[0].projectId)).toBe(OTHER_PROJECT);
        expect(mockDb.inserted[0]._id).toBeUndefined();
    });
});
