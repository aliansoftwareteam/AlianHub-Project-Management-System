import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';

const { apiRequest, apiRequestWithoutCompnay, route, replace, push } = vi.hoisted(() => ({
    apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn(), route: { query: {}, params: {} }, replace: vi.fn(), push: vi.fn(),
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal()), useRoute: () => route, useRouter: () => ({ replace, push }) }));

import ProjectGithubCard from '@/views/Projects/ProjectDetail/ProjectGithubCard.vue';
import ProjectGithubChip from '@/views/Projects/components/ProjectGithubChip.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const CID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const PID = 'bbbbbbbbbbbbbbbbbbbbbb01';
const CONNECTION = { id: 'c1', enabled: true, viaOAuth: true, account: 'octo', reachable: true, errorCode: '', blockedHost: '' };

const viewOf = (over = {}) => ({ data: { status: true, data: { enabled: true, canManage: true, oneClick: true, connection: CONNECTION, repos: [], ...over } } });
const reposPage = (names) => ({ data: { status: true, data: { repos: names.map((fullName) => ({ fullName, private: false })), page: 1, hasMore: false } } });

/* Answers each address the card reads; anything else is a write, answered by `writes`. */
const serve = (view, { repos = [], writes = () => ({ data: { status: true, data: {} } }) } = {}) => apiRequest.mockImplementation(async (method, url, body) => {
    if (method === 'get' && url.includes('/github/projects/')) return typeof view === 'function' ? view() : view;
    if (method === 'get' && url.includes('/github-repos')) return reposPage(repos);
    return writes(method, url, body);
});

const mountCard = async () => {
    const wrapper = mount(ProjectGithubCard, {
        props: { projectId: PID },
        global: { mocks: { $t: i18n.global.t }, stubs: { 'router-link': { props: ['to'], template: '<a data-link><slot /></a>' } } },
    });
    await flushPromises();
    return wrapper;
};
const buttons = (wrapper) => wrapper.findAll('button').map((b) => b.text());

beforeEach(() => {
    apiRequest.mockReset();
    apiRequestWithoutCompnay.mockReset();
    apiRequestWithoutCompnay.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 403 } }));
    replace.mockReset();
    push.mockReset();
    route.query = {};
    route.params = { cid: CID, id: PID };
});
afterEach(() => vi.unstubAllGlobals());

