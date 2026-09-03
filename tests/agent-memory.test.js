jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const memory = require('../Modules/Agents/engine/findingMemory');

const finding = (factId, title) => ({ factId, title, severity: 'medium' });

/* The model re-words the same defect between runs. These two are ONE defect. */
const RUN_1 = finding('meta_description', 'Shorten meta description to 160 characters');
const RUN_2 = finding('meta_description', 'Shorten meta description to avoid truncation');

const mockDb = ({ findings = [], subtask = null }) => {
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (co, q, method) => {
        if (q.type === SCHEMA_TYPE.AGENT_FINDINGS && method === 'find') return findings;
        if (q.type === SCHEMA_TYPE.TASKS && method === 'findOne') return subtask;
        return {};
    });
};

describe('finding memory — dedup on factId, never on title', () => {
    it('files a finding it has never seen', async () => {
        mockDb({ findings: [] });
        const mem = await memory.load('c1', 't1');
        const [d] = await memory.decide('c1', 't1', [RUN_1], mem);
        expect(d.action).toBe('file');
    });

    it('SKIPS the same defect on a second run even though the wording changed', async () => {
        mockDb({
            findings: [{ _id: 'f1', factId: 'meta_description', subtaskId: 'sub1', status: 'open' }],
            subtask: { _id: 'sub1', statusType: 'default_active', deletedStatusKey: 0 },
        });
        const mem = await memory.load('c1', 't1');
        const [d] = await memory.decide('c1', 't1', [RUN_2], mem);
        expect(d.action).toBe('skip');
        expect(d.reason).toBe('already filed and still open');
    });

    it('RE-FILES when the subtask was closed but the defect is back — a regression', async () => {
        mockDb({
            findings: [{ _id: 'f1', factId: 'meta_description', subtaskId: 'sub1', status: 'open' }],
            subtask: { _id: 'sub1', statusType: 'close', deletedStatusKey: 0 },
        });
        const mem = await memory.load('c1', 't1');
        const [d] = await memory.decide('c1', 't1', [RUN_2], mem);
        expect(d.action).toBe('refile');
        expect(d.reason).toMatch(/defect is back/);
    });

    it('re-files when the subtask was deleted outright', async () => {
        mockDb({ findings: [{ _id: 'f1', factId: 'meta_description', subtaskId: 'gone', status: 'open' }], subtask: null });
        const mem = await memory.load('c1', 't1');
        expect((await memory.decide('c1', 't1', [RUN_2], mem))[0].action).toBe('refile');
    });

    it('treats a soft-deleted subtask as gone', async () => {
        mockDb({
            findings: [{ _id: 'f1', factId: 'meta_description', subtaskId: 'sub1', status: 'open' }],
            subtask: { _id: 'sub1', statusType: 'default_active', deletedStatusKey: 1 },
        });
        const mem = await memory.load('c1', 't1');
        expect((await memory.decide('c1', 't1', [RUN_2], mem))[0].action).toBe('refile');
    });

    it('NEVER re-files something a human marked wontfix — even if it is still broken', async () => {
        mockDb({
            findings: [{ _id: 'f1', factId: 'script_count', subtaskId: 'sub9', status: 'wontfix' }],
            subtask: { _id: 'sub9', statusType: 'close', deletedStatusKey: 0 },
        });
        const mem = await memory.load('c1', 't1');
        const [d] = await memory.decide('c1', 't1', [finding('script_count', 'Reduce scripts')], mem);
        expect(d.action).toBe('skip');
        expect(d.reason).toBe('marked wontfix');
    });

    it('decides per finding — a mixed batch files only what is new', async () => {
        mockDb({
            findings: [{ _id: 'f1', factId: 'meta_description', subtaskId: 'sub1', status: 'open' }],
            subtask: { _id: 'sub1', statusType: 'default_active', deletedStatusKey: 0 },
        });
        const mem = await memory.load('c1', 't1');
        const ds = await memory.decide('c1', 't1', [RUN_2, finding('og_image', 'Add og:image')], mem);
        expect(ds.map(d => d.action)).toEqual(['skip', 'file']);
    });

    it('a memory lookup failure degrades to filing, never to crashing the run', async () => {
        MongoDbCrudOpration.mockReset();
        MongoDbCrudOpration.mockRejectedValue(new Error('mongo down'));
        const mem = await memory.load('c1', 't1');
        expect(mem.size).toBe(0);
        const [d] = await memory.decide('c1', 't1', [RUN_1], mem);
        expect(d.action).toBe('file');
    });

    it('swallows the unique-index collision from a concurrent run', async () => {
        MongoDbCrudOpration.mockReset();
        MongoDbCrudOpration.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
        await expect(memory.record('c1', { taskId: 't1', factId: 'og_image', title: 'x' })).resolves.toBeUndefined();
    });
});
