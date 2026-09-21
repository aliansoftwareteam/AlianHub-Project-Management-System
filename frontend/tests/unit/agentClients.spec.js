import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import AgentClients from '@/views/Settings/AgentClients/AgentClients.vue';

const WHEN = '2026-09-21T10:00:00.000Z';
const CIMD = 'https://agent.example/oauth/client.json';

const row = (over = {}) => ({
    clientId: 'ahc_0123456789abcdef01234567', clientName: 'Claude Code', clientKind: 'dynamic', clientHost: '', redirectHosts: ['127.0.0.1'],
    status: 'pending', scopes: [], requestedScopes: ['tasks:read', 'tasks:write'], privateSprints: false,
    requestedBy: 'u1', requestedByName: 'Max Member', requestedAt: WHEN, decidedBy: '', decidedAt: null, revokedAt: null, ...over,
});

const list = () => [
    row(),
    row({ clientId: CIMD, clientName: 'Doc agent', clientKind: 'metadata_document', clientHost: 'agent.example', redirectHosts: ['agent.example'], status: 'approved', scopes: ['tasks:read', 'docs:read'], privateSprints: true, decidedBy: 'u2', decidedByName: 'Olivia Owner', decidedAt: WHEN }),
    row({ clientId: 'ahc_ffffffffffffffffffffffff', clientName: 'Old agent', status: 'revoked', scopes: ['tasks:read'], revokedAt: WHEN }),
];

const ok = (data) => Promise.resolve({ data: { status: true, data } });

const serve = ({ rows = list(), post } = {}) => {
    apiRequest.mockImplementation((type, url, body) => {
        if (type === 'get') return typeof rows === 'function' ? rows() : ok(rows);
        if (type === 'post') return post ? post(url, body) : ok({ ...body, status: url.endsWith('/approve') ? 'approved' : (url.endsWith('/deny') ? 'denied' : 'revoked') });
        return Promise.reject(new Error(`unexpected ${type} ${url}`));
    });
};

const mountWith = async (options) => {
    serve(options);
    const wrapper = mount(AgentClients);
    await flushPromises();
    return wrapper;
};

const posts = () => apiRequest.mock.calls.filter(([type]) => type === 'post');

describe('Settings > Agent clients', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        vi.spyOn(window, 'confirm').mockReturnValue(true);
    });

    it('lists pending requests, approved clients with their scope ceiling and private-sprint flag, and past ones', async () => {
        const wrapper = await mountWith();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/oauth-client-approvals');
        const pending = wrapper.findAll('[data-test="pending-row"]');
        expect(pending).toHaveLength(1);
        expect(pending[0].text()).toContain('Claude Code');
        expect(pending[0].text()).toContain('Max Member');
        expect(pending[0].text()).toContain('127.0.0.1');
        const approved = wrapper.findAll('[data-test="approved-row"]');
        expect(approved).toHaveLength(1);
        expect(approved[0].text()).toContain('agent.example');
        expect(approved[0].findAll('[data-test="ceiling"]').map((chip) => chip.text())).toEqual(['OAuthConsent.scope_name_tasks_read', 'OAuthConsent.scope_name_docs_read']);
        expect(approved[0].find('[data-test="private-flag"]').text()).toBe('AgentClients.private_on');
        expect(wrapper.findAll('[data-test="past-row"]')).toHaveLength(1);
    });

    it('approves a pending request with the requested scopes checked, the private-sprint opt-in off, and what the admin changes', async () => {
        const wrapper = await mountWith();
        const pending = wrapper.find('[data-test="pending-row"]');
        const checked = pending.findAll('input[data-test^="scope-"]').filter((box) => box.element.checked).map((box) => box.attributes('data-test'));
        expect(checked).toEqual(['scope-tasks:read', 'scope-tasks:write']);
        expect(pending.find('input[data-test="private-sprints"]').element.checked).toBe(false);
        await pending.find('input[data-test="scope-tasks:write"]').setValue(false);
        await pending.find('input[data-test="scope-docs:read"]').setValue(true);
        await pending.find('input[data-test="private-sprints"]').setValue(true);
        await pending.find('button[data-test="approve"]').trigger('click');
        await flushPromises();
        expect(posts()).toEqual([['post', '/api/v2/oauth-client-approvals/approve', { clientId: 'ahc_0123456789abcdef01234567', scopes: ['tasks:read', 'docs:read'], privateSprints: true }]]);
        expect(apiRequest.mock.calls.filter(([type]) => type === 'get')).toHaveLength(2);
    });

    it('will not approve with no scope checked', async () => {
        const wrapper = await mountWith();
        const pending = wrapper.find('[data-test="pending-row"]');
        await pending.find('input[data-test="scope-tasks:read"]').setValue(false);
        await pending.find('input[data-test="scope-tasks:write"]').setValue(false);
        expect(pending.find('button[data-test="approve"]').attributes('disabled')).toBeDefined();
    });

    it('denies a pending request', async () => {
        const wrapper = await mountWith();
        await wrapper.find('[data-test="pending-row"] button[data-test="deny"]').trigger('click');
        await flushPromises();
        expect(posts()).toEqual([['post', '/api/v2/oauth-client-approvals/deny', { clientId: 'ahc_0123456789abcdef01234567' }]]);
    });

    it('revokes an approved client after a confirmation that says its grants go too', async () => {
        const wrapper = await mountWith();
        await wrapper.find('[data-test="approved-row"] button[data-test="revoke"]').trigger('click');
        await flushPromises();
        expect(window.confirm).toHaveBeenCalledWith('AgentClients.revoke_confirm');
        expect(posts()).toEqual([['post', '/api/v2/oauth-client-approvals/revoke', { clientId: CIMD }]]);
    });

    it('does nothing when the revoke is not confirmed', async () => {
        window.confirm.mockReturnValue(false);
        const wrapper = await mountWith();
        await wrapper.find('[data-test="approved-row"] button[data-test="revoke"]').trigger('click');
        await flushPromises();
        expect(posts()).toEqual([]);
    });

    it('shows the server refusal when an action fails', async () => {
        const wrapper = await mountWith({ post: () => Promise.reject({ response: { status: 400, data: { status: false, statusText: 'scopes must be drawn from the list' } } }) });
        await wrapper.find('[data-test="pending-row"] button[data-test="approve"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="action-error"]').text()).toContain('scopes must be drawn from the list');
    });

    it('says so when outside agent sign-in is off on this server', async () => {
        const wrapper = await mountWith({ rows: () => Promise.reject({ response: { status: 404, data: 'Cannot GET' } }) });
        expect(wrapper.find('[data-test="oauth-off"]').text()).toBe('AgentClients.off');
    });

    it('shows an empty state with no request and no approval', async () => {
        const wrapper = await mountWith({ rows: [] });
        expect(wrapper.find('[data-test="empty"]').text()).toBe('AgentClients.empty');
    });
});
