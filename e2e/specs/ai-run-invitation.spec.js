const { test, expect } = require('../support/test');
const { PASSWORD, emailFor, invitationPath, inviteMember, registerVerifiedAccount, sendInvitation, uniqueSuffix } = require('../support/fixtures');
const { firstScreenSettled, signInThroughForm, skipFirstRun, watchApiAnswers } = require('../support/pages');

test.describe.configure({ timeout: 60000 });

const signIn = async (page, email) => {
    await page.goto('/#/login');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('.auth__actions button[type="submit"]').click();
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
        const owner = await loginAs('owner');
        const email = `invited.${uniqueSuffix()}@e2e.alianhub.test`;
        await registerVerifiedAccount(state.baseURL, { firstName: 'Ina', lastName: 'Invited', email });
        const invitation = await sendInvitation({ ownerApi: owner.api, companyId: state.companyId, role: 'member', email });

        await signIn(page, email);
        await expect(page.getByRole('textbox', { name: 'Name your workspace' })).toBeVisible();
        await page.goto(invitationPath(state.companyId, invitation));
        await expect(page.getByRole('heading', { name: 'Accept your invitation' })).toBeVisible();

        const answers = watchApiAnswers(page);
        await page.getByRole('button', { name: 'Accept invitation' }).click();
        await expect(page).toHaveURL(new RegExp(`#/${state.companyId}/welcome/connect-ai`));
        await expect(page.getByRole('heading', { level: 1, name: 'Connect your AI' })).toBeVisible();
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
