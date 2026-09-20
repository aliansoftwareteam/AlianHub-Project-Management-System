const mockCrud = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const audit = require('../Modules/Agents/agentAudit');

const C = '6f00000000000000000000c1';
const ROW = '6f00000000000000000000a1';

beforeEach(() => {
    jest.clearAllMocks();
});

describe('markUndone', () => {
    it('throws when the unchained mark write fails instead of swallowing it', async () => {
        mockCrud.mockRejectedValueOnce(new Error('db down'));
        await expect(audit.markUndone(C, ROW, 'u1')).rejects.toThrow('db down');
    });

    it('resolves once the mark lands', async () => {
        mockCrud.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });
        await expect(audit.markUndone(C, ROW, 'u1')).resolves.toBeUndefined();
    });
});
