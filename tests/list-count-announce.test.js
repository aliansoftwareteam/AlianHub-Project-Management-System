/* AP-486 run 2: tasks an agent made left the list counts at 0 in every open browser until a reload, because a
   task-count change to a list was never announced. A burst of them is now announced once per list. */
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const socketEmitter = require('../event/socketEventEmitter');
const { announceListCount, COUNT_GATHER_MS } = require('../Modules/Sprints/helpers/listEvents');

const CID = '6f0000000000000000000c01';
const LIST_A = '6f0000000000000000000e01';
const LIST_B = '6f0000000000000000000e02';

describe('announcing a list task count change', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        socketEmitter.emit.mockClear();
    });
    afterEach(() => jest.useRealTimers());

    it('says once per list that a burst of task writes changed it', () => {
        announceListCount(CID, { _id: LIST_A, tasks: 1 });
        announceListCount(CID, { _id: LIST_A, tasks: 2 });
        announceListCount(CID, { _id: LIST_B, tasks: 1 });
        expect(socketEmitter.emit).not.toHaveBeenCalled();

        jest.advanceTimersByTime(COUNT_GATHER_MS);

        expect(socketEmitter.emit.mock.calls).toEqual([
            ['update', { type: 'update', companyId: CID, module: 'sprints', data: { _id: LIST_A } }],
            ['update', { type: 'update', companyId: CID, module: 'sprints', data: { _id: LIST_B } }],
        ]);
    });

    it('says it again for the next burst', () => {
        announceListCount(CID, { _id: LIST_A });
        jest.advanceTimersByTime(COUNT_GATHER_MS);
        announceListCount(CID, { _id: LIST_A });
        jest.advanceTimersByTime(COUNT_GATHER_MS);
        expect(socketEmitter.emit).toHaveBeenCalledTimes(2);
    });

    it('says nothing for a row with no id', () => {
        announceListCount(CID, null);
        jest.advanceTimersByTime(COUNT_GATHER_MS);
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });
});
