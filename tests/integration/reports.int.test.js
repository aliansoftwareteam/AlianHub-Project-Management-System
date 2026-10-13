const { createApiClient } = require('../../e2e/support/api');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });
const refused = (res) => res.status >= 400 || (res.body && res.body.status === false);

// A saved report scoped to the shared project — the smallest thing the report
// engine, schedules and the milestone/agile reads can all run against.
async function savedReport(api, name) {
    const res = await api.post('/api/v1/reports/custom', {
        name: name || `[int] report ${uniqueSuffix()}`,
        source: 'tasks', dimension: 'status', metric: 'count',
        filters: { project: state.projects.shared._id },
    });
    return res.body && res.body.data;
}

describe('reports — user dashboards', () => {
    it('lets a member create, read, rename and delete their own dashboard', async () => {
        const member = await loginAs('member');
        const created = await member.api.post('/api/v1/dashboards', { title: `[int] mine ${uniqueSuffix()}`, visibility: 'private' });
        expect(created.status).toBe(200);
        const id = created.body.data._id;

        const got = await member.api.get(`/api/v1/dashboards/${id}`);
        expect(got.body.data.isMine).toBe(true);

        const renamed = await member.api.put(`/api/v1/dashboards/${id}`, { title: '[int] mine renamed' });
        expect(renamed.body.status).toBe(true);

        const removed = await member.api.delete(`/api/v1/dashboards/${id}`);
        expect(removed.body.status).toBe(true);
    });

    it('refuses another user reading a private dashboard through the shared route', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const priv = await owner.api.post('/api/v1/dashboards', { title: `[int] owner private ${uniqueSuffix()}`, visibility: 'private' });
        const id = priv.body.data._id;

        const res = await guest.api.get(`/api/v1/dashboards/${id}`);
        expect(res.status).toBe(403);

        await owner.api.delete(`/api/v1/dashboards/${id}`);
    });

    it('scopes the tasks-by-status card by role (self for a member, company for an admin)', async () => {
        const admin = await loginAs('admin');
        const member = await loginAs('member');
        expect((await admin.api.post('/api/v1/dashboard/tasks-by-status', {})).body.data.scope).toBe('company');
        expect((await member.api.post('/api/v1/dashboard/tasks-by-status', {})).body.data.scope).toBe('self');
    });

    it('restricts the company milestone-summary card to owner/admin', async () => {
        const admin = await loginAs('admin');
        const guest = await loginAs('guest');
        expect((await admin.api.post('/api/v1/dashboard/milestone-summary', {})).body.data.restricted).toBeFalsy();
        expect((await guest.api.post('/api/v1/dashboard/milestone-summary', {})).body.data.restricted).toBe(true);
    });

    // REP-01 — legacy POST /api/v1/dashboard runs an arbitrary Mongo method with a
    // body-supplied query, letting any role read/overwrite another user's dashboard.
    it('REP-01 refuses the legacy /dashboard endpoint editing another user\'s dashboard', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const priv = await owner.api.post('/api/v1/dashboards', { title: `[int] rep01 ${uniqueSuffix()}`, visibility: 'private' });
        const id = priv.body.data._id;

        const read = await guest.api.post('/api/v1/dashboard', { queryObject: [{ _id: id }], method: 'findOne' });
        const write = await guest.api.post('/api/v1/dashboard', { queryObject: [{ _id: id }, { $set: { title: 'pwned by REP-01' } }], method: 'updateOne' });
        const after = await owner.api.get(`/api/v1/dashboards/${id}`);
        await owner.api.delete(`/api/v1/dashboards/${id}`);

        expect(refused(read)).toBe(true);
        expect(refused(write)).toBe(true);
        expect(after.body.data.title).not.toBe('pwned by REP-01');
    });
});

