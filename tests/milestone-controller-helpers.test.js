const mockCrud = jest.fn();
const mockHistory = jest.fn();
const mockNotify = jest.fn();
const mockRemoveCache = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn() } }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: (...a) => mockRemoveCache(...a) }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: (...a) => mockHistory(...a) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: (...a) => mockNotify(...a) }));
jest.mock('../Modules/Project/controller/updateProject.js', () => ({ updateProjectInternal: jest.fn() }));

const logger = require('../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');
const h = require('../Modules/Milestone/controller/helpers');

const C = '6f0000000000000000000c01';
const P = '6f0000000000000000000b01';
const USER = { id: '6f0000000000000000000001', Employee_Name: 'Ana' };

const settle = () => new Promise((resolve) => setImmediate(resolve));
const historyMessages = () => mockHistory.mock.calls.map((c) => c[4].message);
const settingsWrites = () => mockCrud.mock.calls.map(([companyId, obj, method]) => ({ companyId, obj, method }));
const statusUpdate = (call) => ({
    filter: call.obj.data[0],
    update: call.obj.data[1],
    arrayFilters: call.obj.data[2].arrayFilters,
});

beforeEach(() => {
    jest.clearAllMocks();
    mockCrud.mockResolvedValue({ acknowledged: true });
    mockHistory.mockResolvedValue(true);
    mockNotify.mockResolvedValue(true);
});

describe('addMilestoneHistoryNotification', () => {
    const history = { key: 'Project_Milestone_Added', message: 'added' };
    const notification = { key: 'project_milestone', message: 'n' };
    const run = (statusObj) => h.addMilestoneHistoryNotification(C, P, USER, statusObj, history, notification, 'Beta', 'Apollo');

    it('records the history line against the project, for the caller and company', async () => {
        await run(null);
        expect(mockHistory).toHaveBeenCalledWith('project', C, P, null, history, USER);
    });

    it('notifies the project with the caller as the sender', async () => {
        await run(null);
        expect(mockNotify).toHaveBeenCalledTimes(1);
        expect(mockNotify).toHaveBeenCalledWith({
            type: 'project', companyId: C, projectId: P, taskId: undefined, folderId: undefined, sprintId: undefined,
            object: notification, userData: USER,
        });
    });

    it('does not touch the status counters when no status was set', async () => {
        await run(undefined);
        await settle();
        expect(mockCrud).not.toHaveBeenCalled();
        expect(mockRemoveCache).not.toHaveBeenCalled();
    });

    it('sends a second notification naming the milestone, the status and its colour', async () => {
        await run({ name: 'Pending', value: 'PENDING', backgroundColor: '#123456' });
        expect(mockNotify).toHaveBeenCalledTimes(2);
        const second = mockNotify.mock.calls[1][0];
        expect(second.object.key).toBe('project_milestone_status_change');
        expect(second.object.message).toContain('<strong>Beta</strong>');
        expect(second.object.message).toContain('Pending');
        expect(second.object.message).toContain('#123456');
        expect(second.object.message).toContain('<strong>Apollo</strong>');
        expect(second.companyId).toBe(C);
    });

    it('counts one more milestone in an ordinary status, in the caller company only', async () => {
        await run({ name: 'Pending', value: 'PENDING', backgroundColor: '#fff' });
        await settle();
        const writes = settingsWrites();
        expect(writes).toHaveLength(1);
        expect(writes[0].companyId).toBe(C);
        expect(writes[0].method).toBe('updateOne');
        expect(writes[0].obj.type).toBe(SCHEMA_TYPE.SETTINGS);
        expect(statusUpdate(writes[0])).toEqual({
            filter: { name: settingsCollectionDocs.PROJECT_MILESTONE_STATUS },
            update: { $inc: { 'settings.$[elementIndex].isCount': 1 } },
            arrayFilters: [{ 'elementIndex.value': 'PENDING' }],
        });
    });

    it.each(['FUNDED', 'RELEASED'])('resets the counter to zero for %s instead of incrementing', async (value) => {
        await run({ name: value, value, backgroundColor: '#fff' });
        await settle();
        const writes = settingsWrites();
        expect(writes).toHaveLength(1);
        expect(writes[0].companyId).toBe(C);
        expect(statusUpdate(writes[0]).update).toEqual({ $set: { 'settings.$[elementIndex].isCount': 0 } });
        expect(statusUpdate(writes[0]).arrayFilters).toEqual([{ 'elementIndex.value': value }]);
    });

    it('drops the cached status list of the same company once the counter is written', async () => {
        await run({ name: 'Pending', value: 'PENDING', backgroundColor: '#fff' });
        await settle();
        expect(mockRemoveCache).toHaveBeenCalledWith(`milestoneStatus:${C}`);
    });

    it('keeps the cache and logs when the counter write fails', async () => {
        mockCrud.mockRejectedValue(new Error('db down'));
        await expect(run({ name: 'Pending', value: 'PENDING', backgroundColor: '#fff' })).resolves.toBeUndefined();
        await settle();
        expect(mockRemoveCache).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
    });

    it('logs and resolves when history and notification reject', async () => {
        mockHistory.mockRejectedValue(new Error('h fail'));
        mockNotify.mockRejectedValue(new Error('n fail'));
        await expect(run(null)).resolves.toBeUndefined();
        await settle();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('h fail'));
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('n fail'));
    });

    it('logs and resolves when history throws before returning a promise', async () => {
        mockHistory.mockImplementation(() => { throw new Error('sync'); });
        await expect(run(null)).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('sync'));
    });
});

