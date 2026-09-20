const mockDb = require('./fixtures/fakeMongo').create();
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { taskSchema } = require('../utils/mongo-handler/createSchema');

const C = '7f0000000000000000000001';

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
});

describe('fakeMongo bounds $text to the declared text index', () => {
    it('matches words in the indexed fields only', async () => {
        mockDb.textFromSchema(SCHEMA_TYPE.TASKS, taskSchema);
        mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'quartermaster rota', TaskKey: 'OPS-12', rawDescription: 'nothing here' });

        const hit = await mockDb.crud(C, { type: SCHEMA_TYPE.TASKS, data: [{ $text: { $search: 'quartermaster' } }] }, 'find');
        expect(hit).toHaveLength(1);

        const miss = await mockDb.crud(C, { type: SCHEMA_TYPE.TASKS, data: [{ $text: { $search: 'OPS-12' } }] }, 'find');
        expect(miss).toHaveLength(0);
    });

    it('scores from the indexed fields only', async () => {
        mockDb.textFromSchema(SCHEMA_TYPE.TASKS, taskSchema);
        mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'quartermaster', TaskKey: 'quartermaster quartermaster', rawDescription: '' });

        const [row] = await mockDb.crud(C, {
            type: SCHEMA_TYPE.TASKS,
            data: [[{ $match: { $text: { $search: 'quartermaster' } } }, { $project: { score: { $meta: 'textScore' } } }]],
        }, 'aggregate');
        expect(row.score).toBe(1);
    });

    it('reads every string field while no text index is declared, as before', async () => {
        mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'nothing here', TaskKey: 'OPS-12', rawDescription: '' });

        const hit = await mockDb.crud(C, { type: SCHEMA_TYPE.TASKS, data: [{ $text: { $search: 'OPS-12' } }] }, 'find');
        expect(hit).toHaveLength(1);
    });
});
