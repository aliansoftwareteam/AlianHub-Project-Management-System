jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));

const { EventEmitter } = require('events');
const hostingMode = require('../Config/hostingMode');
const { recordAudit } = require('../Modules/Audit/recorder');
const { claimRestart, exitGracefully, restart, RESTART_LIMIT, ACTION } = require('../Modules/Instance/restart');

const COMPANY = '6f0000000000000000000c01';

const store = (restartsAt = []) => {
    const doc = { _id: 'instance', restartsAt: [...restartsAt] };
    const run = jest.fn(async (data, method) => {
        if (method === 'findOne') return doc;
        const pushed = data[1].$push.restartsAt;
        doc.restartsAt = [...doc.restartsAt, ...pushed.$each].slice(pushed.$slice);
        return doc;
    });
    return { doc, run };
};

const reply = () => {
    const res = new EventEmitter();
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; res.emit('finish'); return res; };
    return res;
};

const savedMode = process.env.HOSTING_MODE;
const inMode = (mode) => {
    hostingMode._resetForTests();
    if (mode) process.env.HOSTING_MODE = mode; else delete process.env.HOSTING_MODE;
};
afterAll(() => inMode(savedMode));
beforeEach(() => jest.clearAllMocks());

describe('the restart button', () => {
    it('does not exist on a self-hosted instance', async () => {
        inMode('');
        const { run } = store();
        const exit = jest.fn();
        const res = reply();
        await restart({ instanceAdmin: 'owner', body: {} }, res, { run, exit });
        expect(res.statusCode).toBe(404);
        expect(run).not.toHaveBeenCalled();
    });

    it('answers 202, audits, records the restart and exits once the answer is sent', async () => {
        inMode('managed');
        const { doc, run } = store();
        const exit = jest.fn();
        jest.useFakeTimers();
        try {
            const res = reply();
            await restart({ instanceAdmin: 'owner', uid: 'u1', body: { companyId: COMPANY }, headers: {} }, res, { run, exit });
            expect(res.statusCode).toBe(202);
            expect(res.body).toEqual({ status: true, statusText: 'Restarting.', data: { restarting: true } });
            expect(doc.restartsAt).toHaveLength(1);
            expect(recordAudit).toHaveBeenCalledWith(COMPANY, expect.objectContaining({ action: ACTION, actorId: 'u1', entityType: 'instance', meta: { via: 'owner' } }));
            jest.advanceTimersByTime(10000);
            expect(exit).toHaveBeenCalledWith(0);
        } finally {
            jest.useRealTimers();
        }
    });

    it(`refuses a ${RESTART_LIMIT + 1}th restart within the hour and says when it may run`, async () => {
        inMode('managed');
        const now = Date.now();
        const times = [now - 50 * 60000, now - 20 * 60000, now - 5 * 60000].map((t) => new Date(t));
        const { run } = store(times);
        const exit = jest.fn();
        const res = reply();
        await restart({ instanceAdmin: 'owner', body: {} }, res, { run, exit });
        expect(res.statusCode).toBe(429);
        expect(new Date(res.body.data.retryAt).getTime()).toBe(times[0].getTime() + 3600000);
        expect(exit).not.toHaveBeenCalled();
    });
});

describe('the restart limit', () => {
    it('counts only the last hour and keeps no more than the limit', async () => {
        const now = new Date('2026-10-28T12:00:00Z');
        const { doc, run } = store([new Date('2026-10-28T10:00:00Z'), new Date('2026-10-28T10:30:00Z'), new Date('2026-10-28T11:30:00Z')]);
        expect(await claimRestart({ run, now })).toEqual({ ok: true });
        expect(await claimRestart({ run, now })).toEqual({ ok: true });
        expect(doc.restartsAt).toHaveLength(RESTART_LIMIT);
        expect((await claimRestart({ run, now })).ok).toBe(false);
    });
});

describe('leaving the process', () => {
    it('exits as soon as the server has drained', () => {
        const exit = jest.fn();
        const httpServer = { close: jest.fn((done) => done()), closeIdleConnections: jest.fn() };
        exitGracefully({ exit, httpServer });
        expect(httpServer.closeIdleConnections).toHaveBeenCalled();
        expect(exit).toHaveBeenCalledWith(0);
    });

    it('stops waiting for slow requests after the drain window', () => {
        jest.useFakeTimers();
        try {
            const exit = jest.fn();
            exitGracefully({ exit, drainMs: 10000, httpServer: { close: jest.fn() } });
            jest.advanceTimersByTime(9999);
            expect(exit).not.toHaveBeenCalled();
            jest.advanceTimersByTime(1);
            expect(exit).toHaveBeenCalledWith(0);
        } finally {
            jest.useRealTimers();
        }
    });
});
