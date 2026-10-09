import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));

import AppConnections from '@/views/Integrations/AppConnections.vue';
import en from '@/locales/en.js';
import integrationRoutes from '@/router/integrations';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const github = {
    key: 'github', name: 'GitHub', icon: 'G', description: 'Server English', multiple: false, syncs: true,
    fields: [{ key: 'token', label: 'Server token label', secret: true, required: true }, { key: 'repo', label: 'Server repo label', required: true }],
    connections: [{ id: 'c1', enabled: true, status: 'connected', target: 'acme/web', lastSyncAt: null, lastError: '', projects: [{ id: 'p1', name: 'Web' }], hiddenProjects: 2 }],
};
const gitlab = { ...github, key: 'gitlab', name: 'GitLab', syncs: false, connections: [], fields: [{ key: 'token', label: 'Server', secret: true }, { key: 'project', label: 'Server' }] };

const open = async (canManage) => {
    apiRequest.mockResolvedValue({ data: { status: true, data: { enabled: true, canManage, apps: [github, gitlab], projects: [{ id: 'p1', name: 'Web' }] } } });
    const wrapper = mount(AppConnections, { global: { mocks: { $t: i18n.global.t } } });
    await flushPromises();
    return wrapper;
};
const buttons = (wrapper) => wrapper.findAll('button').map((b) => b.text());

describe('the App connections page', () => {
    beforeEach(() => { apiRequest.mockReset(); });

    it('shows a member the status alone, with no button that changes a connection', async () => {
        const wrapper = await open(false);
        expect(buttons(wrapper)).toEqual([]);
        expect(wrapper.text()).toContain(en.AppConnections.read_only);
        expect(wrapper.text()).toContain(en.AppConnections.state_connected);
        expect(wrapper.text()).toContain('Web');
        expect(wrapper.text()).toContain('2 more projects you cannot open');
    });

    it('gives an owner or admin Connect, Pause, Disconnect and Link projects', async () => {
        const wrapper = await open(true);
        expect(buttons(wrapper)).toEqual(expect.arrayContaining([en.AppConnections.connect, en.AppConnections.pause, en.AppConnections.disconnect, en.AppConnections.link_projects]));
        expect(wrapper.text()).not.toContain(en.AppConnections.read_only);
    });

    it('words the description and the fields from the locale, not from the server', async () => {
        const wrapper = await open(true);
        expect(wrapper.text()).toContain(en.AppConnections.desc_github);
        expect(wrapper.text()).not.toContain('Server English');
        await wrapper.find('[data-app="gitlab"] button').trigger('click');
        const labels = wrapper.findAll('[data-app="gitlab"] .ah-field .ah-label').map((l) => l.text());
        expect(labels).toEqual([en.AppConnections.field_gitlab_token, en.AppConnections.field_gitlab_project]);
    });

    it('has a title that goes through the locale', () => {
        const route = integrationRoutes.find((r) => r.name === 'AppConnections');
        expect(route.meta.titleKey).toBe('AppConnections.title');
        expect(route.meta.title).toBeUndefined();
    });
});
