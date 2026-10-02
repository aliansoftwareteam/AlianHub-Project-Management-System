const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/Audit/controller');
const eventWords = require('../Modules/Audit/eventWords');

const CID = '6f00000000000000000000c1';
const OWNER = '6f0000000000000000000001';
const AGENT = { actorType: 'agent', agentId: '6f0000000000000000000a01', agentName: 'Reviewer' };

const ROWS = {
    member: { action: 'member.update', entityType: 'member', entityName: 'Mira', meta: {} },
    comment: { action: 'agent.action', entityType: 'task', entityName: 'AP-1', meta: { ...AGENT, action: 'task.comment' } },
    pause: { action: 'agent.action_refused', entityType: 'agent', entityName: 'Reviewer', meta: { ...AGENT, action: 'agent.pause_all', reason: 'Agents cannot perform agent.pause_all (never_listed)' } },
    lateUndo: { action: 'agent.action_refused', entityType: 'task', entityName: 'AP-2', meta: { ...AGENT, action: 'undo', reason: 'undo_window_passed' } },
    hidden: { action: 'agent.action_refused', entityType: 'task', entityName: 'AP-3', meta: { ...AGENT, action: 'task.get', reason: 'not_visible: the task is not one this person can open' } },
};

const list = async (query) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = (b) => { res.body = b; return res; };
    await ctrl.listAuditLogs(verified({ uid: OWNER, headers: { companyid: CID }, query, body: {} }), res);
    expect(res.body.status).toBe(true);
    return res.body.data.map((row) => row.entityName).sort();
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    Object.values(ROWS).forEach((row, at) => mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, { actorId: OWNER, actorName: 'Olivia Owner', createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, at)), ...row }));
});

describe('searching the audit log by the words on screen', () => {
    it('finds a row by the words for what happened', async () => {
        expect(eventWords.EVENTS['member.update']).toBe('Changed a member\'s role or details');
        expect(await list({ q: 'role or details' })).toEqual(['Mira']);
        expect(await list({ q: 'ROLE OR' })).toEqual(['Mira']);
    });

    it('finds an agent\'s row by the words for what it did or tried', async () => {
        expect(await list({ q: 'comment on a task' })).toEqual(['AP-1']);
        expect(await list({ q: 'pause all agents' })).toEqual(['Reviewer']);
    });

    it('still finds a row by what is stored', async () => {
        expect(await list({ q: 'AP-2' })).toEqual(['AP-2']);
        expect(await list({ q: 'undo_window' })).toEqual(['AP-2']);
    });

    it('does not find an agent\'s row by words the screen never gives it', async () => {
        expect(eventWords.EVENTS['agent.action']).toBe('An agent made a change');
        expect(await list({ q: 'an agent made a change' })).toEqual([]);
    });

    it('takes the keys the reader\'s own language matched', async () => {
        expect(await list({ q: 'rôle', qEvents: 'member_update' })).toEqual(['Mira']);
        expect(await list({ q: 'commenter', qActions: 'task_comment' })).toEqual(['AP-1']);
        expect(await list({ q: 'time to undo', qReasons: 'undo_window_passed' })).toEqual(['AP-2']);
        expect(await list({ q: 'cannot open', qReasons: 'not_visible,undo_window_passed' })).toEqual(['AP-2', 'AP-3']);
    });

    it('ignores a sent key it does not hold, and never reads one as a pattern', async () => {
        expect(await list({ q: 'zzz', qEvents: 'nope,.*', qActions: '.*', qReasons: '.*,[a-z]+,not' })).toEqual([]);
        expect(await list({ q: 'zzz', qEvents: ['member_update'], qReasons: { $ne: '' } })).toEqual([]);
    });

    it('reads what was typed as text, not as a pattern', async () => {
        expect(await list({ q: '(.*' })).toEqual([]);
        expect(await list({ q: 'M.ra' })).toEqual([]);
        expect(await list({ q: 'Mira' })).toEqual(['Mira']);
    });

    it('asks the workspace\'s own rows only', async () => {
        await list({ q: 'role or details', qReasons: 'not_visible' });
        expect(mockDb.calls.length).toBeGreaterThan(0);
        expect(mockDb.calls.every((call) => call.companyId === CID)).toBe(true);
    });
});

describe('a row read back from its verified changes', () => {
    it('holds the typed words when its key or its reason is one they label', () => {
        const keys = eventWords.keysFor('role or details', { qReasons: 'not_visible' });
        expect(eventWords.rowHolds(ROWS.member, keys)).toBe(true);
        expect(eventWords.rowHolds(ROWS.hidden, keys)).toBe(true);
        expect(eventWords.rowHolds(ROWS.comment, keys)).toBe(false);
        expect(eventWords.rowHolds({}, keys)).toBe(false);
    });

    it('holds nothing when nothing was typed', () => {
        expect(eventWords.keysFor('  ', {})).toEqual({ events: [], actions: [], reasons: [] });
        expect(eventWords.rowHolds(ROWS.member, eventWords.keysFor('', {}))).toBe(false);
    });
});
