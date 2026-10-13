const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const refused = (res) => res.status >= 400 || (res.body && res.body.status === false);
const config = { source: 'tasks', dimension: 'status', metric: 'count' };

async function savedReport(api, name) {
    const res = await api.post('/api/v1/reports/custom', {
        name: name || `[int] report ${uniqueSuffix()}`,
        ...config,
        filters: { project: state.projects.shared._id },
    });
    return res.body && res.body.data;
}

describe('REP-01 legacy /api/v1/dashboard', () => {
    it('refuses a body-supplied method editing or reading another user\'s dashboard', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const priv = await owner.api.post('/api/v1/dashboards', { title: `[int] rep01 ${uniqueSuffix()}`, visibility: 'private' });
        const id = priv.body.data._id;

        const read = await guest.api.post('/api/v1/dashboard', { queryObject: [{ _id: id }], method: 'findOne' });
        const write = await guest.api.post('/api/v1/dashboard', { queryObject: [{ _id: id }, { $set: { title: 'pwned by REP-01' } }], method: 'updateOne' });
        const union = await guest.api.post('/api/v1/dashboard', { queryObject: [[{ $unionWith: { coll: 'saved_reports', pipeline: [] } }]], method: 'aggregate' });
        const after = await owner.api.get(`/api/v1/dashboards/${id}`);
        await owner.api.delete(`/api/v1/dashboards/${id}`);

        expect(refused(read)).toBe(true);
        expect(JSON.stringify(read.body)).not.toContain('rep01');
        expect(refused(write)).toBe(true);
        expect(refused(union)).toBe(true);
        expect(after.body.data.title).not.toBe('pwned by REP-01');
    });

    it('refuses reading another user\'s home dashboard by id', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const res = await guest.api.get(`/api/v1/dashboard/${owner.uid}`);
        expect(res.status).toBe(403);
    });

    it('lets a user add and remove a card on their own home dashboard', async () => {
        const member = await loginAs('member');
        const home = await member.api.get(`/api/v1/dashboard/${member.uid}`);
        expect(home.status).toBe(200);
        const templateId = home.body[0].templateId;
        const cardUid = String(Date.now());
        const card = { componentId: 'TotalTasksCard', cardId: '', uid: cardUid, config: { cardData: {}, filterData: [], position: { x: 0, y: 99, w: 3, h: 5 } } };

        const added = await member.api.post('/api/v1/dashboard', { op: 'addCard', templateId, card });
        expect(added.body).toMatchObject({ status: true });
        expect(added.body.data.cards.some((c) => c.uid === cardUid)).toBe(true);

        const removed = await member.api.post('/api/v1/dashboard', { op: 'removeCard', templateId, cardUid });
        expect(removed.body.status).toBe(true);
        expect(removed.body.data.cards.some((c) => c.uid === cardUid)).toBe(false);
    });
});

describe('REP-02 saved reports and schedules', () => {
    it('refuses a guest editing an admin\'s saved report', async () => {
        const admin = await loginAs('admin');
        const guest = await loginAs('guest');
        const rep = await savedReport(admin.api, `[int] rep02 ${uniqueSuffix()}`);

        const res = await guest.api.put(`/api/v1/reports/custom/${rep._id}`, { name: 'renamed by guest', ...config });
        const reload = await admin.api.get(`/api/v1/reports/custom/${rep._id}/run`);
        await admin.api.delete(`/api/v1/reports/custom/${rep._id}`);

        expect(refused(res)).toBe(true);
        expect(reload.body.data.report.name).not.toBe('renamed by guest');
    });

    it('refuses a guest rerouting an admin\'s schedule, while the admin can still change it', async () => {
        const admin = await loginAs('admin');
        const guest = await loginAs('guest');
        const rep = await savedReport(admin.api);
        const sched = await admin.api.post('/api/v1/reports/schedules', { savedReportId: rep._id, cadence: 'weekly', recipients: ['int-admin@example.invalid'], active: false });
        const id = sched.body.data._id;

        const hijack = await guest.api.put(`/api/v1/reports/schedules/${id}`, { recipients: ['int-guest@example.invalid'] });
        const guestList = await guest.api.get('/api/v1/reports/schedules');
        const own = await admin.api.put(`/api/v1/reports/schedules/${id}`, { recipients: ['int-team@example.invalid'] });

        await admin.api.delete(`/api/v1/reports/schedules/${id}`);
        await admin.api.delete(`/api/v1/reports/custom/${rep._id}`);

        expect(refused(hijack)).toBe(true);
        expect(guestList.body.data.some((s) => String(s._id) === String(id))).toBe(false);
        expect(own.body.status).toBe(true);
        expect(own.body.data.recipients).toEqual(['int-team@example.invalid']);
    });
});

