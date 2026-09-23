import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequestWithoutCompnay }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import InstanceEnforcement from '@/views/Settings/Instance/InstanceEnforcement.vue';

const BASE = '/api/v2/instance/enforcement';
const CID_A = '6f00000000000000000000a1';
const CID_B = '6f00000000000000000000b1';
const CID_C = '6f00000000000000000000c1';
const LAST = '2026-09-03T10:00:00.000Z';

const ws = (companyId, name, over = {}) => ({
    companyId, name, mode: 'inherit', effectiveMode: 'off', since: null, firstReportRowAt: null, daysSinceFirstReportRow: null,
    lastRowAt: null, rows30d: 0, streakDays: null, readyToEnforce: false, ...over,
});

const summary = (over = {}) => ({
    instance: { mode: 'off', source: 'default', locked: false, killSwitch: false },
    cacheTtlSeconds: 30,
    readyAfterDays: 14,
    workspaces: [
        ws(CID_A, 'Acme', { mode: 'report', effectiveMode: 'report', streakDays: 15, readyToEnforce: true, rows30d: 3, lastRowAt: LAST, firstReportRowAt: '2026-08-20T10:00:00.000Z', daysSinceFirstReportRow: 29 }),
        ws(CID_B, 'Bolt'),
        ws(CID_C, 'Crab', { mode: 'inherit', effectiveMode: 'report', streakDays: 5, rows30d: 2, lastRowAt: LAST }),
    ],
    instanceBucket: { companyId: 'instance', rows30d: 1, lastRowAt: LAST },
    ...over,
});

const decisionRow = (over = {}) => ({
    id: 'r1', day: '2026-09-03T00:00:00.000Z', mode: 'report', method: 'PATCH', route: '/api/v2/tasks', permission: 'task.task_priority',
    role: 3, scope: 'global', reason: 'denied', knownDifference: false, count: 4, firstSeen: LAST, lastSeen: LAST,
    users: [{ id: 'u1', name: 'Uma One' }, { id: 'u2', name: '' }],
    ...over,
});

const decisions = (rows, companyId = CID_A) => ({
    companyId, days: 30,
    reasons: ['denied', 'no_seat', 'role_not_allowed', 'tasks_not_found', 'null_global_flag', 'check_failed', 'unresolvable_id', 'company_mismatch'],
    knownDifferenceReasons: ['null_global_flag'],
    rows,
});

const ok = (data) => Promise.resolve({ data: { status: true, data } });

const serve = ({ summaryData = summary(), rows = [] } = {}) => {
    apiRequestWithoutCompnay.mockImplementation((type, url) => {
        if (type === 'get' && url === BASE) return ok(summaryData);
        if (type === 'get' && url.includes('/decisions')) return ok(decisions(rows, url.includes('/instance/') ? 'instance' : CID_A));
        if (type === 'put') return ok({});
        return Promise.reject(new Error(`unexpected ${type} ${url}`));
    });
};

const mountWith = async (options) => {
    serve(options);
    const wrapper = mount(InstanceEnforcement);
    await flushPromises();
    return wrapper;
};

const calls = (type) => apiRequestWithoutCompnay.mock.calls.filter(([t]) => t === type);

