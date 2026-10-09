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

    describe('Connect on GitHub', () => {
        const openWith = async (oneClick, connections = []) => {
            const app = { ...github, oneClick, connections };
            apiRequest.mockResolvedValue({ data: { status: true, data: { enabled: true, canManage: true, apps: [app], projects: [] } } });
            const wrapper = mount(AppConnections, { global: { mocks: { $t: i18n.global.t } } });
            await flushPromises();
            return wrapper;
        };
        const connectButton = (wrapper) => wrapper.findAll('[data-app="github"] button').find((b) => b.text() === en.AppConnections.connect);

        it('sends the person to GitHub sign-in when the server has a GitHub app', async () => {
            const assign = vi.fn();
            vi.stubGlobal('location', { ...window.location, assign, search: '' });
            const wrapper = await openWith(true);
            apiRequest.mockResolvedValueOnce({ data: { status: true, data: { url: 'https://github.com/login/oauth/authorize?state=s' } } });
            await connectButton(wrapper).trigger('click');
            await flushPromises();
            expect(apiRequest).toHaveBeenLastCalledWith('get', expect.stringMatching(/\/github\/authorize$/));
            expect(assign).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?state=s');
            expect(wrapper.find('[data-app="github"] form').exists()).toBe(false);
            vi.unstubAllGlobals();
        });

        it('asks for a token and the repository, with a note on one-click, when the server has none', async () => {
            const wrapper = await openWith(false);
            const calls = apiRequest.mock.calls.length;
            await connectButton(wrapper).trigger('click');
            expect(apiRequest.mock.calls.length).toBe(calls);
            const labels = wrapper.findAll('[data-app="github"] .ah-field .ah-label').map((l) => l.text());
            expect(labels).toEqual([en.AppConnections.field_github_token, en.AppConnections.field_github_repo]);
            expect(wrapper.find('[data-one-click-off]').text()).toBe(en.AppConnections.one_click_off);
        });

        it('offers a repository picker on a connection made through sign-in', async () => {
            const wrapper = await openWith(true, [{ ...github.connections[0], target: '', viaOAuth: true }]);
            expect(wrapper.text()).toContain(en.AppConnections.repo_needed);
            apiRequest.mockResolvedValueOnce({ data: { status: true, data: { repos: [{ fullName: 'acme/web', private: true }], page: 1, hasMore: false } } });
            await wrapper.findAll('button').find((b) => b.text() === en.AppConnections.pick_repo).trigger('click');
            await flushPromises();
            expect(apiRequest).toHaveBeenLastCalledWith('get', expect.stringMatching(/\/connections\/c1\/github-repos\?page=1$/));
            await wrapper.find('input[type="radio"][value="acme/web"]').setValue(true);
            apiRequest.mockResolvedValueOnce({ data: { status: true, data: { id: 'c1', repo: 'acme/web' } } });
            await wrapper.findAll('.apc__repos button').find((b) => b.text() === en.AppConnections.save).trigger('click');
            await flushPromises();
            expect(apiRequest).toHaveBeenCalledWith('put', expect.stringMatching(/\/connections\/c1\/repo$/), { repo: 'acme/web' });
        });
    });

    it('has a title that goes through the locale', () => {
        const route = integrationRoutes.find((r) => r.name === 'AppConnections');
        expect(route.meta.titleKey).toBe('AppConnections.title');
        expect(route.meta.title).toBeUndefined();
    });
});
