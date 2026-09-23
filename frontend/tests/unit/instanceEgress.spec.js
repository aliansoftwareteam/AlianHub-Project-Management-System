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

const ws = (companyId, name, over = {}) => ({ companyId, name, hosts: [], updatedAt: null, updatedBy: '', updatedByName: '', refused7d: 0, version: 0, ...over });

const summary = (over = {}) => ({
    flag: { on: true, envKey: 'AGENT_EGRESS_ALLOWLIST' },
    cacheTtlSeconds: 30,
    windowDays: 7,
    maxHosts: 200,
    page: 1,
    pageSize: 50,
    total: 2,
    workspaces: [
        ws(CID_A, 'Acme', { hosts: ['docs.example.com', '*.api.example.com'], updatedAt: WHEN, updatedBy: 'u1', updatedByName: 'Olivia Owner', refused7d: 3, version: 4 }),
        ws(CID_B, 'Bolt'),
    ],
    ...over,
});

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refused = (status, statusText, data, code) => Promise.reject({ response: { status, data: { status: false, statusText, ...(code ? { code } : {}), data } } });

const serve = ({ summaryData = summary(), put = () => ok({}) } = {}) => {
    apiRequestWithoutCompnay.mockImplementation((type, url, body) => {
        if (type === 'get' && url.split('?')[0] === BASE) return ok(typeof summaryData === 'function' ? summaryData(url) : summaryData);
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
const summaryLoads = () => calls('get').filter(([, url]) => url.split('?')[0] === BASE);
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
        expect(calls('put')).toEqual([['put', `${BASE}/${CID_A}`, { hosts: ['docs.example.com', '*.api.example.com', 'static.example.com'], version: 4 }]]);
        expect(summaryLoads()).toHaveLength(2);
        expect(wrapper.find(`input[data-test="host-input-${CID_A}"]`).element.value).toBe('');
    });

    it('removes a host by sending the list without it, and asks nothing while hosts remain', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const wrapper = await mountWith();
        await wrapper.find(`button[data-test="remove-${CID_A}-docs.example.com"]`).trigger('click');
        await flushPromises();
        expect(confirm).not.toHaveBeenCalled();
        expect(calls('put')).toEqual([['put', `${BASE}/${CID_A}`, { hosts: ['*.api.example.com'], version: 4 }]]);
    });

    describe('removing the last host', () => {
        const oneHost = () => summary({ workspaces: [ws(CID_A, 'Acme', { hosts: ['docs.example.com'] })] });
        const removeLast = async (wrapper) => {
            await wrapper.find(`button[data-test="remove-${CID_A}-docs.example.com"]`).trigger('click');
            await flushPromises();
        };

        it('asks first, saying the workspace reopens to every public host, and sends nothing when declined', async () => {
            const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
            const wrapper = await mountWith({ summaryData: oneHost() });
            await removeLast(wrapper);
            expect(confirm).toHaveBeenCalledTimes(1);
            expect(confirm).toHaveBeenCalledWith('Egress.clear_confirm');
            expect(calls('put')).toEqual([]);
            expect(wrapper.findAll(`[data-test="host-${CID_A}"]`)).toHaveLength(1);
        });

        it('sends the empty list once confirmed', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            const wrapper = await mountWith({ summaryData: oneHost() });
            await removeLast(wrapper);
            expect(calls('put')).toEqual([['put', `${BASE}/${CID_A}`, { hosts: [], version: 0 }]]);
        });
    });

    it.each([
        ['10.0.0.1', 'Egress.error_address'],
        ['169.254.169.254', 'Egress.error_address'],
        ['localhost', 'Egress.error_private'],
        ['vault.internal', 'Egress.error_private'],
        ['https://docs.example.com', 'Egress.error_scheme'],
        ['docs.example.com/api', 'Egress.error_path'],
        ['*.com', 'Egress.error_wildcard'],
        ['*.co.uk', 'Egress.error_public_suffix'],
        ['*.github.io', 'Egress.error_public_suffix'],
        ['*.nip.io', 'Egress.error_wildcard_dns'],
        ['*.team.sslip.io', 'Egress.error_wildcard_dns'],
        ['*.nip.direct', 'Egress.error_wildcard_dns'],
        ['*.backname.io', 'Egress.error_wildcard_dns'],
        ['*.vercel.app', 'Egress.error_public_suffix'],
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

    it('shows a refusal from the server instead of pretending the list changed, translated from its reason', async () => {
        const wrapper = await mountWith({ put: () => refused(400, 'Entry refused.', { errors: [{ entry: 'x.example.com', reason: 'private' }] }, 'entries_refused') });
        await addHost(wrapper, CID_A, 'x.example.com');
        expect(wrapper.find('[data-test="action-error"]').text()).toContain('x.example.com');
        expect(wrapper.find('[data-test="action-error"]').text()).toContain('Egress.error_private');
        expect(wrapper.find('[data-test="action-error"]').text()).not.toContain('Entry refused.');
    });

    it.each(['unknown_workspace', 'invalid_company_id', 'hosts_not_list', 'version_required', 'server_error'])('translates the %s answer from its code', async (code) => {
        const wrapper = await mountWith({ put: () => refused(400, 'English text from the server.', undefined, code) });
        await addHost(wrapper, CID_A, 'x.example.com');
        expect(wrapper.find('[data-test="action-error"]').text()).toBe(`Egress.code_${code}`);
    });

    it('falls back to the server text for a code it does not know', async () => {
        const wrapper = await mountWith({ put: () => refused(400, 'English text from the server.', undefined, 'something_new') });
        await addHost(wrapper, CID_A, 'x.example.com');
        expect(wrapper.find('[data-test="action-error"]').text()).toBe('English text from the server.');
    });

    it('a save from a stale read reloads the lists and says so', async () => {
        let loads = 0;
        const fresh = summary({ workspaces: [ws(CID_A, 'Acme', { hosts: ['docs.example.com', 'other-tab.example.com'], version: 5 })] });
        const wrapper = await mountWith({
            summaryData: () => { loads += 1; return loads === 1 ? summary() : fresh; },
            put: () => refused(409, 'Stale.', { version: 5 }, 'stale_version'),
        });
        await addHost(wrapper, CID_A, 'mine.example.com');
        expect(calls('put')[0][2]).toEqual({ hosts: ['docs.example.com', '*.api.example.com', 'mine.example.com'], version: 4 });
        expect(summaryLoads()).toHaveLength(2);
        expect(wrapper.find('[data-test="action-error"]').text()).toBe('Egress.code_stale_version');
        expect(wrapper.findAll(`[data-test="host-${CID_A}"]`).map((chip) => chip.text())).toEqual(['docs.example.com', 'other-tab.example.com']);
    });

    describe('a removal refused as stale', () => {
        const staleOnce = (fresh) => {
            let loads = 0;
            let puts = 0;
            return {
                summaryData: () => { loads += 1; return loads === 1 ? summary() : fresh; },
                put: () => { puts += 1; return puts === 1 ? refused(409, 'Stale.', { version: 5 }, 'stale_version') : ok({}); },
            };
        };
        const removeDocs = async (wrapper) => {
            await wrapper.find(`button[data-test="remove-${CID_A}-docs.example.com"]`).trigger('click');
            await flushPromises();
        };

        it('is made again on the fresh list rather than dropped', async () => {
            const fresh = summary({ workspaces: [ws(CID_A, 'Acme', { hosts: ['docs.example.com', '*.api.example.com', 'other-tab.example.com'], version: 5 })] });
            const wrapper = await mountWith(staleOnce(fresh));
            await removeDocs(wrapper);
            expect(calls('put').map(([, , body]) => body)).toEqual([
                { hosts: ['*.api.example.com'], version: 4 },
                { hosts: ['*.api.example.com', 'other-tab.example.com'], version: 5 },
            ]);
            expect(wrapper.find('[data-test="action-error"]').exists()).toBe(false);
        });

        it('is not made again when the host is already gone', async () => {
            const fresh = summary({ workspaces: [ws(CID_A, 'Acme', { hosts: ['*.api.example.com'], version: 5 })] });
            const wrapper = await mountWith(staleOnce(fresh));
            await removeDocs(wrapper);
            expect(calls('put')).toHaveLength(1);
        });

        it('is not made again when it would now empty the list, which reopens the workspace', async () => {
            const fresh = summary({ workspaces: [ws(CID_A, 'Acme', { hosts: ['docs.example.com'], version: 5 })] });
            const wrapper = await mountWith(staleOnce(fresh));
            await removeDocs(wrapper);
            expect(calls('put')).toHaveLength(1);
            expect(wrapper.find('[data-test="action-error"]').text()).toBe('Egress.code_stale_version');
        });

        it('is made again once only', async () => {
            const fresh = summary({ workspaces: [ws(CID_A, 'Acme', { hosts: ['docs.example.com', 'other-tab.example.com'], version: 5 })] });
            const wrapper = await mountWith({ summaryData: () => fresh, put: () => refused(409, 'Stale.', { version: 6 }, 'stale_version') });
            await removeDocs(wrapper);
            expect(calls('put')).toHaveLength(2);
            expect(wrapper.find('[data-test="action-error"]').text()).toBe('Egress.code_stale_version');
        });
    });

    it('says a port-less entry allows any port and plain http', async () => {
        const wrapper = await mountWith();
        expect(wrapper.find('[data-test="port-help"]').text()).toBe('Egress.port_help');
    });

    it('names the admin key as the one who last set a list', async () => {
        const wrapper = await mountWith({ summaryData: summary({ workspaces: [ws(CID_A, 'Acme', { hosts: ['docs.example.com'], updatedAt: WHEN, updatedBy: 'instance-admin-key' })] }) });
        expect(wrapper.find(`[data-test="updated-${CID_A}"]`).text()).toContain('Egress.updated_by_admin_key');
        expect(wrapper.find(`[data-test="updated-${CID_A}"]`).text()).not.toContain('instance-admin-key');
    });

    describe('paging', () => {
        const pageOf = (url) => Number(new URLSearchParams(url.split('?')[1] || '').get('page') || 1);
        const paged = (url) => summary({ page: pageOf(url), pageSize: 50, total: 120, workspaces: [ws(`6f0000000000000000000${pageOf(url)}00`, `Page ${pageOf(url)}`)] });

        it('asks for the first page, then moves between pages', async () => {
            const wrapper = await mountWith({ summaryData: paged });
            expect(summaryLoads()[0][1]).toBe(`${BASE}?page=1`);
            expect(wrapper.find('[data-test="page-status"]').text()).toBe('Egress.page_status');
            expect(wrapper.find('button[data-test="page-prev"]').attributes('disabled')).toBeDefined();
            await wrapper.find('button[data-test="page-next"]').trigger('click');
            await flushPromises();
            expect(summaryLoads().at(-1)[1]).toBe(`${BASE}?page=2`);
            expect(wrapper.text()).toContain('Page 2');
            await wrapper.find('button[data-test="page-next"]').trigger('click');
            await flushPromises();
            expect(summaryLoads().at(-1)[1]).toBe(`${BASE}?page=3`);
            expect(wrapper.find('button[data-test="page-next"]').attributes('disabled')).toBeDefined();
            await wrapper.find('button[data-test="page-prev"]').trigger('click');
            await flushPromises();
            expect(summaryLoads().at(-1)[1]).toBe(`${BASE}?page=2`);
        });

        it('follows the page the server answers with when the list shrank under it', async () => {
            let total = 150;
            const shrinking = (url) => {
                const pages = Math.ceil(total / 50);
                const page = Math.min(pageOf(url), pages);
                return summary({ page, pageSize: 50, total, workspaces: [ws(`6f0000000000000000000${page}00`, `Page ${page}`)] });
            };
            const wrapper = await mountWith({ summaryData: shrinking });
            await wrapper.find('button[data-test="page-next"]').trigger('click');
            await flushPromises();
            await wrapper.find('button[data-test="page-next"]').trigger('click');
            await flushPromises();
            expect(summaryLoads().at(-1)[1]).toBe(`${BASE}?page=3`);
            total = 100;
            await wrapper.find('button.ah-btn--ghost').trigger('click');
            await flushPromises();
            expect(wrapper.text()).toContain('Page 2');
            expect(wrapper.find('button[data-test="page-next"]').attributes('disabled')).toBeDefined();
            await wrapper.find('button[data-test="page-prev"]').trigger('click');
            await flushPromises();
            expect(summaryLoads().at(-1)[1]).toBe(`${BASE}?page=1`);
        });

        it('shows no pager when every workspace fits on one page', async () => {
            const wrapper = await mountWith();
            expect(wrapper.find('[data-test="pager"]').exists()).toBe(false);
        });
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