describe('reports — custom reports', () => {
    it('lets an owner build a live preview, save, reload and delete a report', async () => {
        const owner = await loginAs('owner');
        const preview = await owner.api.post('/api/v1/reports/custom/run', { source: 'tasks', dimension: 'status', metric: 'count', filters: { project: state.projects.shared._id } });
        expect(preview.status).toBe(200);
        expect(Array.isArray(preview.body.data.result)).toBe(true);

        const saved = await savedReport(owner.api);
        const reload = await owner.api.get(`/api/v1/reports/custom/${saved._id}/run`);
        expect(reload.body.data.report._id).toBe(saved._id);

        const removed = await owner.api.delete(`/api/v1/reports/custom/${saved._id}`);
        expect(removed.body.status).toBe(true);
    });

    it('rejects a report config with a dimension outside the allow-list', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v1/reports/custom', { name: '[int] bad', source: 'tasks', dimension: '$where', metric: 'count' });
        expect(res.status).toBe(400);
    });

    it('creates a report from a built-in template', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v1/reports/custom/from-template', { templateKey: 'tasks_by_status', name: `[int] tpl ${uniqueSuffix()}` });
        expect(res.status).toBe(201);
        await owner.api.delete(`/api/v1/reports/custom/${res.body.data._id}`);
    });

    // REP-02 — saved reports carry a createdBy but no route scopes to it, so a
    // guest can rewrite another user's saved report.
    it('REP-02 refuses a guest editing an admin\'s saved report', async () => {
        const admin = await loginAs('admin');
        const guest = await loginAs('guest');
        const rep = await savedReport(admin.api, `[int] rep02 ${uniqueSuffix()}`);

        const res = await guest.api.put(`/api/v1/reports/custom/${rep._id}`, { name: 'renamed by guest', source: 'tasks', dimension: 'status', metric: 'count' });
        await admin.api.delete(`/api/v1/reports/custom/${rep._id}`);
        expect(refused(res)).toBe(true);
    });

    // REP-06 — the revenue metric exposes company billing figures to every role,
    // while the dedicated milestone financial card is owner/admin only.
    it('REP-06 does not expose company revenue to a guest through the report engine', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.post('/api/v1/reports/custom/run', { source: 'timelogs', dimension: 'person', metric: 'revenue', filters: { range: 'all' } });
        // Correct behaviour: financial data is gated the same way milestone-summary is.
        expect(refused(res) || (res.body && res.body.data && res.body.data.restricted === true)).toBe(true);
    });

    // REP-07 — a malformed id 500s with a raw driver message; an unknown id "deletes"
    // successfully.
    it('REP-07 answers a malformed report id with 400, not 500', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.get('/api/v1/reports/custom/not-an-id/run');
        expect(res.status).toBe(400);
    });

    it('REP-07 answers a delete of an unknown report id with 404', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.delete(`/api/v1/reports/custom/${'a'.repeat(24)}`);
        expect(res.status).toBe(404);
    });
});

describe('reports — agile reports', () => {
    it('returns velocity for a project as a member', async () => {
        const member = await loginAs('member');
        const res = await member.api.get('/api/v1/agile/velocity', { query: { projectId: state.projects.shared._id } });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
    });

    it('validates the projectId', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.get('/api/v1/agile/velocity', { query: { projectId: 'nope' } });
        expect(res.body.status).toBe(false);
    });

    it('refuses an anonymous caller', async () => {
        const res = await anonymous.get('/api/v1/agile/velocity', { query: { projectId: state.projects.shared._id } });
        expect(res.status).toBe(401);
    });
});

describe('reports — scheduled reports', () => {
    it('creates an inactive schedule, lists it and deletes it (no mail sent)', async () => {
        const owner = await loginAs('owner');
        const rep = await savedReport(owner.api);
        const sched = await owner.api.post('/api/v1/reports/schedules', {
            savedReportId: rep._id, cadence: 'weekly', recipients: ['int-report@example.invalid'], active: false,
        });
        expect(sched.status).toBe(201);
        expect(sched.body.data.active).toBe(false);

        const list = await owner.api.get('/api/v1/reports/schedules');
        expect(list.body.data.some((s) => String(s._id) === String(sched.body.data._id))).toBe(true);

        // run-due honours the active flag: an inactive schedule is never delivered.
        const due = await owner.api.post('/api/v1/reports/schedules/run-due', {});
        expect(due.body.data.delivered).toBe(0);

        // run-now on an inactive schedule: mail points at a closed port, so delivery
        // fails gracefully and the endpoint still answers 200.
        const runNow = await owner.api.post(`/api/v1/reports/schedules/${sched.body.data._id}/run-now`, {});
        expect(runNow.status).toBe(200);
        expect(runNow.body.status).toBe(true);

        await owner.api.delete(`/api/v1/reports/schedules/${sched.body.data._id}`);
        await owner.api.delete(`/api/v1/reports/custom/${rep._id}`);
    });

    it('rejects a schedule with no valid recipient', async () => {
        const owner = await loginAs('owner');
        const rep = await savedReport(owner.api);
        const res = await owner.api.post('/api/v1/reports/schedules', { savedReportId: rep._id, recipients: ['not-an-email'], active: false });
        expect(res.status).toBe(400);
        await owner.api.delete(`/api/v1/reports/custom/${rep._id}`);
    });
});

