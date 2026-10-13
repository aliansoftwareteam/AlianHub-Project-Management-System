const { loginAs } = require('../../e2e/support/fixtures');

jest.setTimeout(60000);

describe('notification settings reads', () => {
    let member;
    let owner;

    beforeAll(async () => {
        member = await loginAs('member');
        owner = await loginAs('owner');
    });

    it('GET /api/v1/notifications/preferences answers the caller\'s own preferences', async () => {
        const res = await member.api.get('/api/v1/notifications/preferences');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(res.body.data.userId).toBe(String(member.uid));
        expect(res.body.data).toHaveProperty('aiAlertsEligible', false);
    });

    it('GET /api/v1/notifications/:id answers the caller\'s own document', async () => {
        const res = await member.api.get(`/api/v1/notifications/${member.uid}`);
        expect(res.status).toBe(200);
        expect(res.body.userId).toBe(String(member.uid));
    });

    it('GET /api/v1/notifications/not-an-id is refused with 400', async () => {
        const res = await member.api.get('/api/v1/notifications/not-an-id');
        expect(res.status).toBe(400);
        expect(res.body.userId).toBeUndefined();
    });

    it('a member cannot read the owner\'s settings document by id', async () => {
        await owner.api.get(`/api/v1/notifications/${owner.uid}`);
        const res = await member.api.get(`/api/v1/notifications/${owner.uid}`);
        expect(res.status).toBe(403);
        expect(res.body.userId).toBeUndefined();
    });
});
