const { strictStatus, inferStatus, wantsStatusCodes } = require('../Config/strictStatus');

const fakeRes = () => { const r = { statusCode: 200, headers: {}, sent: null }; r.status = (c) => { r.statusCode = c; return r; }; r.set = (k, v) => { r.headers[k] = v; return r; }; r.send = (b) => { r.sent = b; return r; }; return r; };
const run = (req, body, presetStatus) => { const res = fakeRes(); if (presetStatus) res.statusCode = presetStatus; strictStatus()(req, res, () => {}); res.send(body); return res; };

describe('HTTP 200-on-failure, opt-in status codes', () => {
    it('leaves the app alone: no token, no Prefer header → 200 and the same body', () => {
        const res = run({ get: () => '' }, { status: false, statusText: 'Task not found.' });
        expect(res.statusCode).toBe(200);
        expect(res.headers['X-Status-Mapped']).toBeUndefined();
        expect(res.sent).toEqual({ status: false, statusText: 'Task not found.' });
    });
    it('gives an API token caller a real status, body unchanged, and says so in a header', () => {
        const res = run({ apiToken: { _id: 't' }, get: () => '' }, { status: false, statusText: 'Task not found.' });
        expect(res.statusCode).toBe(404);
        expect(res.headers['X-Status-Mapped']).toBe('1');
        expect(res.sent.status).toBe(false);
    });
    it('honours Prefer: status-codes and an explicit statusCode in the body', () => {
        expect(run({ get: (h) => (h === 'Prefer' ? 'status-codes' : '') }, { status: false, statusText: 'Agents cannot create agents.' }).statusCode).toBe(403);
        expect(run({ apiToken: {} , get: () => '' }, { status: false, statusText: 'x', statusCode: 422 }).statusCode).toBe(422);
    });
    it('never touches successes, arrays, or responses that already carry a status', () => {
        expect(run({ apiToken: {}, get: () => '' }, { status: true, data: [] }).statusCode).toBe(200);
        expect(run({ apiToken: {}, get: () => '' }, [{ status: false }]).statusCode).toBe(200);
        expect(run({ apiToken: {}, get: () => '' }, { status: false, statusText: 'nope' }, 500).statusCode).toBe(500);
    });
    it('maps the wording the codebase actually uses', () => {
        expect(inferStatus({ statusText: 'companyId is required.' })).toBe(400);
        expect(inferStatus({ statusText: 'This token is read-only.' })).toBe(403);
        expect(inferStatus({ statusText: 'Proposal is already approved.' })).toBe(409);
        expect(inferStatus({ statusText: 'Invalid token' })).toBe(401);
        expect(wantsStatusCodes({ get: () => 'return=minimal, status-codes' })).toBe(true);
        expect(wantsStatusCodes({ get: (h) => (h === 'Authorization' ? 'Bearer ahp_abc' : '') })).toBe(true);
        expect(wantsStatusCodes({ get: (h) => (h === 'Authorization' ? 'Bearer eyJhbGciOi' : '') })).toBe(false);
    });
});
