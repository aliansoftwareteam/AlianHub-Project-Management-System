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

const mountWith = async ({ rows = grants(), remove } = {}) => {
    apiRequest.mockImplementation((type, url) => {
        if (type === 'get') return typeof rows === 'function' ? rows() : ok(rows);
        if (type === 'delete') return remove ? remove(url) : ok({});
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

    it('shows an empty state', async () => {
        const wrapper = await mountWith({ rows: [] });
        expect(wrapper.find('[data-test="no-grants"]').text()).toBe('ConnectedApps.empty');
    });
});
