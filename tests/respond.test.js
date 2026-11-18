const { ok, fail, asyncHandler } = require('../Config/respond');
const { inferStatus } = require('../Config/strictStatus');

const fakeRes = () => { const res = { body: null }; res.send = (b) => { res.body = b; return res; }; return res; };

describe('respond', () => {
    it('ok merges the payload under status:true', () => {
        const res = fakeRes();
        ok(res, { data: [1], statusText: 'Done' });
        expect(res.body).toEqual({ status: true, data: [1], statusText: 'Done' });
    });

    it('fail keeps the 200 body convention and carries a statusCode strictStatus can map', () => {
        const res = fakeRes();
        fail(res, 'You do not have access to this company', 403);
        expect(res.body).toEqual({ status: false, statusText: 'You do not have access to this company', statusCode: 403 });
        expect(inferStatus(res.body)).toBe(403);
        fail(fakeRes(), 'x');
        expect(inferStatus({ status: false, statusText: 'x', statusCode: 400 })).toBe(400);
    });

    it('asyncHandler forwards a rejection to next', async () => {
        const next = jest.fn();
        const boom = new Error('boom');
        await asyncHandler(async () => { throw boom; })({}, {}, next);
        expect(next).toHaveBeenCalledWith(boom);
        const fine = jest.fn();
        await asyncHandler(async (req, res) => res.send('ok'))({}, fakeRes(), fine);
        expect(fine).not.toHaveBeenCalled();
    });
});