describe('REP-06 revenue metric', () => {
    it('does not expose company revenue to a guest', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.post('/api/v1/reports/custom/run', { source: 'timelogs', dimension: 'person', metric: 'revenue', filters: { range: 'all' } });
        expect(res.status).toBe(403);
        expect(res.body.restricted).toBe(true);
    });

    it('still runs for an owner', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v1/reports/custom/run', { source: 'timelogs', dimension: 'person', metric: 'revenue', filters: { range: 'all' } });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
    });
});

describe('REP-07 report ids', () => {
    it('answers a malformed report id with 400', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.get('/api/v1/reports/custom/not-an-id/run');
        expect(res.status).toBe(400);
    });

    it('answers a delete of an unknown report id with 404', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.delete(`/api/v1/reports/custom/${'a'.repeat(24)}`);
        expect(res.status).toBe(404);
    });
});

describe('REP-04 webhook destinations', () => {
    it('refuses a webhook aimed at a private or link-local host', async () => {
        const owner = await loginAs('owner');
        const results = [];
        for (const url of ['http://127.0.0.1:9/int-sink', 'http://169.254.169.254/latest/meta-data', 'http://localhost:9/int']) {
            // eslint-disable-next-line no-await-in-loop
            const res = await owner.api.post('/api/v2/webhooks', { name: `[int] ssrf ${uniqueSuffix()}`, url, events: ['task.created'] });
            results.push(res);
            if (res.body && res.body.data && res.body.data._id) {
                // eslint-disable-next-line no-await-in-loop
                await owner.api.delete(`/api/v2/webhooks/${res.body.data._id}`);
            }
        }
        expect(results.every((r) => r.body.status === false)).toBe(true);
    });

    it('still creates a webhook for a public host', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v2/webhooks', { name: `[int] public ${uniqueSuffix()}`, url: 'https://example.com/int-hook', events: ['task.created'] });
        expect(res.body.status).toBe(true);
        await owner.api.delete(`/api/v2/webhooks/${res.body.data._id}`);
    });
});

describe('REP-03 and REP-05 integration connections', () => {
    it('refuses a guest connecting, toggling or disconnecting an integration', async () => {
        const guest = await loginAs('guest');
        const admin = await loginAs('admin');
        const app = await admin.api.post('/api/v1/integrations/connections', { type: 'custom_iframe', config: { name: `[int] embed ${uniqueSuffix()}`, url: 'https://example.com/app' } });
        expect(app.body.status).toBe(true);
        const id = app.body.data._id;

        const connect = await guest.api.post('/api/v1/integrations/connections', { type: 'zapier', config: { hook_url: 'https://hooks.zapier.com/hooks/catch/1/int/' } });
        const toggle = await guest.api.put(`/api/v1/integrations/connections/${id}`, { enabled: false });
        const drop = await guest.api.delete(`/api/v1/integrations/connections/${id}`);
        const list = await guest.api.get('/api/v1/integrations/connections');
        const still = list.body.data.find((c) => String(c._id) === String(id));

        await admin.api.delete(`/api/v1/integrations/connections/${id}`);
        if (connect.body && connect.body.data && connect.body.data._id) {
            await admin.api.delete(`/api/v1/integrations/connections/${connect.body.data._id}`);
        }

        expect(connect.status).toBe(403);
        expect(toggle.status).toBe(403);
        expect(drop.status).toBe(403);
        expect(still).toMatchObject({ enabled: true });
    });

    it('refuses invalid configuration with 400 and a field name', async () => {
        const owner = await loginAs('owner');
        const cases = [
            [{ type: 'zapier', config: { hook_url: 'not a url' } }, 'hook_url'],
            [{ type: 'microsoft_teams', config: {} }, 'webhook_url'],
            [{ type: 'github', config: { token: 'fake', repo: 'not/../valid repo' } }, 'token'],
        ];
        for (const [body, field] of cases) {
            // eslint-disable-next-line no-await-in-loop
            const res = await owner.api.post('/api/v1/integrations/connections', body);
            if (res.body && res.body.data && res.body.data._id) {
                // eslint-disable-next-line no-await-in-loop
                await owner.api.delete(`/api/v1/integrations/connections/${res.body.data._id}`);
            }
            expect(res.status).toBe(400);
            expect(res.body).toMatchObject({ status: false, field });
        }
    });

    it('connects a valid Zapier hook for an admin', async () => {
        const admin = await loginAs('admin');
        const res = await admin.api.post('/api/v1/integrations/connections', { type: 'zapier', config: { hook_url: 'https://hooks.zapier.com/hooks/catch/1/int/' } });
        expect(res.body.status).toBe(true);
        expect(res.body.data.secrets).toEqual({ hook_url: true });
        await admin.api.delete(`/api/v1/integrations/connections/${res.body.data._id}`);
    });
});
