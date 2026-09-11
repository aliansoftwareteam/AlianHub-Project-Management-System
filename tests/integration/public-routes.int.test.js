const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });
const anonymousWithCompany = createApiClient({ baseURL: state.baseURL, companyId: state.companyId });

describe('POST /api/v1/removeCache', () => {
    it('answers 401 without a session', async () => {
        const res = await anonymous.post('/api/v1/removeCache', { global: true });
        expect(res.status).toBe(401);
    });

    it('answers 401 with only a company id', async () => {
        const res = await anonymousWithCompany.post('/api/v1/removeCache', { cacheKey: 'UserProjectData:', isPrefix: true });
        expect(res.status).toBe(401);
    });

    it('clears the caller company keys for a member', async () => {
        const { api } = await loginAs('member');
        const res = await api.post('/api/v1/removeCache', { cacheKey: 'UserProjectData:', isPrefix: true });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
    });

    it('refuses a whole-cache flush even with a session', async () => {
        const { api } = await loginAs('owner');
        const res = await api.post('/api/v1/removeCache', { global: true });
        expect(res.status).toBe(403);
    });
});
