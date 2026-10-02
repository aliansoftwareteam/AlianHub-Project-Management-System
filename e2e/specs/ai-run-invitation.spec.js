const { test, expect } = require('../support/test');
const { PASSWORD, createWorkspace, emailFor, invitationPath, inviteMember, mailedInvitationPath, registerVerifiedAccount, sendInvitation, uniqueSuffix } = require('../support/fixtures');
const { firstScreenSettled, signInThroughForm, skipFirstRun, watchApiAnswers } = require('../support/pages');

test.describe.configure({ timeout: 60000 });

/* Someone with an account and a workspace of their own, invited into the suite's workspace. */
const invitedPersonWithWorkspace = async ({ state, owner, label }) => {
    const email = `${label}.${uniqueSuffix()}@e2e.alianhub.test`;
    const userId = await registerVerifiedAccount(state.baseURL, { firstName: 'Ina', lastName: 'Invited', email });
    const ownCompanyId = await createWorkspace(state.baseURL, { email, name: `Own ${uniqueSuffix()}` });
    const invitation = await sendInvitation({ ownerApi: owner.api, companyId: state.companyId, role: 'member', email });
    return { email, userId, ownCompanyId, invitation };
};

/* The session of someone who joins a workspace was issued before they were in it. Each way in has to end with a
 * session that names the workspace, or the first screen's requests are refused once and retried. */
test.describe('joining by invitation', () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('an invited member\'s first screen after signing in has no refused request', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const suffix = uniqueSuffix();
        const email = emailFor('member', `first${suffix}`);
        await inviteMember({ baseURL: state.baseURL, ownerApi: owner.api, companyId: state.companyId, role: 'member', email, firstName: 'Fay', lastName: `First${suffix}`, navMode: null });

        const answers = watchApiAnswers(page);
        await signInThroughForm(page, { email, password: state.password, companyId: state.companyId });
        await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
        await firstScreenSettled(page);

        expect(answers.answered).toBeGreaterThan(0);
        expect(answers.refused).toEqual([]);
    });

    test('accepting on the invitation page while signed in opens the workspace with no refused request', async ({ page, state, loginAs }) => {
        const invited = await invitedPersonWithWorkspace({ state, owner: await loginAs('owner'), label: 'invited' });

        await signInThroughForm(page, { email: invited.email, password: PASSWORD, companyId: invited.ownCompanyId });
        await page.goto(invitationPath(state.companyId, invited.invitation));
        await expect(page.getByRole('heading', { name: 'Accept your invitation' })).toBeVisible();

        const answers = watchApiAnswers(page);
        await page.getByRole('button', { name: 'Accept invitation' }).click();
        await expect(page).toHaveURL(new RegExp(`#/${state.companyId}/welcome/connect-ai`));
        await expect(page.getByRole('heading', { level: 1, name: 'Connect your AI' })).toBeVisible();
        await firstScreenSettled(page);

        expect(answers.answered).toBeGreaterThan(0);
        expect(answers.refused).toEqual([]);
    });

    test('following the mailed link while signed in opens the workspace with no refused request', async ({ page, state, loginAs }) => {
        const invited = await invitedPersonWithWorkspace({ state, owner: await loginAs('owner'), label: 'mailed' });

        await signInThroughForm(page, { email: invited.email, password: PASSWORD, companyId: invited.ownCompanyId });
        await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

        const answers = watchApiAnswers(page);
        await page.goto(mailedInvitationPath({ userId: invited.userId, companyId: state.companyId, invitation: invited.invitation }));
        await page.waitForURL(new RegExp(`#/${state.companyId}(/|\\?|$)`));
        await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
        await firstScreenSettled(page);

        expect(answers.answered).toBeGreaterThan(0);
        expect(answers.refused).toEqual([]);
    });

    test('making an account on the invitation page, then signing in, opens the workspace with no refused request', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        const email = `newcomer.${uniqueSuffix()}@e2e.alianhub.test`;
        const invitation = await sendInvitation({ ownerApi: owner.api, companyId: state.companyId, role: 'member', email });

        const answers = watchApiAnswers(page);
        await page.goto(invitationPath(state.companyId, invitation));
        await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
        await page.locator('#inv-name').fill('Nell Newcomer');
        await page.locator('#inv-password').fill(PASSWORD);
        await page.getByRole('button', { name: 'Continue', exact: true }).click();

        // The page signs the new account out a moment after it sends it to the sign-in page.
        await expect(page).toHaveURL(/#\/login/);
        await page.waitForFunction("window.localStorage.getItem('selectedCompany') === null");

        await signInThroughForm(page, { email, password: PASSWORD, companyId: state.companyId });
        await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
        await firstScreenSettled(page);

        expect(answers.answered).toBeGreaterThan(0);
        expect(answers.refused).toEqual([]);
    });
});