describe('InstanceEnforcement', () => {
    beforeEach(() => { apiRequestWithoutCompnay.mockReset(); });

    it('shows the instance default, where it comes from, and the cache window', async () => {
        const wrapper = await mountWith();
        expect(wrapper.find('select[data-test="instance-default"]').element.value).toBe('off');
        expect(wrapper.find('select[data-test="instance-default"]').element.disabled).toBe(false);
        expect(wrapper.find('[data-test="instance-source"]').text()).toBe('Enforcement.source_default');
        expect(wrapper.find('[data-test="cache-note"]').text()).toContain('Enforcement.cache_note');
    });

    it('says a change applies at once when the cache window is zero', async () => {
        const wrapper = await mountWith({ summaryData: summary({ cacheTtlSeconds: 0 }) });
        expect(wrapper.find('[data-test="cache-note"]').text()).toBe('Enforcement.cache_note_now');
    });

    it('locks the default when the environment sets it', async () => {
        const wrapper = await mountWith({ summaryData: summary({ instance: { mode: 'report', source: 'env', locked: true, killSwitch: false } }) });
        const select = wrapper.find('select[data-test="instance-default"]');
        expect(select.element.value).toBe('report');
        expect(select.element.disabled).toBe(true);
        expect(wrapper.find('[data-test="instance-source"]').text()).toBe('Enforcement.source_env');
    });

    it('warns when the kill switch turns enforce into report', async () => {
        const wrapper = await mountWith({ summaryData: summary({ instance: { mode: 'enforce', source: 'default', locked: false, killSwitch: true } }) });
        expect(wrapper.find('[data-test="kill-switch"]').text()).toContain('Enforcement.kill_switch');
    });

    it('lists each workspace with its mode selector, effective mode and readiness line', async () => {
        const wrapper = await mountWith();
        expect(wrapper.findAll('tr[data-test^="workspace-"]')).toHaveLength(4);
        const acme = wrapper.find(`tr[data-test="workspace-${CID_A}"]`);
        expect(acme.text()).toContain('Acme');
        expect(acme.find(`select[data-test="mode-${CID_A}"]`).element.value).toBe('report');
        expect(acme.find(`[data-test="effective-${CID_A}"]`).text()).toBe('Enforcement.mode_report');
        expect(acme.find(`[data-test="readiness-${CID_A}"]`).text()).toBe('Enforcement.ready');
        expect(acme.find(`[data-test="readiness-${CID_A}"]`).classes()).toContain('ah-chip--ok');

        const bolt = wrapper.find(`tr[data-test="workspace-${CID_B}"]`);
        expect(bolt.find(`select[data-test="mode-${CID_B}"]`).element.value).toBe('inherit');
        expect(bolt.find(`[data-test="effective-${CID_B}"]`).text()).toBe('Enforcement.mode_off');
        expect(bolt.find(`[data-test="readiness-${CID_B}"]`).text()).toBe('Enforcement.not_in_report');

        const crab = wrapper.find(`tr[data-test="workspace-${CID_C}"]`);
        expect(crab.find(`[data-test="readiness-${CID_C}"]`).text()).toBe('Enforcement.quiet_days');
        expect(crab.find(`[data-test="readiness-${CID_C}"]`).classes()).not.toContain('ah-chip--ok');
    });

    it('says when a report workspace has nothing to count yet', async () => {
        const wrapper = await mountWith({ summaryData: summary({ workspaces: [ws(CID_A, 'Acme', { mode: 'report', effectiveMode: 'report' })] }) });
        expect(wrapper.find(`[data-test="readiness-${CID_A}"]`).text()).toBe('Enforcement.no_streak_yet');
    });

    it('labels every mode selector for the keyboard and screen readers', async () => {
        const wrapper = await mountWith();
        expect(wrapper.find(`select[data-test="mode-${CID_A}"]`).attributes('aria-label')).toBe('Enforcement.mode_for');
        expect(wrapper.find('select[data-test="instance-default"]').attributes('id')).toBe('enforcement-default');
        expect(wrapper.find('label[for="enforcement-default"]').exists()).toBe(true);
    });

    it('sets a workspace mode through the console and reloads the summary', async () => {
        const wrapper = await mountWith();
        await wrapper.find(`select[data-test="mode-${CID_A}"]`).setValue('enforce');
        await flushPromises();
        expect(calls('put')).toEqual([['put', `${BASE}/${CID_A}/mode`, { mode: 'enforce' }]]);
        expect(calls('get').filter(([, url]) => url === BASE)).toHaveLength(2);
    });

    it('sets the instance default through the console', async () => {
        const wrapper = await mountWith();
        await wrapper.find('select[data-test="instance-default"]').setValue('report');
        await flushPromises();
        expect(calls('put')).toEqual([['put', `${BASE}/default`, { mode: 'report' }]]);
    });

    it('shows a refused mode change instead of pretending it applied', async () => {
        const wrapper = await mountWith();
        apiRequestWithoutCompnay.mockImplementation((type) => (type === 'put'
            ? Promise.reject({ response: { data: { status: false, statusText: 'PERMISSION_ENFORCEMENT_MODE is set in the environment.' } } })
            : ok(summary())));
        await wrapper.find('select[data-test="instance-default"]').setValue('enforce');
        await flushPromises();
        expect(wrapper.find('[data-test="action-error"]').text()).toContain('set in the environment');
    });

    it('drills into a workspace, lists its grouped rows and marks the known difference', async () => {
        const wrapper = await mountWith({ rows: [decisionRow(), decisionRow({ id: 'r2', reason: 'null_global_flag', knownDifference: true, scope: '6f0000000000000000000a03' })] });
        await wrapper.find(`button[data-test="rows-${CID_A}"]`).trigger('click');
        await flushPromises();
        const url = calls('get').map(([, u]) => u).find((u) => u.includes('/decisions'));
        expect(url.startsWith(`${BASE}/${CID_A}/decisions?`)).toBe(true);
        expect(url).toContain('days=30');

        const rows = wrapper.findAll('tr[data-test="decision-row"]');
        expect(rows).toHaveLength(2);
        expect(rows[0].text()).toContain('/api/v2/tasks');
        expect(rows[0].text()).toContain('task.task_priority');
        expect(rows[0].text()).toContain('Uma One');
        expect(rows[0].text()).toContain('Enforcement.role_member');
        expect(rows[0].text()).toContain('Enforcement.reason_denied');
        expect(wrapper.findAll('[data-test="known-difference"]')).toHaveLength(1);
        expect(rows[1].find('[data-test="known-difference"]').text()).toBe('Enforcement.known_difference');
    });

    it('filters the rows by reason and by key', async () => {
        const wrapper = await mountWith({ rows: [decisionRow()] });
        await wrapper.find(`button[data-test="rows-${CID_A}"]`).trigger('click');
        await flushPromises();
        await wrapper.find('select[data-test="reason-filter"]').setValue('null_global_flag');
        await flushPromises();
        await wrapper.find('input[data-test="key-filter"]').setValue('task.task_status');
        await wrapper.find('form[data-test="decision-filters"]').trigger('submit');
        await flushPromises();
        const urls = calls('get').map(([, u]) => u).filter((u) => u.includes('/decisions'));
        expect(urls.at(-2)).toContain('reason=null_global_flag');
        expect(urls.at(-1)).toContain('key=task.task_status');
        expect(urls.at(-1)).toContain('reason=null_global_flag');
    });

    it('says so when the window holds no rows', async () => {
        const wrapper = await mountWith({ rows: [] });
        await wrapper.find(`button[data-test="rows-${CID_A}"]`).trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="no-decisions"]').text()).toBe('Enforcement.no_rows');
    });

    it('lists the instance bucket with rows but no mode selector', async () => {
        const wrapper = await mountWith({ rows: [decisionRow({ role: null, reason: 'no_seat' })] });
        const bucket = wrapper.find('tr[data-test="workspace-instance"]');
        expect(bucket.exists()).toBe(true);
        expect(bucket.find('select').exists()).toBe(false);
        expect(bucket.text()).toContain('Enforcement.instance_bucket');
        await bucket.find('button[data-test="rows-instance"]').trigger('click');
        await flushPromises();
        expect(calls('get').some(([, u]) => u.startsWith(`${BASE}/instance/decisions?`))).toBe(true);
        expect(wrapper.findAll('tr[data-test="decision-row"]')).toHaveLength(1);
    });

    it('reports a failure to load rather than an empty console', async () => {
        apiRequestWithoutCompnay.mockImplementation(() => Promise.reject(new Error('nope')));
        const wrapper = mount(InstanceEnforcement);
        await flushPromises();
        expect(wrapper.find('.in-banner--danger').text()).toContain('nope');
        expect(wrapper.find('tbody').exists()).toBe(false);
    });
});
