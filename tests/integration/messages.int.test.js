const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });
const futureISO = () => new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

describe('messages/inbox — inbox', () => {
    it('returns the caller unread counts as the standard envelope', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.get('/api/v1/inbox/counts');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(typeof res.body.data.all).toBe('number');
        expect(typeof res.body.data.notifications).toBe('number');
    });

    it('lists a merged, paged feed for the caller', async () => {
        const member = await loginAs('member');
        const res = await member.api.get('/api/v1/inbox', { query: { tab: 'primary' } });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(Array.isArray(res.body.data.items)).toBe(true);
    });

    it('refuses an unauthenticated request', async () => {
        const res = await anonymous.get('/api/v1/inbox/counts', { headers: { companyid: state.companyId } });
        expect(res.status).toBe(401);
    });

    it('refuses mark-all-read on tabs that are already read', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v1/inbox/read-all', { tab: 'archive' });
        expect(res.body.status).toBe(false);
    });
});

describe('messages/inbox — general reminders', () => {
    it('lets a member create, list, edit and delete their own reminder', async () => {
        const member = await loginAs('member');
        const title = `reminder ${uniqueSuffix()}`;
        const created = await member.api.post('/api/v1/general-reminders', { title, remindAt: futureISO(), notifyBefore: -1 });
        expect(created.status).toBe(200);
        expect(created.body.status).toBe(true);
        const id = created.body.data._id;

        const listed = await member.api.get('/api/v1/general-reminders');
        expect(listed.body.data.some((r) => r._id === id)).toBe(true);

        const edited = await member.api.patch(`/api/v1/general-reminders/${id}`, { title: `${title} edited` });
        expect(edited.body.status).toBe(true);
        expect(edited.body.data.title).toBe(`${title} edited`);

        const removed = await member.api.delete(`/api/v1/general-reminders/${id}`);
        expect(removed.body.status).toBe(true);
        const after = await member.api.get('/api/v1/general-reminders');
        expect(after.body.data.some((r) => r._id === id)).toBe(false);
    });

    it('does not let another member touch a reminder they do not own', async () => {
        const member = await loginAs('member');
        const guest = await loginAs('guest');
        const created = await member.api.post('/api/v1/general-reminders', { title: `owned ${uniqueSuffix()}`, remindAt: futureISO(), notifyBefore: -1 });
        const id = created.body.data._id;

        await guest.api.patch(`/api/v1/general-reminders/${id}`, { title: 'hijacked' });
        await guest.api.delete(`/api/v1/general-reminders/${id}`);

        const stillMine = await member.api.get('/api/v1/general-reminders');
        const mine = stillMine.body.data.find((r) => r._id === id);
        expect(mine).toBeTruthy();
        expect(mine.title).not.toBe('hijacked');
        await member.api.delete(`/api/v1/general-reminders/${id}`);
    });

    it('refuses an unauthenticated request', async () => {
        const res = await anonymous.get('/api/v1/general-reminders', { headers: { companyid: state.companyId } });
        expect(res.status).toBe(401);
    });

    it('MSG-07 refuses a reminder assigned to a non-member id', async () => {
        const member = await loginAs('member');
        const res = await member.api.post('/api/v1/general-reminders', {
            title: `stranger ${uniqueSuffix()}`, remindAt: futureISO(), notifyBefore: -1, assignedTo: '000000000000000000000000',
        });
        expect(res.status).toBe(400);
        expect(res.body.status).toBe(false);
    });

    it('MSG-04 refuses an author managing a reminder raised for someone else, without a false success', async () => {
        const member = await loginAs('member');
        const admin = await loginAs('admin');
        const title = `for admin ${uniqueSuffix()}`;
        const created = await member.api.post('/api/v1/general-reminders', { title, remindAt: futureISO(), notifyBefore: -1, assignedTo: admin.uid });
        expect(created.body.status).toBe(true);
        const id = created.body.data._id;

        const edit = await member.api.patch(`/api/v1/general-reminders/${id}`, { title: 'changed' });
        expect([edit.status, edit.body.status]).toEqual([403, false]);
        const remove = await member.api.delete(`/api/v1/general-reminders/${id}`);
        expect([remove.status, remove.body.status]).toEqual([403, false]);

        const theirs = (await admin.api.get('/api/v1/general-reminders')).body.data.find((r) => r._id === id);
        expect(theirs.title).toBe(title);
        expect((await admin.api.delete(`/api/v1/general-reminders/${id}`)).body.status).toBe(true);
    });
});

