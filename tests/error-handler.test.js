jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const logger = require('../Config/loggerConfig');
const { errorHandler, statusFor } = require('../Config/errorHandler');

const fakeRes = () => {
    const res = { code: 200, body: null, headersSent: false };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
};
const req = (over = {}) => ({ method: 'POST', originalUrl: '/api/v2/pages', requestId: 'rid-1', headers: {}, get: (h) => (over.headers || {})[h.toLowerCase()] || '', ...over });

describe('errorHandler', () => {
    it('answers the app with 200 + {status:false} and the request id, and logs the stack with the id', () => {
        const res = fakeRes();
        errorHandler()(new Error('boom'), req(), res, jest.fn());
        expect(res.code).toBe(200);
        expect(res.body).toEqual({ status: false, statusText: 'boom', requestId: 'rid-1' });
        expect(logger.error.mock.calls[0][0]).toMatch(/^rid-1 POST \/api\/v2\/pages failed: Error: boom/);
    });

    it('gives an API-token caller the real status code', () => {
        const res = fakeRes();
        const err = Object.assign(new Error('nope'), { statusCode: 403 });
        errorHandler()(err, req({ headers: { authorization: 'Bearer ahp_x' } }), res, jest.fn());
        expect(res.code).toBe(403);
        const plain = fakeRes();
        errorHandler()(new Error('boom'), req({ headers: { authorization: 'Bearer ahp_x' } }), plain, jest.fn());
        expect(plain.code).toBe(500);
    });

    it('defers to Express once headers are sent', () => {
        const next = jest.fn();
        const res = Object.assign(fakeRes(), { headersSent: true });
        errorHandler()(new Error('late'), req(), res, next);
        expect(next).toHaveBeenCalled();
        expect(res.body).toBeNull();
    });

    it('maps only 4xx/5xx statusCodes, everything else to 500', () => {
        expect(statusFor({ statusCode: 404 })).toBe(404);
        expect(statusFor({ statusCode: 200 })).toBe(500);
        expect(statusFor(null)).toBe(500);
    });
});
