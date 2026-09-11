const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { createApiClient } = require('../../e2e/support/api');
const { emailFor, inviteMember, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const randomId = () => crypto.randomBytes(12).toString('hex');
const COMPANY_A = state.companyId;
const COMPANY_B = randomId();
const STORAGE_ROOT = path.resolve(__dirname, '..', '..', 'storage');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const SCREENSHOT = Buffer.from(PNG.split(',')[1], 'base64');
const CAPTURED_PROFILE_IMAGE = `${state.users.owner.userId}_${uniqueSuffix()}_capture.png`;

const uploadedProfileImages = [];

afterAll(async () => {
    fs.rmSync(path.join(STORAGE_ROOT, COMPANY_B), { recursive: true, force: true });
    fs.rmSync(path.join(STORAGE_ROOT, 'USER_PROFILES', CAPTURED_PROFILE_IMAGE), { force: true });
    for (const { api, filePath } of uploadedProfileImages) {
        await api.delete('/api/v1/storage/removeFile/USER_PROFILES', { query: { filepath: filePath, thubmkey: 'userProfile' } });
    }
});

async function readResponse(res) {
    const text = await res.text();
    let body = text;
    try {
        body = JSON.parse(text);
    } catch {}
    return { status: res.status, body };
}

async function uploadFile(accessToken, fields) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append('file', new Blob([`f35d ${uniqueSuffix()}`]), 'note.txt');
    return readResponse(await fetch(new URL('/api/v1/storage/uploadFile', state.baseURL), {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}` },
        body: form,
    }));
}

const trackerPath = () => `Project/${state.projects.shared._id}/Sprint/${randomId()}/TimeLog/${randomId()}/${Date.now()}.png`;

/* Same URL, headers, fields and field order as TrackerController.ScreenShotCapture in time-tracker-app. */
async function captureScreenshot(accessToken, companyHeader, { companyId, filePath }) {
    const form = new FormData();
    form.append('strokes', '[]');
    form.append('companyId', companyId);
    form.append('timeSheetId', randomId());
    form.append('imageName', path.basename(filePath));
    form.append('prevscreenShot', String(Date.now()));
    form.append('memoName', 'qa capture');
    form.append('screenShotTime', String(Date.now()));
    form.append('key', '0');
    form.append('type', 'timesheets');
    form.append('projectId', state.projects.shared._id);
    form.append('path', filePath);
    form.append('file', new Blob([SCREENSHOT], { type: 'image/png' }), 'screenshot.png');
    form.append('actionTime', String(Math.floor(Date.now() / 1000)));
    return readResponse(await fetch(new URL('/api/v4/timeTracker/capture', state.baseURL), {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, companyId: companyHeader },
        body: form,
    }));
}

async function freshMember() {
    const owner = await loginAs('owner');
    const suffix = uniqueSuffix();
    const email = emailFor('member', `storage${suffix}`);
    const member = await inviteMember({ baseURL: state.baseURL, ownerApi: owner.api, companyId: COMPANY_A, role: 'member', email, firstName: 'QA', lastName: `Storage ${suffix}` });
    const session = await login(state.baseURL, email);
    return { ...member, owner, accessToken: session.accessToken };
}

const uploadProfileImage = (api, filePath) => api.post('/api/v1/storage/uploadFileBase64', { companyId: 'USER_PROFILES', path: filePath, key: 'userProfile', base64String: PNG, isUserProfile: true });

describe('POST /api/v1/storage/uploadFile checks access before it writes', () => {
    it('refuses a member uploading into another company and writes nothing there', async () => {
        const member = await loginAs('member');
        const res = await uploadFile(member.accessToken, { companyId: COMPANY_B, path: `qa-f35d/${uniqueSuffix()}.txt` });
        expect(res.status).toBe(403);
        expect(fs.existsSync(path.join(STORAGE_ROOT, COMPANY_B))).toBe(false);
    });

    it('refuses a removed member whose token still names the company, and leaves no file', async () => {
        const member = await freshMember();
        const removed = await member.owner.api.put('/api/v1/members', { id: member.companyUserId, data: { isDelete: true } });
        expect(removed.body.status).toBe(true);

        const filePath = `qa-f35d/${uniqueSuffix()}.txt`;
        const res = await uploadFile(member.accessToken, { companyId: COMPANY_A, path: filePath });
        expect(res.status).toBe(403);
        expect(fs.existsSync(path.join(STORAGE_ROOT, COMPANY_A, filePath))).toBe(false);
    });

    it('stores a member upload into their own company', async () => {
        const member = await loginAs('member');
        const filePath = `qa-f35d/${uniqueSuffix()}.txt`;
        const res = await uploadFile(member.accessToken, { companyId: COMPANY_A, path: filePath });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: true, statusText: filePath });

        const signed = await member.api.get(`/api/v1/generateSignedUrl/${COMPANY_A}`, { query: { filepath: filePath, domainUrl: state.baseURL } });
        expect((await fetch(signed.body.url)).status).toBe(200);
    });
});

describe('USER_PROFILES images are bound to their owner', () => {
    it('lets a member neither overwrite nor delete the owner\'s profile image', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const filePath = `${owner.uid}_${uniqueSuffix()}_avatar.png`;
        expect((await uploadProfileImage(owner.api, filePath)).status).toBe(200);
        uploadedProfileImages.push({ api: owner.api, filePath });

        expect((await uploadProfileImage(member.api, filePath)).status).toBe(403);
        expect((await uploadFile(member.accessToken, { companyId: 'USER_PROFILES', path: filePath })).status).toBe(403);
        expect((await member.api.delete('/api/v1/storage/removeFile/USER_PROFILES', { query: { filepath: filePath, thubmkey: 'userProfile' } })).status).toBe(403);

        const signed = await owner.api.post('/api/v1/getUserProfile', { path: filePath });
        expect((await fetch(signed.body.statusText)).status).toBe(200);
    });

    it('refuses a profile image name that does not start with the caller\'s id', async () => {
        const member = await loginAs('member');
        expect((await uploadProfileImage(member.api, `${Date.now()}_legacy_avatar.png`)).status).toBe(403);
    });

    it('lets a user replace their own profile image the way My Settings does', async () => {
        const member = await loginAs('member');
        const first = `${member.uid}_${uniqueSuffix()}_avatar.png`;
        const second = `${member.uid}_${uniqueSuffix()}_avatar.png`;
        expect((await uploadProfileImage(member.api, first)).body).toMatchObject({ status: true, statusText: first });

        const removed = await member.api.delete('/api/v1/storage/removeFile/USER_PROFILES', { query: { filepath: first, thubmkey: 'userProfile' } });
        expect(removed.status).toBe(200);
        expect((await uploadProfileImage(member.api, second)).status).toBe(200);
        uploadedProfileImages.push({ api: member.api, filePath: second });
    });

    it('refuses deleting a legacy image another user holds under different letter case', async () => {
        const victim = await freshMember();
        const attacker = await freshMember();
        const apiFor = (member) => createApiClient({ baseURL: state.baseURL, accessToken: member.accessToken, companyId: COMPANY_A });
        const pointAt = (member, name) => apiFor(member).put('/api/v1/user', { userId: member.userId, updateObject: { $set: { Employee_profileImage: name } } });
        const legacyName = `${Date.now()}_${uniqueSuffix()}_photo.png`;
        const shouted = legacyName.toUpperCase();

        expect((await pointAt(victim, legacyName)).body.status).toBe(true);
        expect((await pointAt(attacker, shouted)).body.status).toBe(true);

        const res = await apiFor(attacker).delete('/api/v1/storage/removeFile/USER_PROFILES', { query: { filepath: shouted, thubmkey: 'userProfile' } });
        expect(res.status).toBe(403);
    });
});

describe('POST /api/v4/timeTracker/capture checks access before it writes', () => {
    it('refuses a capture whose body names another company than the header, and writes nothing there', async () => {
        const member = await loginAs('member');
        const res = await captureScreenshot(member.accessToken, COMPANY_A, { companyId: COMPANY_B, filePath: trackerPath() });
        expect(res.status).toBe(403);
        expect(fs.existsSync(path.join(STORAGE_ROOT, COMPANY_B))).toBe(false);
    });

    it('refuses a capture aimed at another user\'s profile image', async () => {
        const member = await loginAs('member');
        const res = await captureScreenshot(member.accessToken, COMPANY_A, { companyId: 'USER_PROFILES', filePath: CAPTURED_PROFILE_IMAGE });
        expect(res.status).toBe(403);
        expect(fs.existsSync(path.join(STORAGE_ROOT, 'USER_PROFILES', CAPTURED_PROFILE_IMAGE))).toBe(false);
    });

    it('refuses a removed member whose token still names the company, and leaves no file', async () => {
        const member = await freshMember();
        const removed = await member.owner.api.put('/api/v1/members', { id: member.companyUserId, data: { isDelete: true } });
        expect(removed.body.status).toBe(true);

        const filePath = trackerPath();
        const res = await captureScreenshot(member.accessToken, COMPANY_A, { companyId: COMPANY_A, filePath });
        expect(res.status).toBe(403);
        expect(fs.existsSync(path.join(STORAGE_ROOT, COMPANY_A, filePath))).toBe(false);
    });

    it('stores the time tracker\'s screenshot for a member of the company', async () => {
        const member = await loginAs('member');
        const filePath = trackerPath();
        const res = await captureScreenshot(member.accessToken, COMPANY_A, { companyId: COMPANY_A, filePath });
        expect(res.status).toBe(200);
        expect(fs.readFileSync(path.join(STORAGE_ROOT, COMPANY_A, filePath))).toEqual(SCREENSHOT);
    });
});