describe('messages/inbox — task reminders (MSG-01)', () => {
    it('MSG-01 refuses an unauthenticated task-reminder write', async () => {
        const res = await anonymous.post('/api/v1/reminders',
            { reminderAt: futureISO(), reminderText: 'x' },
            { headers: { companyid: state.companyId, userid: state.users.member.userId } });
        expect(res.status).toBe(401);
    });

    it('MSG-01 does not let one user edit another user\'s task reminder', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const created = await owner.api.post('/api/v1/reminders', { reminderAt: futureISO(), reminderText: 'owner-owned' });
        expect(created.body.status).toBe(true);
        const id = created.body.data._id;

        const edit = await guest.api.patch(`/api/v1/reminders/${id}`, { reminderText: 'hijacked' });
        expect([edit.status, edit.body.status]).toEqual([403, false]);
        expect((await guest.api.delete(`/api/v1/reminders/${id}`)).body.status).toBe(false);
        expect((await guest.api.post(`/api/v1/reminders/${id}/run-now`, {})).body.status).toBe(false);

        const mine = (await owner.api.get('/api/v1/reminders')).body.data.find((r) => r._id === id);
        expect(mine.reminderText).toBe('owner-owned');
        expect(mine.fired).toBe(false);
        expect((await owner.api.delete(`/api/v1/reminders/${id}`)).body.status).toBe(true);
    });

    it('MSG-01 takes the user from the session, not the userid header', async () => {
        const member = await loginAs('member');
        const owner = await loginAs('owner');
        const created = await member.api.post('/api/v1/reminders',
            { reminderAt: futureISO(), reminderText: `spoof ${uniqueSuffix()}`, userId: owner.uid },
            { headers: { userid: owner.uid } });
        const id = created.body.data._id;
        expect(created.body.data.userId).toBe(member.uid);
        expect((await owner.api.get('/api/v1/reminders')).body.data.some((r) => r._id === id)).toBe(false);
        await member.api.delete(`/api/v1/reminders/${id}`);
    });

    it('MSG-01 keeps the company-wide run-due to owners and admins', async () => {
        const member = await loginAs('member');
        expect((await member.api.post('/api/v1/reminders/run-due', {})).status).toBe(403);
    });
});

describe('messages/inbox — legacy notification API (MSG-02, MSG-03)', () => {
    it('MSG-02 does not leak another user\'s notifications', async () => {
        const member = await loginAs('member');
        const guest = await loginAs('guest');
        const created = await member.api.post('/api/v1/general-reminders', { title: `fire ${uniqueSuffix()}`, remindAt: futureISO(), notifyBefore: -1 });
        const id = created.body.data._id;
        await member.api.post(`/api/v1/general-reminders/${id}/run-now`, {});

        const mine = await member.api.get('/api/v1/app-notification/notification', { query: { filter: 'unread' } });
        expect(mine.body.data.length).toBeGreaterThan(0);

        const leaked = await guest.api.get('/api/v1/app-notification/notification', { query: { userId: member.uid, filter: 'unread' } });
        expect(leaked.status).toBe(403);
        expect((leaked.body.data || []).length).toBe(0);

        const row = mine.body.data[0];
        expect((await guest.api.put('/api/v1/app-notification/mark-read', { key: 'notifications', id: row._id, userId: member.uid })).status).toBe(403);
        expect((await guest.api.put('/api/v1/app-notification/mark-all-read', { key: 'notifications', userId: member.uid })).status).toBe(403);
        await guest.api.put('/api/v1/app-notification/mark-all-read', { key: 'notifications' });

        const after = await member.api.get('/api/v1/app-notification/notification', { query: { filter: 'unread' } });
        expect(after.body.data.some((n) => n._id === row._id)).toBe(true);
        await member.api.delete(`/api/v1/general-reminders/${id}`);
    });

    it('MSG-03 answers a malformed mark-read id cleanly, not 500', async () => {
        const member = await loginAs('member');
        const res = await member.api.put('/api/v1/app-notification/mark-read', { key: 'mentions', id: 'not-an-id', userId: member.uid });
        expect(res.status).toBe(400);
        expect(res.body.status).toBe(false);
    });
});

