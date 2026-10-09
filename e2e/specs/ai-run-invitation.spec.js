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

/* Someone who registered and never made or joined a workspace, invited into the suite's workspace. */
const invitedPersonWithNoWorkspace = async ({ state, owner, label }) => {
    const email = `${label}.${uniqueSuffix()}@e2e.alianhub.test`;
    const userId = await registerVerifiedAccount(state.baseURL, { firstName: 'Nia', lastName: 'Newhere', email });
    const invitation = await sendInvitation({ ownerApi: owner.api, companyId: state.companyId, role: 'member', email });
    return { email, userId, invitation };
};

const fillSignIn = async (page, email) => {
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('.auth__actions button[type="submit"]').click();
};

const nameYourWorkspace = (page) => page.getByRole('heading', { name: 'Name your workspace' });

/* Signing in with no workspace ends on the last sign-up step, which asks for a workspace name. */
const signInWithNoWorkspace = async (page, email) => {
    await page.goto('/#/login');
    await fillSignIn(page, email);
    await expect(nameYourWorkspace(page)).toBeVisible();
};

const joinedWorkspaceOpens = async (page, state, answers) => {
    await expect(page).toHaveURL(new RegExp(`#/${state.companyId}/welcome/connect-ai`));
    await expect(page.getByRole('heading', { level: 1, name: 'Connect your AI' })).toBeVisible();
    await firstScreenSettled(page);
    expect(answers.answered).toBeGreaterThan(0);
    expect(answers.refused).toEqual([]);
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

/* Registered first, invited afterwards: the person is signed in and has no workspace, so every page used to send
 * them to name one, the invitation pages included. */
test.describe('joining by invitation with an account and no workspace', () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    test.beforeEach(async ({ page }) => skipFirstRun(page));

    test('the invitation page stays open while signed in, and accepting opens the joined workspace', async ({ page, state, loginAs }) => {
        const invited = await invitedPersonWithNoWorkspace({ state, owner: await loginAs('owner'), label: 'noworkspace' });

        await signInWithNoWorkspace(page, invited.email);
        await page.goto(invitationPath(state.companyId, invited.invitation));
        await expect(page.getByRole('heading', { name: 'Accept your invitation' })).toBeVisible();
        // Opening the address afresh takes the other way to the same push: the one the app makes while it starts.
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Accept your invitation' })).toBeVisible();
        await firstScreenSettled(page);
        await expect(nameYourWorkspace(page)).toHaveCount(0);
        await expect(page).toHaveURL(/#\/invitation\?/);

        const answers = watchApiAnswers(page);
        await page.getByRole('button', { name: 'Accept invitation' }).click();
        await joinedWorkspaceOpens(page, state, answers);
        // The welcome page hides the rail; past it, the person is on the joined workspace's Home.
        await page.getByRole('button', { name: 'Skip for now' }).click();
        await expect(page).toHaveURL(new RegExp(`#/${state.companyId}(\\?.*)?$`));
        await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    });

    test('signing in from the invitation page comes back to the invitation, not to naming a workspace', async ({ page, state, loginAs }) => {
        const invited = await invitedPersonWithNoWorkspace({ state, owner: await loginAs('owner'), label: 'signsin' });

        await page.goto(invitationPath(state.companyId, invited.invitation));
        await page.getByRole('link', { name: 'Sign in to accept' }).click();
        await fillSignIn(page, invited.email);
        await expect(page.getByRole('heading', { name: 'Accept your invitation' })).toBeVisible();

        const answers = watchApiAnswers(page);
        await page.getByRole('button', { name: 'Accept invitation' }).click();
        await joinedWorkspaceOpens(page, state, answers);
    });

    test('following the mailed link while signed in opens the joined workspace', async ({ page, state, loginAs }) => {
        const invited = await invitedPersonWithNoWorkspace({ state, owner: await loginAs('owner'), label: 'mailednoworkspace' });

        await signInWithNoWorkspace(page, invited.email);

        const answers = watchApiAnswers(page);
        await page.goto(mailedInvitationPath({ userId: invited.userId, companyId: state.companyId, invitation: invited.invitation }));
        await page.waitForURL(new RegExp(`#/${state.companyId}(/|\\?|$)`));
        await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
        await firstScreenSettled(page);

        expect(answers.answered).toBeGreaterThan(0);
        expect(answers.refused).toEqual([]);
        await expect(nameYourWorkspace(page)).toHaveCount(0);
    });
});
