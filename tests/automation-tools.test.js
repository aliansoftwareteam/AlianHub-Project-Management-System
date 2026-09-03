jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { resolveStatus, DeterministicError } = require('../Modules/Automations/engine/tools');

const PROJECT_ID = '507f1f77bcf86cd799439012';

// What a real project actually stores — flat, no wrapper. Verified against a live
// tenant database; an earlier implementation read `row.convertStatus` and would
// have failed to resolve any status on any real project.
const FLAT = [
    { bgColor: '#ff960035', key: 1, textColor: '#ff9600', name: 'To Do', type: 'default_active' },
    { key: 3, name: 'In Progress', type: 'active' },
    { key: 6, name: 'Done', type: 'active' },
    { key: 2, name: 'Complete', type: 'close' },
];

// The shape produced when a project is created from a template.
const NESTED = [
    { convertStatus: { key: 1, name: 'To Do', type: 'default_active' } },
    { convertStatus: { key: 2, name: 'Complete', type: 'close' } },
];

const mockProject = (taskStatusData) => {
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockResolvedValue({ _id: PROJECT_ID, taskStatusData });
};

describe('resolveStatus', () => {
    it('resolves against the flat shape real projects store', async () => {
        mockProject(FLAT);
        await expect(resolveStatus('c1', PROJECT_ID, 'Complete')).resolves.toEqual({
            status: { key: 2, value: '', text: 'Complete', type: 'close' },
            statusType: 'close',
            statusKey: 2,
        });
    });

    it('still resolves the nested template shape', async () => {
        mockProject(NESTED);
        const out = await resolveStatus('c1', PROJECT_ID, 'Complete');
        expect(out.statusType).toBe('close');
        expect(out.statusKey).toBe(2);
    });

    it('matches case-insensitively and ignores surrounding space', async () => {
        mockProject(FLAT);
        await expect(resolveStatus('c1', PROJECT_ID, '  in progress ')).resolves.toMatchObject({ statusKey: 3 });
    });

    it('returns all three denormalised fields — a task carries status, statusType and statusKey', async () => {
        mockProject(FLAT);
        const out = await resolveStatus('c1', PROJECT_ID, 'To Do');
        expect(Object.keys(out).sort()).toEqual(['status', 'statusKey', 'statusType']);
        expect(out.status.text).toBe('To Do');
    });

    it('fails deterministically on an unknown status, listing what does exist', async () => {
        mockProject(FLAT);
        await expect(resolveStatus('c1', PROJECT_ID, 'Shipped')).rejects.toThrow(/does not exist in this project \(has: To Do, In Progress, Done, Complete\)/);
        await expect(resolveStatus('c1', PROJECT_ID, 'Shipped')).rejects.toMatchObject({ deterministic: true });
    });

    it('two statuses can share a type — resolution is by NAME, never by type', async () => {
        mockProject(FLAT);
        // "Done" is type:active here while "Complete" is type:close. Resolving by
        // type would silently pick the wrong column.
        const done = await resolveStatus('c1', PROJECT_ID, 'Done');
        expect(done.statusType).toBe('active');
        expect(done.statusKey).toBe(6);
    });

    it('rejects an empty status name and an unusable project id', async () => {
        mockProject(FLAT);
        await expect(resolveStatus('c1', PROJECT_ID, '')).rejects.toThrow('status is required');
        await expect(resolveStatus('c1', 'not-an-id', 'To Do')).rejects.toThrow(/invalid project id/);
    });
});
