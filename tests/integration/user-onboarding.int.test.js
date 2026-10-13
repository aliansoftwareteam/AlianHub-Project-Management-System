const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();
const anon = createApiClient({ baseURL: state.baseURL });
const ROUTE = '/api/v2/users/onboarding';
const SELF = '/api/v1/userAndCompanyCheck';

const checklistOf = async (session) => (await session.api.post(SELF, {})).body.data.userData.homeChecklist || {};

describe('PUT /api/v2/users/onboarding stores the checklist on the caller only', () => {
    it('refuses an anonymous caller', async () => {
        const res = await anon.put(ROUTE, { dismissed: true });
        expect(res.status).toBe(401);
    });

    it('keeps a member\'s dismissal and progress across sign-ins', async () => {
        const member = await loginAs('guest');
        const saved = await member.api.put(ROUTE, { dismissed: true, openedProject: true });
        expect(saved.status).toBe(200);
        expect(saved.body.data).toMatchObject({ dismissed: true, openedProject: true });

        const again = await loginAs('guest');
        expect(await checklistOf(again)).toMatchObject({ dismissed: true, openedProject: true });
    });

    it('records an offered tour once', async () => {
        const member = await loginAs('guest');
        await member.api.put(ROUTE, { tourOffered: 'board' });
        const res = await member.api.put(ROUTE, { tourOffered: 'board' });
        expect(res.body.data.toursOffered.filter((t) => t === 'board')).toHaveLength(1);
    });

    it('ignores nobody: a body naming another user is refused and the other record is untouched', async () => {
        const owner = await loginAs('owner');
        const before = await checklistOf(owner);
        const member = await loginAs('member');

        const res = await member.api.put(ROUTE, { userId: owner.uid, dismissed: true });
        expect(res.status).toBe(400);
        expect(await checklistOf(owner)).toEqual(before);
    });

    it('writes to the caller even when the owner sends it', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const memberBefore = await checklistOf(member);

        const res = await owner.api.put(ROUTE, { completedTask: true });
        expect(res.status).toBe(200);
        expect(await checklistOf(owner)).toMatchObject({ completedTask: true });
        expect(await checklistOf(member)).toEqual(memberBefore);
    });

    it('refuses fields the checklist does not own', async () => {
        const member = await loginAs('member');
        const res = await member.api.put(ROUTE, { isProductOwner: true });
        expect(res.status).toBe(400);
        const self = (await member.api.post(SELF, {})).body.data.userData;
        expect(self.isProductOwner).toBeUndefined();
    });
});
