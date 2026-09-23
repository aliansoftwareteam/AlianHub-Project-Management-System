jest.mock('../Modules/notification-count/controller', () => ({
    updateUnReadCommentsCount: jest.fn(),
    unsetAllCounts: jest.fn(async () => ({ status: true, statusText: 'Counts cleared' })),
}));

const counts = require('../Modules/notification-count/controller');

const C = '6f0000000000000000000c01';
const OTHER = '6f0000000000000000000c02';
const P = '6f0000000000000000000701';

const routes = {};
const app = { post: (p, ...handlers) => { routes[p] = handlers[handlers.length - 1]; }, get: () => {} };
require('../Modules/notification-count/routes').init(app);

const res = () => {
    const r = { code: 200, body: null, sent: false };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; r.sent = true; return r; };
    r.json = r.send;
    return r;
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
const call = async (route, body, headers = { companyid: C }) => {
    const r = res();
    await routes[route]({ headers, body, uid: '6f0000000000000000000a03' }, r);
    await settle();
    await settle();
    return r;
};

beforeEach(() => jest.clearAllMocks());

describe('MSG-05 POST /api/v1/unsetCommentCounts', () => {
    it('answers a successful unset with 200 and the standard envelope', async () => {
        const r = await call('/api/v1/unsetCommentCounts', { companyId: C, projectId: P });
        expect(r.code).toBe(200);
        expect(r.body).toMatchObject({ status: true });
        expect(counts.unsetAllCounts).toHaveBeenCalledWith(C, P, '', { searchKey: undefined });
    });

    it('answers a missing project and search key with 400', async () => {
        const r = await call('/api/v1/unsetCommentCounts', { companyId: C });
        expect(r.code).toBe(400);
        expect(r.body).toMatchObject({ status: false });
        expect(counts.unsetAllCounts).not.toHaveBeenCalled();
    });

    it('refuses a body company that is not the session company', async () => {
        const r = await call('/api/v1/unsetCommentCounts', { companyId: OTHER, projectId: P });
        expect(r.code).toBe(403);
        expect(counts.unsetAllCounts).not.toHaveBeenCalled();
    });

    it('answers a failed unset with the error envelope', async () => {
        counts.unsetAllCounts.mockRejectedValueOnce({ status: false, statusText: 'boom' });
        const r = await call('/api/v1/unsetCommentCounts', { searchKey: `task_${P}_` });
        expect(r.code).toBe(500);
        expect(r.body).toMatchObject({ status: false });
    });
});
