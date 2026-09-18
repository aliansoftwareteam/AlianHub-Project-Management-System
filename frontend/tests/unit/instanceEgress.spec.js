import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequestWithoutCompnay } = vi.hoisted(() => ({ apiRequestWithoutCompnay: vi.fn() }));

vi.mock('@/services', () => ({ apiRequestWithoutCompnay }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import InstanceEgress from '@/views/Settings/Instance/InstanceEgress.vue';

const BASE = '/api/v2/instance/egress';
const CID_A = '6f00000000000000000000a1';
const CID_B = '6f00000000000000000000b1';
const WHEN = '2026-09-17T10:00:00.000Z';

const ws = (companyId, name, over = {}) => ({ companyId, name, hosts: [], updatedAt: null, updatedBy: '', updatedByName: '', refused7d: 0, ...over });

const summary = (over = {}) => ({
    flag: { on: true, envKey: 'AGENT_EGRESS_ALLOWLIST' },
    cacheTtlSeconds: 30,
    windowDays: 7,
    maxHosts: 200,
    workspaces: [
        ws(CID_A, 'Acme', { hosts: ['docs.example.com', '*.api.example.com'], updatedAt: WHEN, updatedBy: 'u1', updatedByName: 'Olivia Owner', refused7d: 3 }),
        ws(CID_B, 'Bolt'),
    ],
    ...over,
});

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refused = (status, statusText, data) => Promise.reject({ response: { status, data: { status: false, statusText, data } } });

const serve = ({ summaryData = summary(), put = () => ok({}) } = {}) => {
    apiRequestWithoutCompnay.mockImplementation((type, url, body) => {
        if (type === 'get' && url === BASE) return ok(summaryData);
        if (type === 'put') return put(url, body);
        return Promise.reject(new Error(`unexpected ${type} ${url}`));
    });
};

const mountWith = async (options) => {
    serve(options);
    const wrapper = mount(InstanceEgress);
    await flushPromises();
    return wrapper;
};

const calls = (type) => apiRequestWithoutCompnay.mock.calls.filter(([t]) => t === type);
const addHost = async (wrapper, cid, host) => {
    await wrapper.find(`input[data-test="host-input-${cid}"]`).setValue(host);
    await wrapper.find(`form[data-test="add-${cid}"]`).trigger('submit');
    await flushPromises();
};

describe('InstanceEgress', () => {
    beforeEach(() => { apiRequestWithoutCompnay.mockReset(); });

    it('shows the flag on and every workspace with its hosts, who set them and the refusals of the window', async () => {
        const wrapper = await mountWith();
        expect(wrapper.find('[data-test="flag-on"]').text()).toContain('Egress.flag_on');
        expect(wrapper.find('[data-test="flag-off"]').exists()).toBe(false);
        expect(wrapper.findAll('section[data-test^="workspace-"]')).toHaveLength(2);

        const acme = wrapper.find(`section[data-test="workspace-${CID_A}"]`);
        expect(acme.text()).toContain('Acme');
        expect(acme.findAll(`[data-test="host-${CID_A}"]`).map((chip) => chip.text())).toEqual(['docs.example.com', '*.api.example.com']);
        expect(acme.find(`[data-test="refused-${CID_A}"]`).text()).toContain('Egress.refused_count');
        expect(acme.find(`[data-test="updated-${CID_A}"]`).text()).toContain('Olivia Owner');
        expect(acme.find(`[data-test="no-hosts-${CID_A}"]`).exists()).toBe(false);

        const bolt = wrapper.find(`section[data-test="workspace-${CID_B}"]`);
        expect(bolt.findAll(`[data-test="host-${CID_B}"]`)).toHaveLength(0);
        expect(bolt.find(`[data-test="no-hosts-${CID_B}"]`).text()).toBe('Egress.no_hosts');
        expect(bolt.find(`[data-test="refused-${CID_B}"]`).exists()).toBe(true);
    });

    it('labels every input for the keyboard and screen readers', async () => {
        const wrapper = await mountWith();
        const input = wrapper.find(`input[data-test="host-input-${CID_A}"]`);
        expect(input.attributes('id')).toBe(`egress-host-${CID_A}`);
        expect(wrapper.find(`label[for="egress-host-${CID_A}"]`).exists()).toBe(true);
        expect(wrapper.find(`button[data-test="remove-${CID_A}-docs.example.com"]`).attributes('aria-label')).toBe('Egress.remove_host');
    });

    it('adds a host by sending the whole list and reloads', async () => {
        const wrapper = await mountWith();
        await addHost(wrapper, CID_A, ' Static.Example.com ');
        expect(calls('put')).toEqual([['put', `${BASE}/${CID_A}`, { hosts: ['docs.example.com', '*.api.example.com', 'static.example.com'] }]]);
        expect(calls('get').filter(([, url]) => url === BASE)).toHaveLength(2);
        expect(wrapper.find(`input[data-test="host-input-${CID_A}"]`).element.value).toBe('');
    });

    it('removes a host by sending the list without it', async () => {
        const wrapper = await mountWith();
        await wrapper.find(`button[data-test="remove-${CID_A}-docs.example.com"]`).trigger('click');
        await flushPromises();
        expect(calls('put')).toEqual([['put', `${BASE}/${CID_A}`, { hosts: ['*.api.example.com'] }]]);
    });

    it.each([
        ['10.0.0.1', 'Egress.error_address'],
        ['169.254.169.254', 'Egress.error_address'],
        ['localhost', 'Egress.error_private'],
        ['vault.internal', 'Egress.error_private'],
        ['https://docs.example.com', 'Egress.error_scheme'],
        ['docs.example.com/api', 'Egress.error_path'],
        ['*.com', 'Egress.error_wildcard'],
        ['docs.example.com:99999', 'Egress.error_port'],
        ['not a host', 'Egress.error_invalid'],
    ])('refuses %s in the browser before asking the server', async (entry, message) => {
        const wrapper = await mountWith();
        await addHost(wrapper, CID_A, entry);
        expect(wrapper.find(`[data-test="host-error-${CID_A}"]`).text()).toBe(message);
        expect(calls('put')).toEqual([]);
        expect(wrapper.find(`input[data-test="host-input-${CID_A}"]`).element.value).toBe(entry);
    });

    it('says when a host is already listed and sends nothing', async () => {
        const wrapper = await mountWith();
        await addHost(wrapper, CID_A, 'DOCS.example.com');
        expect(wrapper.find(`[data-test="host-error-${CID_A}"]`).text()).toBe('Egress.error_duplicate');
        expect(calls('put')).toEqual([]);
    });

    it('shows a refusal from the server instead of pretending the list changed', async () => {
        const wrapper = await mountWith({ put: () => refused(400, 'Entry refused.', { errors: [{ entry: 'x.example.com', reason: 'private' }] }) });
        await addHost(wrapper, CID_A, 'x.example.com');
        expect(wrapper.find('[data-test="action-error"]').text()).toContain('Entry refused.');
    });

    it('shows the flag off, names the variable and lists nothing', async () => {
        apiRequestWithoutCompnay.mockImplementation(() => refused(404, 'AGENT_EGRESS_ALLOWLIST is off.', { flag: { on: false, envKey: 'AGENT_EGRESS_ALLOWLIST' } }));
        const wrapper = mount(InstanceEgress);
        await flushPromises();
        expect(wrapper.find('[data-test="flag-off"]').text()).toContain('Egress.flag_off');
        expect(wrapper.find('[data-test="flag-off"]').text()).toContain('AGENT_EGRESS_ALLOWLIST');
        expect(wrapper.find('section[data-test^="workspace-"]').exists()).toBe(false);
        expect(wrapper.find('.in-banner--danger').exists()).toBe(false);
    });

    it('reports a failure to load rather than an empty console', async () => {
        apiRequestWithoutCompnay.mockImplementation(() => Promise.reject(new Error('nope')));
        const wrapper = mount(InstanceEgress);
        await flushPromises();
        expect(wrapper.find('.in-banner--danger').text()).toContain('nope');
        expect(wrapper.find('section[data-test^="workspace-"]').exists()).toBe(false);
    });
});
