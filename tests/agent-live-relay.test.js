const mockCrud = jest.fn();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const socketEmitter = require('../event/socketEventEmitter');
const helper = require('../socket/helper');
const { relay, EVENT, forget } = require('../socket/controller/agentSocket');
const runs = require('../Modules/Agents/runs');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const PROJECT = '6f0000000000000000000b01';

const join = (companyId, socketId) => {
    const emit = jest.fn();
    const roomName = `selected_companies_${companyId}**${socketId}`;
    const socket = { id: socketId, rooms: new Set([roomName]), identity: { companyId, uid: 'u1' } };
    helper.upsertRoom({ roomName, socketId, socket, namespace: { to: jest.fn(() => ({ emit })) } });
    return emit;
};

const change = (data, companyId = C) => ({ type: 'update', module: 'agent', companyId, data });
const runChange = (status, extra = {}) => change({ kind: 'run', run: { _id: 'r1', status, outcome: 'secret outcome', ...extra } });

describe('the live agents signal', () => {
    let mine;
    let theirs;

    beforeEach(() => {
        forget();
        mine = join(C, 's1');
        theirs = join(OTHER_COMPANY, 's2');
    });

    it('listens to what agent runs and proposals emit', () => {
        expect(socketEmitter.on.mock.calls.map(([event]) => event)).toContain('agent:update');
    });

    it('reaches the sockets of that company and no other, and carries nothing of the run', () => {
        relay(runChange('running'));
        expect(mine).toHaveBeenCalledTimes(1);
        expect(mine).toHaveBeenCalledWith(EVENT, { kind: 'run' });
        expect(theirs).not.toHaveBeenCalled();
    });

    it('stays silent while a working run only records steps and spend', () => {
        relay(runChange('running'));
        relay(runChange('running', { elapsedMs: 4000 }));
        relay(runChange('running', { spend: { usd: 0.4 } }));
        expect(mine).toHaveBeenCalledTimes(1);
    });

    it('speaks again when the run changes status', () => {
        relay(runChange('running'));
        relay(runChange('waiting_approval'));
        relay(runChange('done'));
        relay(runChange('done', { revertedAt: new Date() }));
        expect(mine).toHaveBeenCalledTimes(3);
    });

    it('tells of a proposal, a pause and a deleted agent', () => {
        relay(change({ kind: 'proposal', proposal: { _id: 'p1' } }));
        relay(change({ kind: 'agent', pausedAll: true }));
        relay(change({ kind: 'agent', agentId: 'a1', deleted: true }));
        relay(change({ kind: 'agent', agent: { _id: 'a1', paused: true } }));
        expect(mine.mock.calls.map(([, payload]) => payload.kind)).toEqual(['proposal', 'agent', 'agent', 'agent']);
    });

    it('says nothing for spend, revisions, schedules and alerts', () => {
        relay(change({ kind: 'agent', agentId: 'a1', spendMonth: { usd: 3 }, paused: false }));
        relay(change({ kind: 'agent', agentId: 'a1', revision: 4 }));
        relay(change({ kind: 'agent', agentId: 'a1', schedules: true }));
        relay(change({ kind: 'alert', alert: { _id: 'x' } }));
        relay(change({ kind: 'run' }));
        relay({ type: 'update', module: 'agent', data: { kind: 'proposal' } });
        expect(mine).not.toHaveBeenCalled();
    });
});

describe('the open runs in the live summary', () => {
    it('name their project, skill and spend, so one read serves every project page', async () => {
        mockCrud.mockResolvedValue([
            { _id: 'r1', agentId: 'a1', agentName: 'Reviewer', status: 'running', startedAt: new Date(), taskId: 't1', projectId: PROJECT, skill: 'code_review', spend: { usd: 0.126 } },
            { _id: 'r2', agentId: 'a2', agentName: 'Planner', status: 'waiting_approval', startedAt: new Date(), taskId: 't2', projectId: null, spend: {} },
        ]);
        const summary = await runs.summary(C);
        expect(mockCrud.mock.calls[0][1].data[1].split(' ')).toEqual(expect.arrayContaining(['projectId', 'skill', 'spend']));
        expect(summary.runs).toEqual([
            expect.objectContaining({ _id: 'r1', taskId: 't1', projectId: PROJECT, skill: 'code_review', spendUsd: 0.13 }),
            expect.objectContaining({ _id: 'r2', taskId: 't2', projectId: null, skill: null, spendUsd: 0 }),
        ]);
    });
});
