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

    it('keeps a lone weak match weak instead of lifting it to the top of the scale', () => {
        const scored = normaliseScores([passage('page', 'weak', 0.4), passage('task', 'strong', 3), passage('task', 'good', 2)]);
        expect(scored.map((p) => [p.sourceId, Number(p.score.toFixed(3))])).toEqual([['weak', 0.4], ['strong', 1], ['good', 0.667]]);
    });

    it('weighs an agent draft down after scaling, so a weak draft never beats strong human results from another source', async () => {
        const draft = livePage();
        const tasks = [0, 1].map(() => seed(SCHEMA_TYPE.TASKS, { TaskName: 't', ProjectID: PROJECT, deletedStatusKey: 0 }));
        const adapter = stub([
            passage('page', draft, 0.9, { authorKind: 'agent', updatedAt: new Date('2026-09-09T00:00:00Z') }),
            passage('task', tasks[0], 3),
            passage('task', tasks[1], 2.4),
        ]);

        const { passages } = await run(adapter, 3);

        expect(passages.map((p) => p.sourceId)).toEqual([tasks[0], tasks[1], draft]);
        expect(passages[2].score).toBeCloseTo(0.45);
    });
});

describe('candidates are rechecked before the list is cut', () => {
    it('rechecks one window of candidates when it already fills the answer', async () => {
        const visible = Array.from({ length: 40 }, () => livePage());
        const adapter = stub(visible.map((id, i) => passage('page', id, 40 - i)));

        const { passages } = await run(adapter, 2);

        expect(passages.map((p) => p.sourceId)).toEqual(visible.slice(0, 2));
        const rechecked = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.PAGES && c.method === 'find').flatMap((c) => c.data[0]._id.$in);
        expect(rechecked).toHaveLength(4);
    });

    it('still fills the answer when the best-ranked candidates turn out to be deleted', async () => {
        const gone = [livePage({ deletedStatusKey: 1 }), livePage({ deletedStatusKey: 1 }), livePage({ deletedStatusKey: 1 })];
        const kept = livePage();
        const adapter = stub([passage('page', gone[0], 9), passage('page', gone[1], 8), passage('page', gone[2], 7), passage('page', kept, 6)]);

        const { passages } = await run(adapter, 1);

        expect(passages.map((p) => p.sourceId)).toEqual([kept]);
    });
});
