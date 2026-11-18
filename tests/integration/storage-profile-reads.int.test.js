const crypto = require('node:crypto');
const { createApiClient } = require('../../e2e/support/api');
const { emailFor, inviteMember, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const COMPANY_A = state.companyId;
const OTHER_COMPANY = crypto.randomBytes(12).toString('hex');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const uploadedProfileImages = [];

afterAll(async () => {
    for (const { api, filePath } of uploadedProfileImages) {
        await api.delete('/api/v1/storage/removeFile/USER_PROFILES', { query: { filepath: filePath, thubmkey: 'userProfile' } });
    }
});

const uploadProfileImage = (api, filePath) => api.post('/api/v1/storage/uploadFileBase64', { companyId: 'USER_PROFILES', path: filePath, key: 'userProfile', base64String: PNG, isUserProfile: true });

/* The two ways the app asks for a profile image: the tracker posts the path, the web app
 * asks for a signed URL and then fetches it. */
const askForProfile = (api, path) => api.post('/api/v1/getUserProfile', { path });
const signProfile = (api, filepath) => api.get('/api/v1/generateSignedUrl/USER_PROFILES', { query: { filepath, domainUrl: state.baseURL.replace(/\/$/, '') } });

const apiFor = (accessToken) => createApiClient({ baseURL: state.baseURL, accessToken, companyId: COMPANY_A });

async function freshMember(role = 'member') {
    const owner = await loginAs('owner');
    const suffix = uniqueSuffix();
    const email = emailFor(role, `reads${suffix}`);
    const member = await inviteMember({ baseURL: state.baseURL, ownerApi: owner.api, companyId: COMPANY_A, role, email, firstName: 'QA', lastName: `Reads ${suffix}` });
    const session = await login(state.baseURL, email);
    return { ...member, owner, accessToken: session.accessToken, api: apiFor(session.accessToken) };
}

let ownerSession;
let avatar;

beforeAll(async () => {
    ownerSession = await loginAs('owner');
    avatar = `${ownerSession.uid}_${uniqueSuffix()}_avatar.png`;
    const uploaded = await uploadProfileImage(ownerSession.api, avatar);
    expect(uploaded.status).toBe(200);
    uploadedProfileImages.push({ api: ownerSession.api, filePath: avatar });
});

describe('an avatar under USER_PROFILES is readable by the owner and their colleagues', () => {
    it('lets the owner read their own image and download it', async () => {
        const signed = await signProfile(ownerSession.api, avatar);
        expect(signed.status).toBe(200);
        expect(await fetch(signed.body.url).then((res) => res.status)).toBe(200);
        expect((await askForProfile(ownerSession.api, avatar)).body.status).toBe(true);
    });

    it.each(['admin', 'member', 'guest'])('lets a %s of the same company read it', async (role) => {
        const colleague = await loginAs(role);
        expect((await signProfile(colleague.api, avatar)).status).toBe(200);
        expect((await askForProfile(colleague.api, avatar)).body.status).toBe(true);
    });

    it('lets a colleague read its thumbnail, the way the avatar components ask for it', async () => {
        const colleague = await loginAs('member');
        const thumbnail = avatar.replace(/\.png$/, '-35x35.png');
        expect((await signProfile(colleague.api, thumbnail)).status).toBe(200);
    });
});

describe('an avatar is not readable outside the companies its owner belongs to', () => {
    it('refuses a signed-in user with no live seat in any of them', async () => {
        const member = await freshMember();
        const removed = await member.owner.api.put('/api/v1/members', { id: member.companyUserId, data: { isDelete: true } });
        expect(removed.body.status).toBe(true);

        expect((await signProfile(member.api, avatar)).status).toBe(403);
        expect((await askForProfile(member.api, avatar)).status).toBe(403);
    });

    it('refuses a name no user holds', async () => {
        const colleague = await loginAs('member');
        expect((await signProfile(colleague.api, `${Date.now()}_nobody.png`)).status).toBe(403);
        expect((await askForProfile(colleague.api, `${Date.now()}_nobody.png`)).status).toBe(403);
    });

    it('refuses an anonymous caller', async () => {
        const anon = createApiClient({ baseURL: state.baseURL });
        expect((await signProfile(anon, avatar)).status).toBe(401);
    });
});

describe('the credit notes under USER_PROFILES are billing documents', () => {
    const creditNote = (companyId) => `InvoiceAndCreditNotes/CreditNotes/${companyId}/${uniqueSuffix()}.pdf`;

    it.each(['member', 'guest'])('refuses a %s of the company the credit note belongs to', async (role) => {
        const caller = await loginAs(role);
        const path = creditNote(COMPANY_A);
        expect((await signProfile(caller.api, path)).status).toBe(403);
        expect((await askForProfile(caller.api, path)).status).toBe(403);
    });

    it.each(['owner', 'admin'])('lets the %s of that company reach it', async (role) => {
        const caller = await loginAs(role);
        const path = creditNote(COMPANY_A);
        expect((await signProfile(caller.api, path)).status).toBe(200);
        expect((await askForProfile(caller.api, path)).body.status).toBe(true);
    });

    it('refuses an owner asking for another company\'s credit note', async () => {
        const owner = await loginAs('owner');
        expect((await signProfile(owner.api, creditNote(OTHER_COMPANY))).status).toBe(403);
        expect((await askForProfile(owner.api, creditNote(OTHER_COMPANY))).status).toBe(403);
    });
});

describe('PUT /api/v1/user binds a profile image to its owner', () => {
    const pointAt = (member, value) => member.api.put('/api/v1/user', { userId: member.userId, updateObject: { $set: { Employee_profileImage: value } }, newObj: { returnDocument: 'after' } });

    it('refuses pointing a profile at another user\'s image, and at a name nobody uploaded', async () => {
        const member = await freshMember();
        expect((await pointAt(member, avatar)).status).toBe(403);
        expect((await pointAt(member, `${Date.now()}_legacy.png`)).status).toBe(403);
    });

    it('accepts the caller\'s own upload', async () => {
        const member = await freshMember();
        const own = `${member.userId}_${uniqueSuffix()}_avatar.png`;
        expect((await uploadProfileImage(member.api, own)).status).toBe(200);
        uploadedProfileImages.push({ api: member.api, filePath: own });

        const saved = await pointAt(member, own);
        expect(saved.status).toBe(200);
        expect(saved.body.data.Employee_profileImage).toBe(own);
    });

    it('leaves a member unable to borrow an image by pointing their record at it', async () => {
        const member = await freshMember();
        expect((await pointAt(member, avatar)).status).toBe(403);
        expect((await signProfile(member.api, avatar)).status).toBe(200);
    });
});
