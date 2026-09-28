process.env.STORAGE_TYPE = 'server';

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: () => false }));
jest.mock('../Modules/Comments/helpers/threadWriteAccess', () => ({
    ...jest.requireActual('../Modules/Comments/helpers/threadWriteAccess'),
    canChangeComment: async () => ({ allowed: true }),
}));
jest.mock('../Modules/Comments/helpers/commentNotifications', () => ({
    resolveMentionIds: jest.fn(async () => []),
    deliverMentions: jest.fn(async () => []),
}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { update } = require('../Modules/Comments/controller');

const COMPANY = '6a9954186dd786246031e47b';
const AUTHOR = '6a9954186dd786246031e47c';
const MEMBER = '6a9954186dd786246031e47d';
const COMMENT = '6a9954186dd786246031e47e';
const EXISTING = {
    _id: COMMENT,
    userId: AUTHOR,
    projectId: '6a9954186dd786246031e481',
    sprintId: '6a9954186dd786246031e482',
    taskId: '6a9954186dd786246031e483',
};

const res = () => {
    const r = { code: 200 };
    r.status = jest.fn((c) => { r.code = c; return r; });
    r.json = jest.fn((b) => { r.body = b; return r; });
    return r;
};

const send = async (uid, body) => {
    const r = res();
    await update({ headers: { companyid: COMPANY }, uid, body: { id: COMMENT, ...body } }, r);
    return r;
};
const updateCall = () => MongoDbCrudOpration.mock.calls.find(([, , op]) => op === 'findOneAndUpdate');
const writeOptions = () => updateCall()[1].data[2];

beforeEach(() => {
    jest.clearAllMocks();
    MongoDbCrudOpration.mockImplementation(async (companyId, query, op) => (op === 'findOne' ? EXISTING : { _id: COMMENT }));
});

describe('PUT /api/v1/comments write options', () => {
    it('keeps the web app pin request, which leaves updatedAt alone', async () => {
        const r = await send(MEMBER, { data: { pinnedMessage: true }, isProjectComment: false, options: { timestamps: false } });
        expect(r.code).toBe(200);
        expect(writeOptions()).toEqual({ returnDocument: 'after', timestamps: false });
    });

    it('keeps the web app edit request, which sends no options', async () => {
        const r = await send(AUTHOR, { data: { message: 'edited' }, isProjectComment: true });
        expect(r.code).toBe(200);
        expect(writeOptions()).toEqual({ returnDocument: 'after' });
    });

    it.each([
        ['upsert', { upsert: true }],
        ['arrayFilters', { arrayFilters: [{ 'x.a': 1 }] }],
        ['returnDocument', { returnDocument: 'before' }],
        ['projection', { projection: { message: 0 } }],
        ['sort', { timestamps: false, sort: { _id: 1 } }],
        ['a non-boolean timestamps', { timestamps: 'no' }],
        ['a list', [{ upsert: true }]],
        ['text', 'upsert'],
    ])('refuses options carrying %s and writes nothing', async (_label, options) => {
        const r = await send(MEMBER, { data: { pinnedMessage: true }, options });
        expect(r.code).toBe(400);
        expect(r.body).toMatchObject({ status: false });
        expect(updateCall()).toBeUndefined();
    });
});
