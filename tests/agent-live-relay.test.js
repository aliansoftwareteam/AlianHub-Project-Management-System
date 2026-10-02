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
const VIEWER = '6f0000000000000000000a01';

const join = (companyId, socketId) => {
    const emit = jest.fn();
    const roomName = `selected_companies_${companyId}**${socketId}`;
    const socket = { id: socketId, rooms: new Set([roomName]), identity: { companyId, uid: VIEWER } };
    helper.upsertRoom({ roomName, socketId, socket, namespace: { to: jest.fn(() => ({ emit })) } });
    return emit;
};

const change = (data, companyId = C) => ({ type: 'update', module: 'agent', companyId, data });
const runChange = (status, extra = {}) => change({ kind: 'run', run: { _id: 'r1', status, outcome: 'secret outcome', ...extra } });

describe('the live agents signal', () => {
    let mine;
    let theirs;

    beforeEach(() => {
        mockCrud.mockResolvedValue({ roleType: 3 });
        forget();
        mine = join(C, 's1');
        theirs = join(OTHER_COMPANY, 's2');
    });

    it('listens to what agent runs and proposals emit', () => {
        expect(socketEmitter.on.mock.calls.map(([event]) => event)).toContain('agent:update');
    });

    it('reaches the sockets of that company and no other, and carries nothing of the run', async () => {
        await relay(runChange('running'));
        expect(mine).toHaveBeenCalledTimes(1);
        expect(mine).toHaveBeenCalledWith(EVENT, { kind: 'run' });
        expect(theirs).not.toHaveBeenCalled();
    });

    it('stays silent while a working run only records steps and spend', async () => {
        await relay(runChange('running'));
        await relay(runChange('running', { elapsedMs: 4000 }));
        await relay(runChange('running', { spend: { usd: 0.4 } }));
        expect(mine).toHaveBeenCalledTimes(1);
    });

    it('speaks again when the run changes status', async () => {
        await relay(runChange('running'));
        await relay(runChange('waiting_approval'));
        await relay(runChange('done'));
        await relay(runChange('done', { revertedAt: new Date() }));
        expect(mine).toHaveBeenCalledTimes(3);
    });

    it('tells of a proposal, a pause and a deleted agent', async () => {
        await relay(change({ kind: 'proposal', proposal: { _id: 'p1' } }));
        await relay(change({ kind: 'agent', pausedAll: true }));
        await relay(change({ kind: 'agent', agentId: 'a1', deleted: true }));
        await relay(change({ kind: 'agent', agent: { _id: 'a1', paused: true } }));
        expect(mine.mock.calls.map(([, payload]) => payload.kind)).toEqual(['proposal', 'agent', 'agent', 'agent']);
    });

    it('tells of a change to the workspace\'s agent settings, to that company alone', async () => {
        await relay(change({ kind: 'policy' }));
        expect(mine).toHaveBeenCalledWith(EVENT, { kind: 'policy' });
        expect(theirs).not.toHaveBeenCalled();
    });

    it('tells of a change to a project\'s limits for agents, to that company alone', async () => {
        await relay(change({ kind: 'limits' }));
        expect(mine).toHaveBeenCalledWith(EVENT, { kind: 'limits' });
        expect(theirs).not.toHaveBeenCalled();
    });

    it('says nothing for spend, revisions, schedules and alerts', async () => {
        await relay(change({ kind: 'agent', agentId: 'a1', spendMonth: { usd: 3 }, paused: false }));
        await relay(change({ kind: 'agent', agentId: 'a1', revision: 4 }));
        await relay(change({ kind: 'agent', agentId: 'a1', schedules: true }));
        await relay(change({ kind: 'alert', alert: { _id: 'x' } }));
        await relay(change({ kind: 'run' }));
        await relay({ type: 'update', module: 'agent', data: { kind: 'proposal' } });
        expect(mine).not.toHaveBeenCalled();
    });
});

describe('a change a person\'s own agent applied', () => {
    const PERSON = '6f0000000000000000000a11';
    const TEAMMATE = '6f0000000000000000000a12';
    const GUEST = '6f0000000000000000000a13';
    const UNSEATED = '6f0000000000000000000a14';
    const AUDIT = '6f0000000000000000000d01';
    const ROLES = { [PERSON]: 3, [TEAMMATE]: 3, [GUEST]: 0 };

    const seat = (companyId, socketId, uid) => {
        const emit = jest.fn();
        const toRoom = jest.fn();
        const roomName = `selected_companies_${companyId}**${socketId}`;
        const socket = { id: socketId, rooms: new Set([roomName]), identity: { companyId, uid }, emit };
        helper.upsertRoom({ roomName, socketId, socket, namespace: { to: jest.fn(() => ({ emit: toRoom })) } });
        return { emit, toRoom };
    };
    const applied = (userId, companyId = C) => change({ kind: 'change', userId, auditId: AUDIT }, companyId);

    let sockets;
    let room;

    beforeEach(() => {
        room = join(C, 's1');
        mockCrud.mockImplementation(async (companyId, query) => {
            const roleType = ROLES[query.data[0].userId];
            return roleType === undefined ? null : { roleType };
        });
        sockets = {
            desk: seat(C, 'p1', PERSON),
            phone: seat(C, 'p2', PERSON),
            teammate: seat(C, 'p3', TEAMMATE),
            guest: seat(C, 'p4', GUEST),
            elsewhere: seat(OTHER_COMPANY, 'p5', PERSON),
            unseated: seat(C, 'p6', UNSEATED),
        };
    });
    afterEach(() => {
        ['p1', 'p2', 'p3', 'p4', 'p6'].forEach((id) => helper.removeRoom(`selected_companies_${C}**${id}`));
        helper.removeRoom(`selected_companies_${OTHER_COMPANY}**p5`);
    });

    it('reaches every socket of that person in that company, naming the company and the change', async () => {
        await relay(applied(PERSON));
        expect(sockets.desk.emit).toHaveBeenCalledTimes(1);
        expect(sockets.desk.emit).toHaveBeenCalledWith(EVENT, { kind: 'change', companyId: C, auditId: AUDIT });
        expect(sockets.phone.emit).toHaveBeenCalledWith(EVENT, { kind: 'change', companyId: C, auditId: AUDIT });
    });

    it('reaches no teammate, no guest, no other company and never the company\'s room', async () => {
        await relay(applied(PERSON));
        ['teammate', 'guest', 'elsewhere', 'unseated'].forEach((who) => expect(sockets[who].emit).not.toHaveBeenCalled());
        Object.values(sockets).forEach((socket) => expect(socket.toRoom).not.toHaveBeenCalled());
        expect(room).not.toHaveBeenCalled();
    });

    it('reaches nobody once the person holds no seat, and nobody when it names no person or no change', async () => {
        await relay(applied(UNSEATED));
        await relay(applied(''));
        await relay(change({ kind: 'change', userId: PERSON }));
        await relay({ type: 'update', module: 'agent', data: { kind: 'change', userId: PERSON, auditId: AUDIT } });
        Object.values(sockets).forEach((socket) => expect(socket.emit).not.toHaveBeenCalled());
    });
});

describe('the open runs in the live summary', () => {
    it('name their project, skill and spend, so one read serves every project page', async () => {
        mockCrud.mockReset();
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
