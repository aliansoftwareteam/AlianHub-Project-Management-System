const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => ['6f0000000000000000000a01']), visibleProjects: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: () => false }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { createRetrieve, normaliseScores } = require('../Modules/Knowledge/retrieval');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000011';
const PROJECT = '6f0000000000000000000a01';
const AT = new Date('2026-09-01T00:00:00Z');

const passage = (sourceType, sourceId, score, over = {}) => ({ id: `${sourceType}:${sourceId}`, sourceType, sourceId, projectId: PROJECT, title: sourceId, excerpt: '', score, authorKind: 'user', updatedAt: AT, ...over });
const stub = (candidates) => ({ name: 'stub', search: jest.fn(async () => candidates), upsert: async () => {}, tombstone: async () => {}, erase: async () => {}, stats: async () => ({}) });
const seed = (type, doc) => String(mockDb.seed(type, doc)._id);
const livePage = (over = {}) => seed(SCHEMA_TYPE.PAGES, { title: 'p', ProjectID: PROJECT, visibility: 'project', createdBy: ME, deletedStatusKey: 0, ...over });
const liveCall = () => seed(SCHEMA_TYPE.CALLS, { callId: `call-${Math.random()}`, participants: [ME], deletedStatusKey: 0 });

const run = (adapter, limit) => createRetrieve(adapter)({ companyId: C, caller: { kind: 'user', userId: ME }, query: 'budget', limit });

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    myCache.flushAll();
});

describe('scores from different sources are put on one scale before they compete', () => {
    it('divides each score by the best score its own source returned', () => {
        const scored = normaliseScores([
            passage('page', 'a', 8), passage('page', 'b', 4),
            passage('transcript', 'c', 1), passage('transcript', 'd', 0.5),
            passage('task', 'e', 0),
        ]);
        expect(scored.map((p) => [p.sourceId, p.score])).toEqual([['a', 1], ['b', 0.5], ['c', 1], ['d', 0.5], ['e', 0]]);
    });

    it('lets the best transcript, scored by regular expression, compete with full-text page scores', async () => {
        const [top, second] = [livePage({ updatedAt: AT }), livePage({ updatedAt: AT })];
        const call = liveCall();
        const adapter = stub([passage('page', top, 8), passage('page', second, 6), passage('transcript', call, 1, { updatedAt: new Date('2026-09-02T00:00:00Z') })]);

        const { passages } = await run(adapter, 2);

        expect(passages.map((p) => p.sourceId)).toEqual([call, top]);
    });
});

describe('candidates are rechecked before the list is cut', () => {
    it('still fills the answer when the best-ranked candidates turn out to be deleted', async () => {
        const gone = [livePage({ deletedStatusKey: 1 }), livePage({ deletedStatusKey: 1 }), livePage({ deletedStatusKey: 1 })];
        const kept = livePage();
        const adapter = stub([passage('page', gone[0], 9), passage('page', gone[1], 8), passage('page', gone[2], 7), passage('page', kept, 6)]);

        const { passages } = await run(adapter, 1);

        expect(passages.map((p) => p.sourceId)).toEqual([kept]);
    });
});
