jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { EventEmitter } = require('events');
const logger = require('../Config/loggerConfig');
const { requestLog, shouldLog } = require('../Config/requestLog');
const requestContext = require('../Config/requestContext');

const fakeReq = (over = {}) => ({ method: 'GET', path: '/api/v2/pages', originalUrl: '/api/v2/pages?x=1', headers: {}, ...over });
const fakeRes = () => {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    res.set = (k, v) => { res.headers[k] = v; };
    return res;
};

describe('requestLog', () => {
    it('assigns a request id, echoes it in X-Request-Id and exposes it to the context', () => {
        const req = fakeReq();
        const res = fakeRes();
        let seen = null;
        requestLog()(req, res, () => { seen = requestContext.requestId(); });
        expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
        expect(res.headers['X-Request-Id']).toBe(req.requestId);
        expect(seen).toBe(req.requestId);
    });

    it('keeps a well-formed incoming id and drops a malformed one', () => {
        const kept = fakeReq({ headers: { 'x-request-id': 'trace-abc.1' } });
        requestLog()(kept, fakeRes(), () => {});
        expect(kept.requestId).toBe('trace-abc.1');
        const dropped = fakeReq({ headers: { 'x-request-id': '<script>' } });
        requestLog()(dropped, fakeRes(), () => {});
        expect(dropped.requestId).not.toBe('<script>');
    });

    it('writes one line per request with id, method, url, status, duration, uid and aud', () => {
        const req = fakeReq({ uid: 'u1', aud: 'c1' });
        const res = fakeRes();
        requestLog()(req, res, () => {});
        res.statusCode = 201;
        res.emit('finish');
        expect(logger.info).toHaveBeenCalledTimes(1);
        const line = logger.info.mock.calls[0][0];
        expect(line).toMatch(new RegExp(`^${req.requestId} GET /api/v2/pages\\?x=1 201 \\d+\\.\\dms uid=u1 aud=c1$`));
    });

    it('skips health, socket and static asset requests', () => {
        expect(shouldLog(fakeReq({ path: '/health' }))).toBe(false);
        expect(shouldLog(fakeReq({ path: '/socket.io/' }))).toBe(false);
        expect(shouldLog(fakeReq({ path: '/js/app.abc.js' }))).toBe(false);
        expect(shouldLog(fakeReq({ path: '/api/v2/tasks' }))).toBe(true);
    });
});