describe('the project GitHub card', () => {
    it('offers an owner or admin Connect GitHub when the workspace is not signed in, starting a sign-in that returns to this project', async () => {
        const assign = vi.fn();
        vi.stubGlobal('location', { ...window.location, assign });
        serve(viewOf({ connection: null }), { writes: () => ({ data: { status: true, data: { url: 'https://github.com/login/oauth/authorize?state=s' } } }) });
        const wrapper = await mountCard();
        expect(wrapper.find('h5').text()).toBe(en.ProjectGithub.title);
        expect(buttons(wrapper)).toEqual([en.ProjectGithub.connect]);
        await wrapper.find('[data-connect-github]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenLastCalledWith('get', expect.stringMatching(new RegExp(`/github/authorize\\?projectId=${PID}$`)));
        expect(assign).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?state=s');
    });

    it('tells anyone else to ask an admin, with no button', async () => {
        serve(viewOf({ connection: null, canManage: false }));
        const wrapper = await mountCard();
        expect(wrapper.find('[data-ask-admin]').text()).toBe(en.ProjectGithub.ask_admin);
        expect(buttons(wrapper)).toEqual([]);
    });

    it('sends an admin to App connections when the server has no GitHub app yet', async () => {
        serve(viewOf({ connection: null, oneClick: false }));
        const wrapper = await mountCard();
        expect(wrapper.find('[data-set-up]').text()).toBe(en.ProjectGithub.set_up);
        expect(buttons(wrapper)).toEqual([]);
    });

    it('says when no repository feeds the project, and offers Add repository', async () => {
        serve(viewOf());
        const wrapper = await mountCard();
        expect(wrapper.find('[data-no-repos]').text()).toBe(en.ProjectGithub.none);
        expect(buttons(wrapper)).toEqual([en.ProjectGithub.add]);
    });

    it('adds a repository picked from the searchable list, with Save outside the list, and removes one', async () => {
        let mapped = [];
        serve(() => viewOf({ repos: mapped.map((repo) => ({ repo, lastError: '' })) }), {
            repos: ['acme/web', 'acme/api'],
            writes: (method, url, body) => {
                if (method === 'post') mapped = [...mapped, body.repo];
                if (method === 'delete') mapped = [];
                return { data: { status: true, data: {} } };
            },
        });
        const wrapper = await mountCard();
        await wrapper.find('[data-add-repo]').trigger('click');
        await flushPromises();
        await wrapper.find('[data-repo-filter]').setValue('api');
        expect(wrapper.findAll('[data-repo-list] input[type="radio"]').map((r) => r.element.value)).toEqual(['acme/api']);
        expect(wrapper.find('[data-repo-list]').element.contains(wrapper.find('[data-repo-save]').element)).toBe(false);
        await wrapper.find('input[type="radio"][value="acme/api"]').setValue(true);
        await wrapper.find('[data-repo-save]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v1/integrations/connections/c1/repos', { repo: 'acme/api', projectId: PID });
        expect(wrapper.find('[data-repos]').text()).toContain('acme/api');
        expect(wrapper.find('[data-notice]').text()).toBe(en.ProjectGithub.added.replace('{repo}', 'acme/api'));
        expect(wrapper.find('[data-repo-picker]').exists()).toBe(false);

        const remove = wrapper.find('[data-remove-repo]');
        expect(remove.attributes('aria-label')).toBe(en.ProjectGithub.remove_label.replace('{repo}', 'acme/api'));
        await remove.trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('delete', `/api/v1/integrations/connections/c1/repos/${PID}?repo=acme%2Fapi`);
        expect(wrapper.find('[data-no-repos]').exists()).toBe(true);
    });

    it('shows a member the repositories with nothing to change', async () => {
        serve(viewOf({ canManage: false, repos: [{ repo: 'acme/web', lastError: '' }] }));
        const wrapper = await mountCard();
        expect(wrapper.find('[data-repos]').text()).toContain('acme/web');
        expect(buttons(wrapper)).toEqual([]);
    });

    it('warns an admin when the person who connected GitHub cannot open the project', async () => {
        serve(viewOf({ connection: { ...CONNECTION, reachable: false } }));
        const wrapper = await mountCard();
        expect(wrapper.find('[data-unreachable]').text()).toBe(en.ProjectGithub.unreachable);
    });

    it('finishes a sign-in that came back to this project, keeps the tab, and opens the picker', async () => {
        route.query = { tab: 'ProjectDetail', section: 'github', github: 'complete', state: 'signed', code: 'abc' };
        serve(viewOf(), { repos: ['acme/web'], writes: () => ({ data: { status: true, data: { id: 'c1', account: 'octo' } } }) });
        const wrapper = await mountCard();
        expect(replace).toHaveBeenCalledWith({ query: { tab: 'ProjectDetail', section: 'github' } });
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v1/integrations/github/complete', { state: 'signed', code: 'abc' });
        expect(wrapper.find('[data-notice]').text()).toBe(en.ProjectGithub.connected);
        expect(wrapper.find('[data-repo-picker]').exists()).toBe(true);
    });

    it('words a cancelled sign-in from the locale', async () => {
        route.query = { tab: 'ProjectDetail', github: 'denied' };
        serve(viewOf({ connection: null }));
        const wrapper = await mountCard();
        expect(wrapper.find('[role="alert"]').text()).toBe(en.AppConnections.github_denied);
        expect(apiRequest.mock.calls.some(([method]) => method === 'post')).toBe(false);
    });

    it('shows the egress message and the Allow button when GitHub cannot be reached', async () => {
        apiRequestWithoutCompnay.mockImplementation(async (method, url) => {
            if (url.endsWith('/instance/access')) return { data: { status: true, data: { allowed: true } } };
            if (method === 'get') return { data: { status: true, data: { workspaces: [{ companyId: CID, hosts: [], version: 1 }] } } };
            return { data: { status: true, data: {} } };
        });
        serve(viewOf({ connection: { ...CONNECTION, errorCode: 'egress_blocked', blockedHost: 'api.github.com' } }), { repos: ['acme/web'] });
        const wrapper = await mountCard();
        const panel = wrapper.find('[data-egress-blocked]');
        expect(panel.text()).toContain(en.AppConnections.egress_blocked.replace('{host}', 'api.github.com'));
        await panel.find('[data-allow-host]').trigger('click');
        await flushPromises();
        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('put', `/api/v2/instance/egress/${CID}`, { hosts: ['api.github.com'], version: 1 });
        expect(wrapper.find('[data-egress-blocked]').exists()).toBe(false);
        expect(wrapper.find('[data-repo-picker]').exists()).toBe(true);
    });

    it('renders nothing while App connections are off', async () => {
        serve({ data: { status: true, data: { enabled: false } } });
        const wrapper = await mountCard();
        expect(wrapper.find('[data-project-github]').exists()).toBe(false);
    });
});

describe('the project header GitHub chip', () => {
    const mountChip = async (projectId, repos) => {
        serve(viewOf({ repos: repos.map((repo) => ({ repo })) }));
        const wrapper = mount(ProjectGithubChip, { props: { projectId }, global: { mocks: { $t: i18n.global.t } } });
        await flushPromises();
        return wrapper;
    };

    it('names the one repository, or counts several, and opens the card', async () => {
        const one = await mountChip('bbbbbbbbbbbbbbbbbbbbbb11', ['acme/web']);
        expect(one.text()).toBe(en.ProjectGithub.chip_one.replace('{repo}', 'acme/web'));
        route.query = { tab: 'ProjectListView', view: 'list' };
        await one.find('[data-project-github-chip]').trigger('click');
        expect(push).toHaveBeenCalledWith({ query: { tab: 'ProjectDetail', view: 'list', section: 'github' } });

        const many = await mountChip('bbbbbbbbbbbbbbbbbbbbbb12', ['acme/web', 'acme/api']);
        expect(many.text()).toBe(en.ProjectGithub.chip_many.replace('{count}', '2'));
    });

    it('stays out of the header when no repository feeds the project', async () => {
        const none = await mountChip('bbbbbbbbbbbbbbbbbbbbbb13', []);
        expect(none.find('[data-project-github-chip]').exists()).toBe(false);
    });
});