describe('reports — webhooks', () => {
    it('creates a webhook, returns the secret once, then masks it on list', async () => {
        const owner = await loginAs('owner');
        const created = await owner.api.post('/api/v2/webhooks', { name: `[int] hook ${uniqueSuffix()}`, url: 'https://example.com/int-hook', events: ['task.created'] });
        expect(created.body.status).toBe(true);
        expect(typeof created.body.data.secret).toBe('string');

        const list = await owner.api.get('/api/v2/webhooks');
        const mine = list.body.data.find((h) => String(h._id) === String(created.body.data._id));
        expect(mine.secret).toBeUndefined();

        await owner.api.delete(`/api/v2/webhooks/${created.body.data._id}`);
    });

    it('hides one user\'s webhook from another (ownership is part of the match)', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const created = await owner.api.post('/api/v2/webhooks', { name: `[int] owned ${uniqueSuffix()}`, url: 'https://example.com/owned', events: ['*'] });
        const id = created.body.data._id;

        const put = await guest.api.put(`/api/v2/webhooks/${id}`, { active: false });
        const del = await guest.api.delete(`/api/v2/webhooks/${id}`);
        expect(put.body.statusText).toMatch(/not found/i);
        expect(del.body.statusText).toMatch(/not found/i);

        await owner.api.delete(`/api/v2/webhooks/${id}`);
    });

    it('rejects malformed webhook input', async () => {
        const owner = await loginAs('owner');
        for (const bad of [
            { name: '', url: 'https://x.test', events: ['*'] },
            { name: 'x', url: 'ftp://x', events: ['*'] },
            { name: 'x', url: 'https://x.test', events: [] },
            { name: 'x', url: 'https://x.test', events: ['nope'] },
        ]) {
            // eslint-disable-next-line no-await-in-loop
            const res = await owner.api.post('/api/v2/webhooks', bad);
            expect(res.body.status).toBe(false);
        }
    });

    // REP-04 — webhook URL validation only checks the protocol, so loopback and the
    // cloud metadata address are accepted (blind SSRF via the dispatcher).
    it('REP-04 refuses a webhook aimed at a private / link-local host', async () => {
        const owner = await loginAs('owner');
        const results = [];
        for (const url of ['http://127.0.0.1:9/int-sink', 'http://169.254.169.254/latest/meta-data']) {
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
});

describe('reports — integrations', () => {
    it('lists the static catalog', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.get('/api/v1/integrations/catalog');
        expect(res.body.status).toBe(true);
        expect(res.body.data.map((c) => c.key)).toContain('slack');
    });

    it('rejects a custom embed with a non-https URL and stores a valid one redacted', async () => {
        const owner = await loginAs('owner');
        const bad = await owner.api.post('/api/v1/integrations/connections', { type: 'custom_iframe', config: { name: '[int] embed', url: 'javascript:alert(1)' } });
        expect(bad.body.status).toBe(false);

        const good = await owner.api.post('/api/v1/integrations/connections', { type: 'custom_iframe', config: { name: `[int] embed ${uniqueSuffix()}`, url: 'https://example.com/app' } });
        expect(good.body.status).toBe(true);
        await owner.api.delete(`/api/v1/integrations/connections/${good.body.data._id}`);
    });

    it('answers the public Slack command with guidance when Slack is not connected', async () => {
        // Slack posts a urlencoded body; send it directly (the shared client is JSON-only).
        const res = await fetch(new URL(`/api/v1/slack/command/${state.companyId}`, state.baseURL), {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'token=x&text=projects',
        });
        const body = await res.json();
        // The controller replies 200 with an ephemeral message rather than erroring.
        expect(res.status).toBe(200);
        expect(body.response_type).toBe('ephemeral');
    });

    // REP-03 — connection management has no role gate, so a guest can configure /
    // disconnect company-wide integrations.
    it('REP-03 refuses a guest managing company integration connections', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.post('/api/v1/integrations/connections', { type: 'zapier', config: { hook_url: 'https://hooks.zapier.com/int' } });
        if (res.body && res.body.data && res.body.data._id) {
            await (await loginAs('owner')).api.delete(`/api/v1/integrations/connections/${res.body.data._id}`);
        }
        expect(refused(res)).toBe(true);
    });

    // REP-05 — non-iframe integration types skip per-field validation, so obviously
    // invalid config is stored and reported "Connected".
    it('REP-05 refuses an integration with an invalid config value', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v1/integrations/connections', { type: 'zapier', config: { hook_url: 'not a url' } });
        if (res.body && res.body.data && res.body.data._id) {
            await owner.api.delete(`/api/v1/integrations/connections/${res.body.data._id}`);
        }
        expect(res.body.status).toBe(false);
    });
});

describe('reports — cross-tenant and auth', () => {
    it('refuses an anonymous caller on every module list route', async () => {
        for (const path of ['/api/v1/dashboards', '/api/v1/reports/custom', '/api/v1/reports/schedules', '/api/v2/webhooks', '/api/v1/integrations/connections']) {
            // eslint-disable-next-line no-await-in-loop
            const res = await anonymous.get(path);
            expect(res.status).toBe(401);
        }
    });

    it('refuses a session pointed at another company', async () => {
        const owner = await loginAs('owner');
        const foreign = owner.api.withCompany('000000000000000000000001');
        const res = await foreign.get('/api/v2/webhooks');
        expect(res.status).toBe(401);
    });
});