describe('messages/inbox — unread comment counts (MSG-05)', () => {
    it('rejects a companyId body value that disagrees with the header', async () => {
        const member = await loginAs('member');
        const res = await member.api.post('/api/v1/updateunreadcommentscount', { companyId: '000000000000000000000001', key: 4, readAll: true });
        expect(res.body.status).toBe(false);
        expect(String(res.body.statusText)).toMatch(/mismatch/i);
    });

    it('MSG-05 answers unsetCommentCounts with the standard envelope', async () => {
        const member = await loginAs('member');
        const res = await member.api.post('/api/v1/unsetCommentCounts', { companyId: member.companyId, projectId: '000000000000000000000000' });
        expect(res.status).toBe(200);
        expect(res.body && res.body.status).toBe(true);
    });

    it('MSG-05 answers a missing project with 400', async () => {
        const member = await loginAs('member');
        const res = await member.api.post('/api/v1/unsetCommentCounts', { companyId: member.companyId });
        expect([res.status, res.body && res.body.status]).toEqual([400, false]);
    });
});

describe('messages/inbox — handleNotification (MSG-06)', () => {
    it('MSG-06 responds promptly to a partial body', async () => {
        const member = await loginAs('member');
        const responded = member.api.post('/api/v1/handleNotification', {});
        const timedOut = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
        const res = await Promise.race([responded, timedOut]);
        expect(res).not.toBeNull();
        expect([res.status, res.body.status]).toEqual([400, false]);
    }, 10000);
});

describe('messages/inbox — call meeting notes', () => {
    it('scopes notes to their participants', async () => {
        const member = await loginAs('member');
        const admin = await loginAs('admin');
        const guest = await loginAs('guest');
        const created = await member.api.post('/api/v2/calls/notes', {
            callId: `call-${uniqueSuffix()}`, title: 'notes', media: 'audio', durationSec: 3, participants: [admin.uid],
        });
        expect(created.body.status).toBe(true);
        const id = created.body.data._id;
        expect(created.body.data.participants).toEqual(expect.arrayContaining([member.uid, admin.uid]));

        expect((await admin.api.get('/api/v2/calls/notes')).body.data.some((n) => n._id === id)).toBe(true);

        const asGuest = await guest.api.get(`/api/v2/calls/notes/${id}`);
        expect(asGuest.body.status).toBe(false);
        const patchByGuest = await guest.api.patch(`/api/v2/calls/notes/${id}`, { title: 'hijack' });
        expect(patchByGuest.body.status).toBe(false);

        await member.api.patch(`/api/v2/calls/notes/${id}`, { status: 'discarded' });
    });

    it('validates the id and required fields', async () => {
        const member = await loginAs('member');
        expect((await member.api.get('/api/v2/calls/notes/xyz')).body.statusText).toMatch(/invalid id/i);
        expect((await member.api.post('/api/v2/calls/notes', {})).body.statusText).toMatch(/callId/i);
    });

    it('refuses an unauthenticated request', async () => {
        const res = await anonymous.get('/api/v2/calls/notes', { headers: { companyid: state.companyId } });
        expect(res.status).toBe(401);
    });
});

describe('messages/inbox — changelog and tours', () => {
    it('serves the changelog with the running version', async () => {
        const res = await anonymous.get('/api/v2/changelog');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(typeof res.body.data.currentVersion).toBe('string');
        expect(Array.isArray(res.body.data.releases)).toBe(true);
    });

    it('refuses tours without a session', async () => {
        const res = await anonymous.get('/api/v1/tours', { headers: { companyid: state.companyId } });
        expect(res.status).toBe(401);
    });

    it('returns tours for a signed-in member', async () => {
        const member = await loginAs('member');
        const res = await member.api.get('/api/v1/tours');
        expect([200, 404]).toContain(res.status); // 404 only when no tours are seeded
    });
});

describe('messages/inbox — main chats', () => {
    it('returns only the caller\'s own conversations and ignores a raw query', async () => {
        const member = await loginAs('member');
        const res = await member.api.post('/api/v1/main-chats/find', { findQuery: 'not-an-array' });
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('refuses an unauthenticated request', async () => {
        const res = await anonymous.get('/api/v1/main-chats', { headers: { companyid: state.companyId } });
        expect(res.status).toBe(401);
    });
});
