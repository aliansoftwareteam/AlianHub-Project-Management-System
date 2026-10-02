const { createApiClient } = require('./api');
const { emailFor, inviteMember, login, uniqueSuffix } = require('./fixtures');

/* A member made for one test, with a session of their own to call the API as them. */
async function newMember({ state, loginAs, firstName = 'Pat' }) {
    const owner = await loginAs('owner');
    const suffix = uniqueSuffix();
    const email = emailFor('member', suffix);
    const member = await inviteMember({ baseURL: state.baseURL, ownerApi: owner.api, companyId: state.companyId, role: 'member', email, firstName, lastName: `Two${suffix}` });
    const session = await login(state.baseURL, email);
    const api = createApiClient({ baseURL: state.baseURL, accessToken: session.accessToken, companyId: state.companyId });
    return { owner, member, email, api, suffix };
}

module.exports = { newMember };
