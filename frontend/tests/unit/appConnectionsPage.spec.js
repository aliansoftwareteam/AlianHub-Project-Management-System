import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest, route, replace } = vi.hoisted(() => ({ apiRequest: vi.fn(), route: { query: {} }, replace: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRoute: () => route, useRouter: () => ({ replace }) }));

import AppConnections from '@/views/Integrations/AppConnections.vue';
import en from '@/locales/en.js';
import integrationRoutes from '@/router/integrations';
import { loginReturnPath } from '@/views/Integrations/githubReturn';

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
    beforeEach(() => { apiRequest.mockReset(); replace.mockReset(); route.query = {}; });

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
        const openWith = async (oneClick, connections = [], { setup, canManage = true } = {}) => {
            const app = { ...github, oneClick, connections, ...(setup ? { setup } : {}) };
            apiRequest.mockResolvedValue({ data: { status: true, data: { enabled: true, canManage, apps: [app], projects: [] } } });
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
            expect(wrapper.find('[data-github-setup]').exists()).toBe(false);
            vi.unstubAllGlobals();
        });

        it('shows an owner the setup steps with both addresses, and the token form only behind the link, when the server has no GitHub app', async () => {
            const setup = { homepageUrl: 'https://pm.example.com', callbackUrl: 'https://api.example.com/api/v1/github-connect/callback' };
            const wrapper = await openWith(false, [], { setup });
            const calls = apiRequest.mock.calls.length;
            await connectButton(wrapper).trigger('click');
            expect(apiRequest.mock.calls.length).toBe(calls);
            const panel = wrapper.find('[data-github-setup]');
            expect(panel.text()).toContain(en.AppConnections.github_setup_title);
            expect(panel.find('[data-url="homepage"]').text()).toBe(setup.homepageUrl);
            expect(panel.find('[data-url="callback"]').text()).toBe(setup.callbackUrl);
            expect(panel.text()).toContain('GITHUB_CONNECT_CLIENT_ID');
            expect(wrapper.findAll('[data-app="github"] .ah-field').length).toBe(0);

            const writeText = vi.fn().mockResolvedValue();
            vi.stubGlobal('navigator', { clipboard: { writeText } });
            await panel.findAll('button').find((b) => b.text() === en.AppConnections.copy).trigger('click');
            await flushPromises();
            expect(writeText).toHaveBeenCalledWith(setup.homepageUrl);
            vi.unstubAllGlobals();

            await wrapper.find('[data-use-token]').trigger('click');
            const labels = wrapper.findAll('[data-app="github"] .ah-field .ah-label').map((l) => l.text());
            expect(labels).toEqual([en.AppConnections.field_github_token, en.AppConnections.field_github_repo]);
            expect(wrapper.find('[data-github-setup]').exists()).toBe(false);
        });

        it('tells a member to ask an admin when the server has no GitHub app', async () => {
            const wrapper = await openWith(false, [], { canManage: false });
            expect(wrapper.find('[data-app="github"] [data-ask-admin]').text()).toBe(en.AppConnections.github_ask_admin);
            expect(wrapper.findAll('[data-app="github"] button').length).toBe(0);
            expect(wrapper.find('[data-github-setup]').exists()).toBe(false);
        });

        it('finishes a GitHub sign-in on the signed-in page and takes the code out of the address first', async () => {
            route.query = { github: 'complete', state: 'signed', code: 'abc', tab: 'x' };
            apiRequest.mockImplementation(async (method) => (method === 'post'
                ? { data: { status: true, data: { id: 'c1', repo: '' } } }
                : { data: { status: true, data: { enabled: true, canManage: true, apps: [{ ...github, oneClick: true }], projects: [] } } }));
            const wrapper = mount(AppConnections, { global: { mocks: { $t: i18n.global.t } } });
            await flushPromises();
            expect(replace).toHaveBeenCalledWith({ query: { tab: 'x' } });
            expect(apiRequest).toHaveBeenCalledWith('post', expect.stringMatching(/\/github\/complete$/), { state: 'signed', code: 'abc' });
            expect(wrapper.find('[data-notice]').text()).toBe(en.AppConnections.github_connected);
        });

        it('words a refused sign-in from the locale, not from the server', async () => {
            route.query = { github: 'complete', state: 'signed', code: 'abc' };
            apiRequest.mockImplementation(async (method) => {
                if (method === 'post') throw Object.assign(new Error('x'), { response: { status: 400, data: { statusText: 'Server words' } } });
                return { data: { status: true, data: { enabled: true, canManage: true, apps: [{ ...github, oneClick: true }], projects: [] } } };
            });
            const wrapper = mount(AppConnections, { global: { mocks: { $t: i18n.global.t } } });
            await flushPromises();
            expect(wrapper.text()).toContain(en.AppConnections.github_expired);
            expect(wrapper.text()).not.toContain('Server words');
        });

        it('says one-click is off when the server answers that it is not set up', async () => {
            const wrapper = await openWith(true);
            apiRequest.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 409, data: { statusText: 'Server words' } } }));
            await connectButton(wrapper).trigger('click');
            await flushPromises();
            expect(wrapper.text()).toContain(en.AppConnections.github_off);
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

    it('leaves a GitHub code and state out of the address a lapsed session returns to', () => {
        const to = { path: '/c1/app-connections', fullPath: '/c1/app-connections?github=complete&state=s&code=k&tab=x', query: { github: 'complete', state: 's', code: 'k', tab: 'x' } };
        expect(loginReturnPath(to)).toBe('/c1/app-connections?tab=x');
        expect(loginReturnPath({ path: '/c1/home', fullPath: '/c1/home?a=1', query: { a: '1' } })).toBe('/c1/home?a=1');
    });

    it('has a title that goes through the locale', () => {
        const route = integrationRoutes.find((r) => r.name === 'AppConnections');
        expect(route.meta.titleKey).toBe('AppConnections.title');
        expect(route.meta.title).toBeUndefined();
    });
});
