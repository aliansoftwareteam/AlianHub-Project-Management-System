import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest, apiRequestWithoutCompnay, route, replace } = vi.hoisted(() => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn(), route: { query: {}, params: {} }, replace: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
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
    connections: [{
        id: 'c1', enabled: true, status: 'connected', target: '', lastSyncAt: null, lastError: '', projects: [{ id: 'p1', name: 'Web' }], hiddenProjects: 2,
        repos: [{ repo: 'acme/web', projectId: 'p1', projectName: 'Web', hidden: false, lastError: '' }],
    }],
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

    it('gives an owner or admin Connect, Pause, Disconnect, Add repository and Remove', async () => {
        const wrapper = await open(true);
        expect(buttons(wrapper)).toEqual(expect.arrayContaining([en.AppConnections.connect, en.AppConnections.pause, en.AppConnections.disconnect, en.AppConnections.repo_add, en.AppConnections.repo_remove]));
        expect(buttons(wrapper)).not.toContain(en.AppConnections.link_projects);
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
        const openWith = async (oneClick, connections = [], { setup, canManage = true, projects = [] } = {}) => {
            const app = { ...github, oneClick, connections, ...(setup ? { setup } : {}) };
            apiRequest.mockResolvedValue({ data: { status: true, data: { enabled: true, canManage, apps: [app], projects } } });
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
            expect(wrapper.find('[data-notice]').text()).toBe(en.AppConnections.github_connected_projects);
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

        it('shows the Project to Repository table, adds a pair through the picker and removes one', async () => {
            const wrapper = await openWith(true, [{ ...github.connections[0], viaOAuth: true }], { projects: [{ id: 'p1', name: 'Web' }] });
            const rows = wrapper.findAll('[data-repo-row]');
            expect(rows.map((r) => r.text())).toEqual([expect.stringContaining('Web')]);
            expect(rows[0].text()).toContain('acme/web');
            apiRequest.mockResolvedValueOnce({ data: { status: true, data: { repos: [{ fullName: 'acme/api', private: true }], page: 1, hasMore: false } } });
            await wrapper.find('[data-add-repo]').trigger('click');
            await flushPromises();
            expect(apiRequest).toHaveBeenLastCalledWith('get', expect.stringMatching(/\/connections\/c1\/github-repos\?page=1$/));
            await wrapper.find('input[type="radio"][value="acme/api"]').setValue(true);
            const save = () => wrapper.find('[data-repo-save]');
            expect(save().attributes('disabled')).toBeDefined();
            await wrapper.find('[data-project-select]').setValue('p1');
            expect(save().attributes('disabled')).toBeUndefined();
            apiRequest.mockResolvedValueOnce({ data: { status: true, data: { id: 'c1', repo: 'acme/api', projectId: 'p1' } } });
            await save().trigger('click');
            await flushPromises();
            expect(apiRequest).toHaveBeenCalledWith('post', expect.stringMatching(/\/connections\/c1\/repos$/), { repo: 'acme/api', projectId: 'p1' });
            expect(wrapper.find('[data-repo-picker]').exists()).toBe(false);

            await wrapper.find('[data-remove-repo]').trigger('click');
            await flushPromises();
            expect(apiRequest).toHaveBeenCalledWith('delete', expect.stringMatching(/\/connections\/c1\/repos\/p1\?repo=acme%2Fweb$/));
        });

        it('says when no repository feeds any project yet', async () => {
            const wrapper = await openWith(true, [{ ...github.connections[0], repos: [] }]);
            expect(wrapper.find('[data-no-repos]').text()).toBe(en.AppConnections.repo_none_mapped);
        });

        it('keeps Save, Cancel and Show more outside the scrolling list, and filters the list by name', async () => {
            const wrapper = await openWith(true, [{ ...github.connections[0], target: '', viaOAuth: true }]);
            const many = Array.from({ length: 30 }, (_, i) => ({ fullName: `acme/repo-${i}`, private: false }));
            apiRequest.mockResolvedValueOnce({ data: { status: true, data: { repos: [...many, { fullName: 'acme/Billing', private: true }], page: 1, hasMore: true } } });
            await wrapper.find('[data-add-repo]').trigger('click');
            await flushPromises();
            const list = wrapper.find('[data-repo-list]');
            const actions = wrapper.find('[data-repo-actions]');
            expect(list.classes()).toContain('grp__list');
            expect(list.findAll('button')).toHaveLength(0);
            expect(list.element.contains(actions.element)).toBe(false);
            expect(actions.findAll('button').map((b) => b.text())).toEqual([en.AppConnections.more_repos, en.AppConnections.save, en.AppConnections.cancel]);
            expect(list.element.contains(wrapper.find('[data-repo-filter]').element)).toBe(false);
            expect(wrapper.find('[data-repo-filter]').attributes('placeholder')).toBe(en.AppConnections.repo_filter);
            expect(list.findAll('input[type="radio"]')).toHaveLength(31);

            await wrapper.find('[data-repo-filter]').setValue('bill');
            expect(list.findAll('input[type="radio"]').map((r) => r.element.value)).toEqual(['acme/Billing']);
            await wrapper.find('[data-repo-filter]').setValue('nothing-like-it');
            expect(list.findAll('input[type="radio"]')).toHaveLength(0);
            expect(wrapper.find('[data-no-match]').text()).toBe(en.AppConnections.no_repo_match);
        });
    });

    describe('when the workspace egress allowlist leaves GitHub out', () => {
        const CID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
        const blocked = Object.assign(new Error('x'), { response: { status: 409, data: { status: false, code: 'egress_blocked', statusText: 'Server words', data: { host: 'api.github.com' } } } });
        const openBlocked = async ({ canManage = true, owner = true, put } = {}) => {
            route.params = { cid: CID };
            const app = { ...github, oneClick: true, connections: [{ ...github.connections[0], target: '', viaOAuth: true }] };
            apiRequest.mockResolvedValue({ data: { status: true, data: { enabled: true, canManage, apps: [app], projects: [{ id: 'p1', name: 'Web' }] } } });
            apiRequestWithoutCompnay.mockImplementation(async (method, url) => {
                if (url.endsWith('/instance/access')) {
                    if (owner) return { data: { status: true, data: { allowed: true } } };
                    throw Object.assign(new Error('x'), { response: { status: 403 } });
                }
                if (method === 'get') return { data: { status: true, data: { workspaces: [{ companyId: CID, hosts: ['docs.example.com'], version: 3 }] } } };
                if (put) return put();
                return { data: { status: true, data: {} } };
            });
            const wrapper = mount(AppConnections, { global: { mocks: { $t: i18n.global.t } } });
            await flushPromises();
            apiRequest.mockRejectedValueOnce(blocked);
            await wrapper.find('[data-add-repo]').trigger('click');
            await flushPromises();
            return wrapper;
        };
        const blockedText = () => en.AppConnections.egress_blocked.replace('{host}', 'api.github.com');

        beforeEach(() => { apiRequestWithoutCompnay.mockReset(); });

        it('says so in plain words instead of a generic failure, and offers the instance owner a button', async () => {
            const wrapper = await openBlocked();
            const panel = wrapper.find('[data-egress-blocked]');
            expect(panel.text()).toContain(blockedText());
            expect(wrapper.text()).not.toContain('Server words');
            expect(wrapper.find('[role="alert"]').exists()).toBe(false);
            expect(panel.find('[data-allow-host]').text()).toBe(en.AppConnections.egress_allow.replace('{host}', 'api.github.com'));
            expect(panel.find('[data-egress-settings]').exists()).toBe(true);
            expect(panel.find('[data-ask-owner]').exists()).toBe(false);
        });

        it('adds only api.github.com to the workspace list through the egress endpoint, then loads the repositories again', async () => {
            const wrapper = await openBlocked();
            apiRequest.mockResolvedValueOnce({ data: { status: true, data: { repos: [{ fullName: 'acme/web', private: true }], page: 1, hasMore: false } } });
            await wrapper.find('[data-allow-host]').trigger('click');
            await flushPromises();
            expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('get', `/api/v2/instance/egress?workspace=${CID}`);
            expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('put', `/api/v2/instance/egress/${CID}`, { hosts: ['docs.example.com', 'api.github.com'], version: 3 });
            expect(apiRequest).toHaveBeenLastCalledWith('get', expect.stringMatching(/\/connections\/c1\/github-repos\?page=1$/));
            expect(wrapper.find('[data-egress-blocked]').exists()).toBe(false);
            expect(wrapper.find('input[type="radio"][value="acme/web"]').exists()).toBe(true);
        });

        it('says the host could not be allowed and loads no repositories when the save is refused as stale', async () => {
            const stale = Object.assign(new Error('x'), { response: { status: 409, data: { status: false, code: 'stale_version', statusText: 'Server words' } } });
            const wrapper = await openBlocked({ put: () => { throw stale; } });
            const reads = apiRequest.mock.calls.length;
            await wrapper.find('[data-allow-host]').trigger('click');
            await flushPromises();
            expect(wrapper.find('[role="alert"]').text()).toBe(en.AppConnections.egress_allow_failed.replace('{host}', 'api.github.com'));
            expect(apiRequest.mock.calls.length).toBe(reads);
            expect(wrapper.find('[data-egress-blocked]').exists()).toBe(true);
        });

        it('offers only the settings link for a host other than api.github.com', async () => {
            route.params = { cid: CID };
            const conn = { ...github.connections[0], errorCode: 'egress_blocked', blockedHost: 'uploads.github.com' };
            apiRequest.mockResolvedValue({ data: { status: true, data: { enabled: true, canManage: true, apps: [{ ...github, connections: [conn] }], projects: [] } } });
            apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { allowed: true } } });
            const wrapper = mount(AppConnections, { global: { mocks: { $t: i18n.global.t } } });
            await flushPromises();
            const panel = wrapper.find('[data-egress-blocked]');
            expect(panel.find('[data-allow-host]').exists()).toBe(false);
            expect(panel.find('[data-egress-settings]').exists()).toBe(true);
        });

        it('a repository save refused by egress shows the blocked state, not a saved one', async () => {
            const wrapper = await openBlocked();
            apiRequest.mockResolvedValueOnce({ data: { status: true, data: { repos: [{ fullName: 'acme/web', private: true }], page: 1, hasMore: false } } });
            await wrapper.find('[data-allow-host]').trigger('click');
            await flushPromises();
            await wrapper.find('input[type="radio"][value="acme/web"]').setValue(true);
            await wrapper.find('[data-project-select]').setValue('p1');
            const reads = apiRequest.mock.calls.length;
            apiRequest.mockRejectedValueOnce(blocked);
            await wrapper.findAll('[data-repo-actions] button').find((b) => b.text() === en.AppConnections.save).trigger('click');
            await flushPromises();
            expect(apiRequest.mock.calls.length).toBe(reads + 1);
            expect(wrapper.find('[data-egress-blocked]').exists()).toBe(true);
            expect(wrapper.find('[role="alert"]').exists()).toBe(false);
        });

        it('tells anyone who cannot edit egress to ask the instance owner, with no button', async () => {
            const wrapper = await openBlocked({ owner: false });
            const panel = wrapper.find('[data-egress-blocked]');
            expect(panel.text()).toContain(blockedText());
            expect(panel.find('[data-ask-owner]').text()).toBe(en.AppConnections.egress_ask_owner.replace('{host}', 'api.github.com'));
            expect(panel.find('[data-allow-host]').exists()).toBe(false);
            expect(apiRequestWithoutCompnay.mock.calls.filter(([method]) => method === 'put')).toEqual([]);
        });

        it('shows a member the blocked state the sync recorded, worded from the locale', async () => {
            route.params = { cid: CID };
            const conn = { ...github.connections[0], lastError: 'Server words', errorCode: 'egress_blocked', blockedHost: 'api.github.com' };
            apiRequest.mockResolvedValue({ data: { status: true, data: { enabled: true, canManage: false, apps: [{ ...github, connections: [conn] }], projects: [] } } });
            apiRequestWithoutCompnay.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 403 } }));
            const wrapper = mount(AppConnections, { global: { mocks: { $t: i18n.global.t } } });
            await flushPromises();
            expect(wrapper.find('[data-ask-owner]').exists()).toBe(true);
            expect(wrapper.text()).not.toContain('Server words');
            expect(buttons(wrapper)).toEqual([]);
        });

        it('shows the state right after the GitHub sign-in, before any repository list is asked for', async () => {
            route.params = { cid: CID };
            route.query = { github: 'complete', state: 's', code: 'k' };
            const app = { ...github, oneClick: true, connections: [{ ...github.connections[0], target: '', viaOAuth: true }] };
            apiRequest.mockImplementation(async (method) => (method === 'post'
                ? { data: { status: true, data: { id: 'c1', repo: '', account: '', egressBlocked: { host: 'api.github.com' } } } }
                : { data: { status: true, data: { enabled: true, canManage: true, apps: [app], projects: [] } } }));
            apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, data: { allowed: true } } });
            const wrapper = mount(AppConnections, { global: { mocks: { $t: i18n.global.t } } });
            await flushPromises();
            expect(wrapper.find('[data-egress-blocked]').text()).toContain(blockedText());
            expect(wrapper.find('[data-allow-host]').exists()).toBe(true);
            expect(apiRequest.mock.calls.some(([, url]) => /github-repos/.test(url))).toBe(false);
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