describe('updateMilestoneNotification', () => {
    const prior = { name: 'Pending', backgroundColor: '#aaa' };
    const next = { name: 'Funded', value: 'FUNDED', backgroundColor: '#bbb', statusDate: '2026-03-01T00:00:00Z' };
    const run = (over = {}) => {
        const a = { prev: 'Beta', status: null, array: { statusArray: [] }, name: 'Beta', statusObj: prior, ...over };
        return h.updateMilestoneNotification(a.prev, a.status, C, P, USER, a.name, a.array, 'Apollo', a.statusObj);
    };

    it('does nothing when the name is unchanged and no status was given', async () => {
        await run();
        await settle();
        expect(mockHistory).not.toHaveBeenCalled();
        expect(mockNotify).not.toHaveBeenCalled();
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('records a rename with both names, the project and the caller', async () => {
        await run({ prev: 'Alpha', name: 'Beta' });
        expect(mockHistory).toHaveBeenCalledTimes(1);
        const [type, companyId, projectId, , historyObj, user] = mockHistory.mock.calls[0];
        expect([type, companyId, projectId, user]).toEqual(['project', C, P, USER]);
        expect(historyObj.key).toBe('Project_Milestone_Edit_Name');
        expect(historyObj.message).toContain('<b>Ana</b>');
        expect(historyObj.message).toContain('<b>Beta</b> from <b>Alpha</b>');
        expect(historyObj.message).toContain('<b>Apollo</b>');
        expect(mockNotify.mock.calls[0][0]).toMatchObject({ companyId: C, projectId: P, userData: USER, object: { key: 'project_milestone' } });
    });

    it('names the previous and new status when the milestone already had one', async () => {
        await run({ status: next, array: { statusArray: [{}, {}] } });
        const message = historyMessages()[0];
        expect(message).toContain('from <b>Pending</b> to <b>Funded</b>');
        expect(message).toContain(`DATE_${new Date(next.statusDate).getTime()}`);
        expect(mockHistory.mock.calls[0][4].key).toBe('Project_Milestone_Status_Changed');
        const note = mockNotify.mock.calls[0][0].object;
        expect(note.key).toBe('project_milestone_status_change');
        expect(note.message).toContain('changed from');
        expect(note.message).toContain('#aaa');
        expect(note.message).toContain('#bbb');
    });

    it('words the first status of a milestone as "set", not "changed"', async () => {
        await run({ status: next, array: { statusArray: [{}] } });
        expect(historyMessages()[0]).toContain('has set the status of milestone Beta to  Pending');
        expect(mockNotify.mock.calls[0][0].object.message).toContain('is added');
    });

    it('still sends the status history and notification, without a message, when the status array is empty', async () => {
        await run({ status: next, array: { statusArray: [] } });
        expect(mockHistory).toHaveBeenCalledTimes(1);
        expect(mockHistory.mock.calls[0][4]).toEqual({ key: 'Project_Milestone_Status_Changed' });
        expect(mockNotify.mock.calls[0][0].object).toEqual({ key: 'project_milestone_status_change' });
    });

    it('resets the FUNDED counter in the caller company and clears that company cache', async () => {
        await run({ status: next });
        await settle();
        const writes = settingsWrites();
        expect(writes).toHaveLength(1);
        expect(writes[0].companyId).toBe(C);
        expect(statusUpdate(writes[0])).toEqual({
            filter: { name: settingsCollectionDocs.PROJECT_MILESTONE_STATUS },
            update: { $set: { 'settings.$[elementIndex].isCount': 0 } },
            arrayFilters: [{ 'elementIndex.value': 'FUNDED' }],
        });
        expect(mockRemoveCache).toHaveBeenCalledWith(`milestoneStatus:${C}`);
    });

    it('counts up an ordinary status in the caller company', async () => {
        await run({ status: { ...next, value: 'IN_PROGRESS' } });
        await settle();
        expect(settingsWrites()[0].companyId).toBe(C);
        expect(statusUpdate(settingsWrites()[0]).update).toEqual({ $inc: { 'settings.$[elementIndex].isCount': 1 } });
        expect(statusUpdate(settingsWrites()[0]).arrayFilters).toEqual([{ 'elementIndex.value': 'IN_PROGRESS' }]);
    });

    it('logs and resolves when the milestone array is missing', async () => {
        await expect(run({ status: next, array: undefined })).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('updateMilestoneNotification'));
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('logs and resolves when the counter write fails', async () => {
        mockCrud.mockRejectedValue(new Error('db down'));
        await expect(run({ status: next })).resolves.toBeUndefined();
        await settle();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
        expect(mockRemoveCache).not.toHaveBeenCalled();
    });
});

describe.each([
    ['deleteMilestoneNotification', h.deleteMilestoneNotification],
    ['clearMilestoneStatusNotification', h.clearMilestoneStatusNotification],
])('%s', (name, fn) => {
    const history = { key: 'k', message: 'm' };
    const notification = { key: 'n', message: 'nm' };
    const run = (milestone) => fn(C, P, USER, milestone, history, notification);

    it('records history and notifies the project as the caller', async () => {
        await run({ statusArray: [] });
        expect(mockHistory).toHaveBeenCalledWith('project', C, P, null, history, USER);
        expect(mockNotify).toHaveBeenCalledWith({
            type: 'project', companyId: C, projectId: P, taskId: undefined, folderId: undefined, sprintId: undefined,
            object: notification, userData: USER,
        });
    });

    it('writes no counters for a milestone with no status', async () => {
        await run({ statusArray: [] });
        await run({});
        await settle();
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it.each(['CANCELLED', 'RELEASED', 'FUNDED', 'REFUNDED'])('zeroes the %s counter', async (color) => {
        await run({ statusArray: [{ milestoneStatusColor: color }] });
        await settle();
        const writes = settingsWrites();
        expect(writes).toHaveLength(1);
        expect(writes[0].companyId).toBe(C);
        expect(writes[0].method).toBe('updateOne');
        expect(statusUpdate(writes[0])).toEqual({
            filter: { name: settingsCollectionDocs.PROJECT_MILESTONE_STATUS },
            update: { $set: { 'settings.$[elementIndex].isCount': 0 } },
            arrayFilters: [{ 'elementIndex.value': color }],
        });
    });

    it('takes one off the counter of any other status', async () => {
        await run({ statusArray: [{ milestoneStatusColor: 'PENDING' }] });
        await settle();
        expect(settingsWrites()[0].companyId).toBe(C);
        expect(statusUpdate(settingsWrites()[0]).update).toEqual({ $inc: { 'settings.$[elementIndex].isCount': -1 } });
        expect(statusUpdate(settingsWrites()[0]).arrayFilters).toEqual([{ 'elementIndex.value': 'PENDING' }]);
    });

    it('adjusts every status the milestone went through and clears the company cache for each', async () => {
        await run({ statusArray: [{ milestoneStatusColor: 'PENDING' }, { milestoneStatusColor: 'FUNDED' }] });
        await settle();
        expect(settingsWrites().map((w) => w.companyId)).toEqual([C, C]);
        expect(settingsWrites().map((w) => statusUpdate(w).arrayFilters[0]['elementIndex.value'])).toEqual(['PENDING', 'FUNDED']);
        expect(mockRemoveCache).toHaveBeenCalledTimes(2);
        expect(mockRemoveCache).toHaveBeenCalledWith(`milestoneStatus:${C}`);
    });

    it('logs and resolves when the counter write fails', async () => {
        mockCrud.mockRejectedValue(new Error('db down'));
        await expect(run({ statusArray: [{ milestoneStatusColor: 'PENDING' }] })).resolves.toBeUndefined();
        await settle();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
        expect(mockRemoveCache).not.toHaveBeenCalled();
    });

    it('logs and resolves when given no milestone', async () => {
        await expect(run(undefined)).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalled();
        expect(mockCrud).not.toHaveBeenCalled();
    });
});

describe('addMilestoneHistory', () => {
    const base = { milestoneName: 'Beta', statusArray: [] };
    const run = (milestone, status, currency = '$') => h.addMilestoneHistory(milestone, C, P, USER, status, currency);

    it('writes nothing for a milestone with no dates, status or amount', () => {
        run(base, null);
        expect(mockHistory).not.toHaveBeenCalled();
    });

    it('writes one line per date, with the timestamp the client will format', () => {
        const dates = { startDate: '2026-01-01T00:00:00Z', endDate: '2026-02-01T00:00:00Z', dueDate: '2026-03-01T00:00:00Z' };
        run({ ...base, ...dates }, null);
        const messages = historyMessages();
        expect(messages).toHaveLength(3);
        expect(messages[0]).toContain(`start date of milestone <b>Beta</b> to <b>DATE_${new Date(dates.startDate).getTime()}</b>`);
        expect(messages[1]).toContain(`end date of milestone <b>Beta</b> to <b>DATE_${new Date(dates.endDate).getTime()}</b>`);
        expect(messages[2]).toContain(`due date of milestone <b>Beta</b> to <b>DATE_${new Date(dates.dueDate).getTime()}</b>`);
    });

    it('files every line under the same key, project, company and caller', () => {
        run({ ...base, startDate: '2026-01-01' }, null);
        const [type, companyId, projectId, , historyObj, user] = mockHistory.mock.calls[0];
        expect([type, companyId, projectId, user]).toEqual(['project', C, P, USER]);
        expect(historyObj.key).toBe('Project_Milestone_Changed');
        expect(historyObj.message).toContain('<b>Ana</b>');
    });

    it('records the status date of the first status and the status label', () => {
        run({ ...base, statusArray: [{ statusDateValue: '2026-04-01T00:00:00Z' }] }, { label: 'Funded' });
        const messages = historyMessages();
        expect(messages[0]).toContain(`status date of milestone <b>Beta</b> to <b>DATE_${new Date('2026-04-01T00:00:00Z').getTime()}</b>`);
        expect(messages[1]).toContain('status of milestone <b>Beta</b> to <b>Funded</b>');
    });

    it('records the amount with its currency, and skips a zero amount', () => {
        run({ ...base, amount: 250 }, null, 'EUR');
        expect(historyMessages()).toEqual([expect.stringContaining('amount of milestone <b>Beta</b> to <b>EUR 250</b>')]);
        jest.clearAllMocks();
        run({ ...base, amount: 0 }, null, 'EUR');
        expect(mockHistory).not.toHaveBeenCalled();
    });

    it('swallows a history rejection with a log line', async () => {
        mockHistory.mockRejectedValue(new Error('h fail'));
        run({ ...base, startDate: '2026-01-01' }, null);
        await settle();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('h fail'));
    });
});

describe('updateMilestoneHistory', () => {
    const run = (oldObject, newObject, currency = '$') => h.updateMilestoneHistory(C, P, USER, oldObject, newObject, currency);
    const named = { milestoneName: 'Beta' };

    it('writes nothing when nothing changed', () => {
        const same = { ...named, startDate: '2026-01-01', endDate: '2026-02-01', dueDate: '2026-03-01', amount: 10 };
        run({ ...same }, { ...same });
        expect(mockHistory).not.toHaveBeenCalled();
    });

    it('writes nothing when the new milestone has no dates or amount', () => {
        run({ ...named, startDate: '2026-01-01', amount: 10 }, { ...named });
        expect(mockHistory).not.toHaveBeenCalled();
    });

    it('reports a first-time date as "set" when the old one was empty', () => {
        run({ startDate: '', endDate: '', dueDate: '' }, { ...named, startDate: '2026-01-01', endDate: '2026-02-01', dueDate: '2026-03-01' });
        const messages = historyMessages();
        expect(messages).toHaveLength(3);
        expect(messages[0]).toContain('has set the start date');
        expect(messages[1]).toContain('has set the end date');
        expect(messages[2]).toContain('has set the due date');
    });

    it('reports a moved date with the old and new timestamps', () => {
        run({ startDate: '2026-01-01T00:00:00Z' }, { ...named, startDate: '2026-01-05T00:00:00Z' });
        expect(historyMessages()).toEqual([
            expect.stringContaining(`start date from <b>DATE_${new Date('2026-01-01T00:00:00Z').getTime()}</b> to <b>DATE_${new Date('2026-01-05T00:00:00Z').getTime()}</b>`),
        ]);
    });

    it('treats the same instant written two ways as unchanged', () => {
        run({ dueDate: '2026-03-01T00:00:00.000Z' }, { ...named, dueDate: new Date('2026-03-01T00:00:00Z') });
        expect(mockHistory).not.toHaveBeenCalled();
    });

    it('reports an amount change with its currency, and a first amount as "set"', () => {
        run({ amount: 10 }, { ...named, amount: 25 }, 'GBP');
        expect(historyMessages()[0]).toContain('amount from <b>GBP 10</b> to <b>GBP 25</b>');
        jest.clearAllMocks();
        run({ amount: '' }, { ...named, amount: 25 }, 'GBP');
        expect(historyMessages()[0]).toContain('has set the amount of milestone <b>Beta</b> to GBP 25');
    });

    it('files each line for the project, company and caller under the changed key', () => {
        run({ endDate: '2026-01-01' }, { ...named, endDate: '2026-01-09' });
        const [type, companyId, projectId, , historyObj, user] = mockHistory.mock.calls[0];
        expect([type, companyId, projectId, user]).toEqual(['project', C, P, USER]);
        expect(historyObj.key).toBe('Project_Milestone_Changed');
    });

    it('swallows a history rejection with a log line', async () => {
        mockHistory.mockRejectedValue(new Error('h fail'));
        run({ endDate: '2026-01-01' }, { ...named, endDate: '2026-01-09' });
        await settle();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('h fail'));
    });
});
