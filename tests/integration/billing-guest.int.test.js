const { loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();
const GUEST_REFUSAL = 'Guests can only see the client view of this project.';

describe('billing money endpoints', () => {
    const hourly = (api) => api.get(`/api/v2/billing/hourly?projectId=${state.projects.shared._id}`);

    it('refuses the guest', async () => {
        const { api, roleType } = await loginAs('guest');
        expect(roleType).toBe(0);
        const res = await hourly(api);
        expect(res.body).toMatchObject({ status: false, statusText: GUEST_REFUSAL });
    });

    it('answers the owner', async () => {
        const { api } = await loginAs('owner');
        const res = await hourly(api);
        expect(res.status).toBe(200);
        expect(res.body.statusText).not.toBe(GUEST_REFUSAL);
        expect(res.body.status).toBe(true);
    });
});
