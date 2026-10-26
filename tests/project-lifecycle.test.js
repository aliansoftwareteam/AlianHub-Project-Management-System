const mongoose = require('mongoose');

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../utils/commonFunctions.js', () => ({ removeCache: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../event/socketEventEmitter');
const { planLifecycle, restoreTargetOf, touchesLifecycle, applyMove } = require('../Modules/Project/helpers/projectLifecycle');

const open = { status: 'in_testing', statusType: 'active', deletedStatusKey: 0 };
const closed = { status: 'close', statusType: 'close', deletedStatusKey: 0, statusBeforeClose: 'in_testing' };
const CLOSE = { status: 'close', statusType: 'close' };
const REOPEN = { status: 'in_testing', statusType: 'active' };
const move = (from, to, fromMarked = false, toMarked = false) => ({ from, fromMarked, to, toMarked });

describe('planLifecycle', () => {
    test.each([
        ['a status change between open statuses', open, { status: 'in_design', statusType: 'active' }, {}, null],
        ['close', open, CLOSE, { statusBeforeClose: 'in_testing' }, move([0], 8)],
        ['reopen', closed, REOPEN, { statusBeforeClose: null }, move([8], 0)],
        ['archive', open, { deletedStatusKey: 2 }, {}, move([0], 7)],
        ['restore', { ...open, deletedStatusKey: 2 }, { deletedStatusKey: 0 }, {}, move([7], 0)],
        ['archive a closed project', closed, { deletedStatusKey: 2 }, {}, move([8], 7)],
        ['restore a closed project', { ...closed, deletedStatusKey: 2 }, { deletedStatusKey: 0 }, {}, move([7], 8)],
        ['close an archived project', { ...open, deletedStatusKey: 2 }, CLOSE, { statusBeforeClose: 'in_testing' }, null],
        ['trash an open project', open, { deletedStatusKey: 1 }, { trashedFromKey: 0 }, move([0], 1, false, true)],
        ['trash an archived project', { ...open, deletedStatusKey: 2 }, { deletedStatusKey: 1 }, { trashedFromKey: 2 }, move([7], 1, false, true)],
        ['trash a closed project', closed, { deletedStatusKey: 1 }, { trashedFromKey: 0 }, move([8], 1, false, true)],
        ['restore from the trash to archived', { ...open, deletedStatusKey: 1, trashedFromKey: 2 }, { deletedStatusKey: 2 }, { trashedFromKey: null }, move([1], 7, true)],
        ['restore from the trash to open', { ...open, deletedStatusKey: 1, trashedFromKey: 0 }, { deletedStatusKey: 0 }, { trashedFromKey: null }, move([1], 0, true)],
        ['restore from the trash to closed', { ...closed, deletedStatusKey: 1, trashedFromKey: 0 }, { deletedStatusKey: 0 }, { trashedFromKey: null }, move([1], 8, true)],
        ['restore a project trashed before the stamp', { ...open, deletedStatusKey: 1 }, { deletedStatusKey: 0 }, {}, move([1, 7], 0)],
    ])('%s', (_name, before, update, stamp, expected) => {
        const plan = planLifecycle(before, update);
        expect(plan.stamp).toEqual(stamp);
        expect(plan.move).toEqual(expected);
    });

    test('every undo moves the tasks back to where they were', () => {
        const states = [open, closed, { ...open, deletedStatusKey: 2 }, { ...closed, deletedStatusKey: 2 }];
        states.forEach((state) => {
            const away = planLifecycle(state, { deletedStatusKey: 1 });
            const trashed = { ...state, deletedStatusKey: 1, ...away.stamp };
            const back = planLifecycle(trashed, { deletedStatusKey: restoreTargetOf(trashed) });
            expect(back.move.from).toEqual([away.move.to]);
            expect(back.move.to).toBe(away.move.from[0]);
        });
    });
});

describe('restoreTargetOf', () => {
    test.each([
        [{ trashedFromKey: 2 }, 2],
        [{ trashedFromKey: 0 }, 0],
        [{ trashedFromKey: null }, 0],
        [{}, 0],
    ])('%o → %i', (project, key) => expect(restoreTargetOf(project)).toBe(key));
});

describe('touchesLifecycle', () => {
    test.each([
        [{ deletedStatusKey: 2 }, undefined, true],
        [{ status: 'a', statusType: 'close' }, '$set', true],
        [{ status: 'a' }, undefined, false],
        [{ deletedStatusKey: 2 }, '$addToSet', false],
        [{ ProjectName: 'x' }, undefined, false],
    ])('%o with %s → %s', (update, key, touches) => expect(touchesLifecycle(update, key)).toBe(touches));
});

describe('applyMove', () => {
    const COMPANY = '6f00000000000000000000c1';
    const PROJECT = new mongoose.Types.ObjectId();
    const TASK = new mongoose.Types.ObjectId();

    beforeEach(() => {
        jest.clearAllMocks();
        MongoDbCrudOpration.mockImplementation(async (companyId, query, method) => (method === 'find' ? [{ _id: TASK, ProjectID: PROJECT }] : { acknowledged: true }));
    });

    const writes = () => MongoDbCrudOpration.mock.calls.filter(([, , method]) => method === 'updateMany').map(([, query]) => query.data);

    test('nothing to move writes nothing', async () => {
        await applyMove(COMPANY, String(PROJECT), null);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    test('open tasks include the ones written without a key', async () => {
        await applyMove(COMPANY, String(PROJECT), move([0], 7));
        expect(writes()).toEqual([[{ ProjectID: PROJECT, deletedStatusKey: { $in: [0, null] }, _id: { $in: [TASK] } }, { $set: { deletedStatusKey: 7 } }]]);
    });

    test('tasks going to the trash with the project are marked', async () => {
        await applyMove(COMPANY, String(PROJECT), move([0], 1, false, true));
        expect(writes()[0][1]).toEqual({ $set: { deletedStatusKey: 1, trashedWithProject: true } });
    });

    test('only the marked tasks come back, and no mark is left in the project', async () => {
        await applyMove(COMPANY, String(PROJECT), move([1], 7, true));
        expect(writes()).toEqual([
            [{ ProjectID: PROJECT, deletedStatusKey: 1, trashedWithProject: true, _id: { $in: [TASK] } }, { $set: { deletedStatusKey: 7 }, $unset: { trashedWithProject: '' } }],
            [{ ProjectID: PROJECT, trashedWithProject: { $exists: true } }, { $unset: { trashedWithProject: '' } }],
        ]);
    });

    test('open boards hear about each moved task unless the caller is a nightly run', async () => {
        const spy = jest.spyOn(socketEmitter, 'emit').mockImplementation(() => true);
        await applyMove(COMPANY, String(PROJECT), move([0], 8));
        expect(spy).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'task', updatedFields: { deletedStatusKey: 8 } }));
        spy.mockClear();
        await applyMove(COMPANY, String(PROJECT), move([0], 8), { announce: false });
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});
