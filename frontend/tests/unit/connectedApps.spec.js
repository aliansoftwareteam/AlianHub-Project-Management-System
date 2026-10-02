import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import ConnectedApps from '@/views/Ai/ConnectedApps.vue';

const WHEN = '2026-09-21T10:00:00.000Z';

const grants = () => [
    { grantId: 'g1', clientId: 'ahc_0123456789abcdef01234567', clientName: 'Claude Code', companyId: 'c1', workspaceName: 'Alpha Works', scopes: ['tasks:read', 'tasks:write'], createdAt: WHEN, lastUsedAt: WHEN, expiresAt: WHEN },
    { grantId: 'g2', clientId: 'https://agent.example/client.json', clientName: 'Doc agent', companyId: 'c2', workspaceName: 'Beta Labs', scopes: ['docs:read'], createdAt: WHEN, lastUsedAt: null, expiresAt: WHEN },
];

const ok = (data) => Promise.resolve({ data: { status: true, data } });

const mountWith = async ({ rows = grants(), remove, withdraw } = {}) => {
    apiRequest.mockImplementation((type, url, body) => {
        if (type === 'get') return typeof rows === 'function' ? rows() : ok(rows);
        if (type === 'delete') return remove ? remove(url) : ok({});
        if (type === 'post') return withdraw ? withdraw(url, body) : ok({});
        return Promise.reject(new Error(`unexpected ${type} ${url}`));
    });
    const wrapper = mount(ConnectedApps);
    await flushPromises();
    return wrapper;
};

describe('Accounts > Connected apps', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        vi.spyOn(window, 'confirm').mockReturnValue(true);
    });

    it('lists each grant with its client, workspace, scopes and last use', async () => {
        const wrapper = await mountWith();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/oauth-grants');
        const rows = wrapper.findAll('[data-test="grant-row"]');
        expect(rows).toHaveLength(2);
        expect(rows[0].text()).toContain('Claude Code');
        expect(rows[0].text()).toContain('Alpha Works');
        expect(rows[0].findAll('[data-test="grant-scope"]').map((chip) => chip.text())).toEqual(['OAuthConsent.scope_name_tasks_read', 'OAuthConsent.scope_name_tasks_write']);
        expect(rows[0].find('[data-test="last-used"]').text()).not.toBe('ConnectedApps.never_used');
        expect(rows[1].find('[data-test="last-used"]').text()).toBe('ConnectedApps.never_used');
    });

    it('says when each connection ends and that connecting again renews it', async () => {
        const wrapper = await mountWith({ rows: [...grants(), { ...grants()[0], grantId: 'g3', expiresAt: null }] });
        const rows = wrapper.findAll('[data-test="grant-row"]');
        expect(rows[0].find('[data-test="grant-ends"]').text()).toBe('ConnectedApps.ends');
        expect(rows[2].find('[data-test="grant-ends"]').exists()).toBe(false);
    });

    it('revokes a grant after confirmation and drops it from the list', async () => {
        const wrapper = await mountWith();
        await wrapper.findAll('[data-test="grant-row"]')[0].find('button[data-test="revoke-grant"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('delete', '/api/v2/oauth-grants/g1');
        expect(wrapper.findAll('[data-test="grant-row"]')).toHaveLength(1);
    });

    it('keeps the grant when the revoke is not confirmed', async () => {
        window.confirm.mockReturnValue(false);
        const wrapper = await mountWith();
        await wrapper.findAll('[data-test="grant-row"]')[0].find('button[data-test="revoke-grant"]').trigger('click');
        await flushPromises();
        expect(apiRequest.mock.calls.filter(([type]) => type === 'delete')).toEqual([]);
        expect(wrapper.findAll('[data-test="grant-row"]')).toHaveLength(2);
    });

    it('keeps the grant and says why when the server refuses', async () => {
        const wrapper = await mountWith({ remove: () => Promise.reject({ response: { status: 404, data: { status: false, statusText: 'No such grant.' } } }) });
        await wrapper.findAll('[data-test="grant-row"]')[0].find('button[data-test="revoke-grant"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="grant-error"]').text()).toContain('No such grant.');
        expect(wrapper.findAll('[data-test="grant-row"]')).toHaveLength(2);
    });

    it('offers to withdraw a manage permission on its own, and none where a grant holds none', async () => {
        const managing = [{ ...grants()[0], scopes: ['tasks:read', 'tasks:manage', 'docs:manage'] }, grants()[1]];
        const wrapper = await mountWith({ rows: managing });
        const rows = wrapper.findAll('[data-test="grant-row"]');
        expect(rows[0].findAll('[data-test="grant-manage"]').map((line) => line.text())).toEqual([
            'OAuthConsent.scope_tasks_manageConnectedApps.withdraw', 'OAuthConsent.scope_docs_manageConnectedApps.withdraw',
        ]);
        expect(rows[1].findAll('[data-test="grant-manage"]')).toHaveLength(0);

        await rows[0].find('button[data-test="withdraw-tasks:manage"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/oauth-grants/g1/withdraw', { scopes: ['tasks:manage'] });
        const after = wrapper.findAll('[data-test="grant-row"]');
        expect(after).toHaveLength(2);
        expect(after[0].findAll('[data-test="grant-scope"]').map((chip) => chip.text())).toEqual(['OAuthConsent.scope_name_tasks_read', 'OAuthConsent.scope_name_docs_manage']);
        expect(after[0].find('button[data-test="withdraw-tasks:manage"]').exists()).toBe(false);
    });

    it('keeps the permission and says why when the server refuses to withdraw it', async () => {
        const managing = [{ ...grants()[0], scopes: ['tasks:read', 'tasks:manage'] }];
        const wrapper = await mountWith({ rows: managing, withdraw: () => Promise.reject({ response: { status: 404, data: { status: false, statusText: 'No such permission on a connected app.' } } }) });
        await wrapper.find('button[data-test="withdraw-tasks:manage"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="grant-error"]').text()).toContain('No such permission');
        expect(wrapper.find('button[data-test="withdraw-tasks:manage"]').exists()).toBe(true);
    });

    it('shows an empty state', async () => {
        const wrapper = await mountWith({ rows: [] });
        expect(wrapper.find('[data-test="no-grants"]').text()).toBe('ConnectedApps.empty');
    });
});
