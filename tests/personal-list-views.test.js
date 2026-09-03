jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../createProject/controller', () => ({ createProject: jest.fn() }), { virtual: true });
jest.mock('../Modules/createProject/controller', () => ({ createProject: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { personalViews } = require('../Modules/PersonalList/controller');

const catalogue = [
    { _id: { toString: () => 'id-list' }, keyName: 'ProjectListView' },
    { _id: 'id-gantt', keyName: 'GanttView' },
    { _id: 'id-board', keyName: 'ProjectKanban' },
    { _id: 'id-cal', keyName: 'Calendar' },
];

describe('Personal List — the project it creates must satisfy the schema', () => {
    beforeEach(() => MongoDbCrudOpration.mockReset());

    it('picks List, Board and Calendar from the company catalogue, ids as strings, List default', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce(catalogue);
        const v = await personalViews('cid');
        expect(v.ProjectRequiredDefaultComponent).toBe('ProjectListView');
        expect(v.ProjectRequiredComponent.map((x) => x._id)).toEqual(['id-list', 'id-board', 'id-cal']);
        expect(v.ProjectRequiredComponent.every((x) => typeof x._id === 'string' && x.viewStatus === true)).toBe(true);
        expect(v.ProjectRequiredComponent.filter((x) => x.setAsDefault).map((x) => x._id)).toEqual(['id-list']);
    });

    it('falls back to the first catalogue view when none of the wanted ones exist', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce([{ _id: 'only', keyName: 'Workload' }]);
        const v = await personalViews('cid');
        expect(v.ProjectRequiredDefaultComponent).toBe('Workload');
        expect(v.ProjectRequiredComponent).toEqual([{ _id: 'only', viewStatus: true, setAsDefault: true }]);
    });

    it('refuses to create a project with no views at all, which the schema would reject anyway', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce([]);
        await expect(personalViews('cid')).rejects.toThrow(/no project views/);
    });
});
