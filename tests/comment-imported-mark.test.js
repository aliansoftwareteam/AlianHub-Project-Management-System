process.env.STORAGE_TYPE = 'server';

const mockSaved = [];
const mockUpdates = [];

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: async (companyId, { data }, method) => {
        if (method === 'save') {
            const saved = { _id: `c${mockSaved.length + 1}`, ...data };
            mockSaved.push(saved);
            return saved;
        }
        if (method === 'findOne') return { _id: '6f0000000000000000000a01', userId: '6f0000000000000000000001', projectId: '6f0000000000000000000b01', sprintId: '6f0000000000000000000d01', taskId: '6f0000000000000000000e01' };
        if (method === 'findOneAndUpdate') {
            mockUpdates.push(data[1]);
            return { _id: '6f0000000000000000000a01' };
        }
        return null;
    },
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(), isPrivileged: () => false }));
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

const { save, update } = require('../Modules/Comments/controller');
const { IMPORT_FIELDS, withoutImportFields } = require('../Modules/Comments/helpers/importFields');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const THREAD = { projectId: '6f0000000000000000000b01', sprintId: '6f0000000000000000000d01', taskId: '6f0000000000000000000e01' };

const send = async (handler, body) => {
    const r = { code: 200 };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    await handler({ headers: { companyid: C }, uid: ME, body }, r);
    return r;
};

beforeEach(() => {
    mockSaved.length = 0;
    mockUpdates.length = 0;
});

describe('where a comment was imported from is the importer\'s word alone', () => {
    it('names the field, and drops it from what a client sent', () => {
        expect(IMPORT_FIELDS).toEqual(['importedFrom']);
        expect(withoutImportFields({ message: 'hi', importedFrom: 'clickup' })).toEqual({ message: 'hi' });
        expect(withoutImportFields(undefined)).toBeUndefined();
    });

    it('is not stored from a posted comment', async () => {
        const r = await send(save, { data: { message: 'hello', type: 'text', importedFrom: 'clickup', objId: THREAD } });
        expect(r.code).toBe(200);
        expect(mockSaved).toHaveLength(1);
        expect(mockSaved[0].message).toBe('hello');
        expect(mockSaved[0]).not.toHaveProperty('importedFrom');
    });

    it('is not stored from an edited comment', async () => {
        const r = await send(update, { id: '6f0000000000000000000a01', data: { message: 'edited', importedFrom: 'trello' }, isProjectComment: false });
        expect(r.code).toBe(200);
        expect(mockUpdates).toHaveLength(1);
        expect(JSON.stringify(mockUpdates[0])).toContain('edited');
        expect(JSON.stringify(mockUpdates[0])).not.toContain('importedFrom');
    });
});
