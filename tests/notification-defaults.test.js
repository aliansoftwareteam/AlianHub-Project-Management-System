jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../utils/data', () => ({ importUserNotifications: jest.fn(async () => {}) }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../utils/commonFunctions');
const importData = require('../utils/data');
const { ensureNotificationDefaults } = require('../Modules/notification/defaults');

beforeEach(() => jest.clearAllMocks());

test('an existing document is returned untouched', async () => {
    MongoDbCrudOpration.mockResolvedValueOnce({ userId: 'u1', project: {} });
    const doc = await ensureNotificationDefaults('c1', 'u1');
    expect(doc).toEqual({ userId: 'u1', project: {} });
    expect(importData.importUserNotifications).not.toHaveBeenCalled();
    const [companyId, query, method] = MongoDbCrudOpration.mock.calls[0];
    expect([companyId, method, query.type, query.data[0]]).toEqual(['c1', 'findOne', 'notifications_settings', { userId: 'u1' }]);
});

test('a missing document is seeded once, the cache cleared, and the fresh document returned', async () => {
    MongoDbCrudOpration.mockResolvedValueOnce(null).mockResolvedValueOnce({ userId: 'u1', tasks: {} });
    const doc = await ensureNotificationDefaults('c1', 'u1');
    expect(importData.importUserNotifications).toHaveBeenCalledWith('c1', 'u1');
    expect(removeCache).toHaveBeenCalledWith('notification:u1:c1');
    expect(doc).toEqual({ userId: 'u1', tasks: {} });
});

test('ids are stringified so an ObjectId and its string match the same document', async () => {
    MongoDbCrudOpration.mockResolvedValueOnce(null).mockResolvedValueOnce({});
    await ensureNotificationDefaults('c1', { toString: () => 'abc' });
    expect(MongoDbCrudOpration.mock.calls[0][1].data[0]).toEqual({ userId: 'abc' });
    expect(importData.importUserNotifications).toHaveBeenCalledWith('c1', 'abc');
});

test('refuses to run without both ids', async () => {
    await expect(ensureNotificationDefaults('', 'u1')).rejects.toThrow('companyId and userId are required');
    await expect(ensureNotificationDefaults('c1', '')).rejects.toThrow();
});
