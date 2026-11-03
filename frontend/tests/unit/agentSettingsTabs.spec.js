import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { createStore } from 'vuex';
import { reactive, ref } from 'vue';
import fs from 'fs';
import path from 'path';

const { apiRequest, route, router, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    route: { params: { id: 'a1' }, query: {} },
    router: { replace: vi.fn(), push: vi.fn() },
    toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() }
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/components/organisms/Shell/shellState', () => ({ shellState: { agentsRunning: 0 } }));
vi.mock('vue-router', async () => {
    const { reactive } = await import('vue');
    const live = reactive(route);
    return { useRoute: () => live, useRouter: () => router };
});
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));

import AgentSettings from '@/views/Ai/AgentSettings.vue';
import en from '@/locales/en';

const OWNER = 1;
const MEMBER = 3;
const agent = { _id: 'a1', name: 'Reviewer', autonomy: 1, spendCapUsd: 30, model: '', projectIds: ['p2'], skills: [{ key: 'qa', name: 'QA', enabled: true }] };
const manifest = [{ key: 'qa', name: 'QA' }, { key: 'triage', name: 'Triage' }, { key: 'digest', name: 'Digest' }];
const projects = [
    { _id: 'p1', ProjectName: 'Alian Website' },
    { _id: 'p2', ProjectName: 'Shopify Store Locator' },
    { _id: 'p3', ProjectName: 'Alian Quiz App' },
    { _id: 'p4', ProjectName: 'Marketing Team' }
];

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const serve = (listed = [agent]) => apiRequest.mockImplementation((type, url) => {
    if (type !== 'get') return ok({});
    if (url === '/api/v2/agents') return ok(listed);
    if (url === '/api/v2/agents/skills') return ok(manifest);
    if (url === '/api/v2/agents/registry') return ok({ actions: [], never: [], autonomy: [{ level: 0 }, { level: 1 }, { level: 2 }, { level: 3 }] });
    return ok([]);
});

const BUILDS_AGENTS = { artificial_intelligence: { ai_agents: { roles: [{ key: MEMBER, permission: true }] } } };
const store = (roleType, rules = {}) => createStore({
    modules: {
        settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }), rules: () => rules } },
        projectData: { namespaced: true, getters: { projects: () => ({ data: projects }) } }
    }
});

const mounted = [];
const mountSettings = async ({ roleType = OWNER, query = {}, rules } = {}) => {
    route.query = query;
    const wrapper = mount(AgentSettings, {
        attachTo: document.body,
        global: {
            plugins: [store(roleType, rules)],
            provide: { $userId: ref('u1'), $companyId: ref('company-1') },
            stubs: { RouterLink: RouterLinkStub, ShellIcon: true, AgentRevisionHistory: true, AgentSchedules: true, AiSidebar: true }
        }
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};

const tabKeys = (wrapper) => wrapper.findAll('[role="tab"]').map((tab) => tab.attributes('data-tab'));
const activeTab = (wrapper) => wrapper.find('[role="tab"][aria-selected="true"]').attributes('data-tab');
const panelShown = (wrapper, key) => wrapper.find(`#agent-panel-${key}`).isVisible();
const shownProjectNames = (wrapper) => wrapper.findAll('.ai-scope__item').map((item) => item.text());

beforeEach(() => {
    apiRequest.mockReset();
    router.replace.mockReset();
    Object.values(toast).forEach((fn) => fn.mockReset());
    serve();
});

afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
});

describe('agent settings tabs', () => {
    it('splits the page into tabs and shows one panel at a time', async () => {
        const wrapper = await mountSettings();
        expect(tabKeys(wrapper)).toEqual(['skills', 'projects', 'autonomy', 'limits', 'runs', 'history', 'delete']);
        expect(activeTab(wrapper)).toBe('skills');
        expect(panelShown(wrapper, 'skills')).toBe(true);
        expect(panelShown(wrapper, 'projects')).toBe(false);

        await wrapper.find('[data-tab="projects"]').trigger('click');
        expect(activeTab(wrapper)).toBe('projects');
        expect(panelShown(wrapper, 'projects')).toBe(true);
        expect(panelShown(wrapper, 'skills')).toBe(false);
        expect(router.replace).toHaveBeenCalledWith({ query: { tab: 'projects' } });
    });

    it('moves between tabs with the arrow keys', async () => {
        const wrapper = await mountSettings();
        await wrapper.find('[role="tablist"]').trigger('keydown', { key: 'ArrowRight' });
        expect(activeTab(wrapper)).toBe('projects');
        await wrapper.find('[role="tablist"]').trigger('keydown', { key: 'ArrowLeft' });
        await wrapper.find('[role="tablist"]').trigger('keydown', { key: 'ArrowLeft' });
        expect(activeTab(wrapper)).toBe('delete');
    });

    it('opens the tab named in the address, and History for a revision link', async () => {
        expect(activeTab(await mountSettings({ query: { tab: 'limits' } }))).toBe('limits');
        expect(activeTab(await mountSettings({ query: { rev: '3' } }))).toBe('history');
        expect(activeTab(await mountSettings({ query: { tab: 'nonsense' } }))).toBe('skills');
    });

    it('opens History when a run on this page links to a revision', async () => {
        const wrapper = await mountSettings({ query: { tab: 'runs' } });
        expect(activeTab(wrapper)).toBe('runs');
        reactive(route).query = { rev: '2' };
        await flushPromises();
        expect(activeTab(wrapper)).toBe('history');
    });

    it('gives a member no History or Delete tab, even from a revision link', async () => {
        const wrapper = await mountSettings({ roleType: MEMBER, query: { rev: '3' } });
        expect(tabKeys(wrapper)).toEqual(['skills', 'projects', 'autonomy', 'limits', 'runs']);
        expect(activeTab(wrapper)).toBe('skills');
        expect(wrapper.find('[data-test="savebar"]').exists()).toBe(false);
    });

    it('keeps the Save bar on the settings tabs only', async () => {
        const wrapper = await mountSettings();
        for (const key of ['skills', 'projects', 'autonomy', 'limits']) {
            await wrapper.find(`[data-tab="${key}"]`).trigger('click');
            expect(wrapper.find('[data-test="save"]').exists(), key).toBe(true);
        }
        for (const key of ['runs', 'history', 'delete']) {
            await wrapper.find(`[data-tab="${key}"]`).trigger('click');
            expect(wrapper.find('[data-test="save"]').exists(), key).toBe(false);
        }
    });
});

describe('an agent made by a member whose role builds agents', () => {
    it('gives its maker the Save bar to send a change for approval and the Delete tab, but no History', async () => {
        serve([{ ...agent, ownerId: 'u1' }]);
        const wrapper = await mountSettings({ roleType: MEMBER, rules: BUILDS_AGENTS });
        expect(tabKeys(wrapper)).toEqual(['skills', 'projects', 'autonomy', 'limits', 'runs', 'delete']);
        expect(wrapper.find('[data-test="save"]').text()).toContain('save_for_approval');
        expect(wrapper.find('[data-test="read-only"]').exists()).toBe(false);
    });

    it('keeps an agent another member made read-only for them', async () => {
        serve([{ ...agent, ownerId: 'u9' }]);
        const wrapper = await mountSettings({ roleType: MEMBER, rules: BUILDS_AGENTS });
        expect(tabKeys(wrapper)).toEqual(['skills', 'projects', 'autonomy', 'limits', 'runs']);
        expect(wrapper.find('[data-test="savebar"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="read-only"]').exists()).toBe(true);
    });
});

describe('unsaved changes', () => {
    it('shows who can use the agent on the Projects tab, and marks the tab once it changes', async () => {
        const wrapper = await mountSettings();
        await wrapper.find('[data-tab="projects"]').trigger('click');
        expect(wrapper.find('[data-test="audience"]').isVisible()).toBe(true);
        expect(wrapper.find('[data-test="dirty-projects"]').exists()).toBe(false);
        await wrapper.find('[data-test="audience-private"]').trigger('change');
        expect(wrapper.find('[data-test="dirty-projects"]').exists()).toBe(true);
    });

    it('marks the bar and the tab that changed, and clears both after Save', async () => {
        const wrapper = await mountSettings();
        expect(wrapper.find('[data-test="unsaved"]').exists()).toBe(false);

        await wrapper.find('#rate').setValue(12);
        expect(wrapper.find('[data-test="unsaved"]').text()).toBe('Ai.unsaved_changes');
        expect(wrapper.find('[data-test="dirty-limits"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="dirty-skills"]').exists()).toBe(false);

        await wrapper.find('[data-test="save"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="unsaved"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="dirty-limits"]').exists()).toBe(false);
    });

    it('does not count unticking and re-ticking a project as a change', async () => {
        const wrapper = await mountSettings();
        const p2 = wrapper.findAll('.ai-scope__item input').find((input) => input.element.value === 'p2');
        await p2.setValue(false);
        expect(wrapper.find('[data-test="dirty-projects"]').exists()).toBe(true);
        await p2.setValue(true);
        expect(wrapper.find('[data-test="dirty-projects"]').exists()).toBe(false);
    });
});

describe('the project picker', () => {
    it('lists chosen projects first and counts them', async () => {
        const wrapper = await mountSettings();
        expect(shownProjectNames(wrapper)[0]).toBe('Shopify Store Locator');
        expect(wrapper.find('[data-test="scope-count"]').text()).toBe('Ai.scope_chosen_count');
        expect(wrapper.find('[data-tab="projects"]').text()).toContain('1');
    });

    it('filters by name, and by chosen only', async () => {
        const wrapper = await mountSettings();
        await wrapper.find('[data-test="scope-search"]').setValue('alian');
        expect(shownProjectNames(wrapper)).toEqual(['Alian Website', 'Alian Quiz App']);

        await wrapper.find('[data-test="scope-search"]').setValue('nothing like it');
        expect(wrapper.find('[data-test="scope-empty"]').text()).toBe('Ai.scope_no_match');

        await wrapper.find('[data-test="scope-search"]').setValue('');
        await wrapper.find('[data-test="scope-chosen-only"]').trigger('click');
        expect(shownProjectNames(wrapper)).toEqual(['Shopify Store Locator']);
    });

    it('chooses every shown project, and clears them all', async () => {
        const wrapper = await mountSettings();
        await wrapper.find('[data-test="scope-search"]').setValue('alian');
        await wrapper.find('[data-test="scope-choose-shown"]').trigger('click');
        await wrapper.find('[data-test="save"]').trigger('click');
        await flushPromises();
        expect(apiRequest.mock.calls.filter(([type]) => type === 'put')[0][2]).toEqual({ _id: 'a1', projectIds: ['p1', 'p2', 'p3'] });

        await wrapper.find('[data-test="scope-clear"]').trigger('click');
        await wrapper.find('[data-test="scope-search"]').setValue('');
        expect(wrapper.findAll('.ai-scope__item input:checked')).toHaveLength(0);
    });

    it('offers no bulk choice to a member', async () => {
        const wrapper = await mountSettings({ roleType: MEMBER });
        expect(wrapper.find('[data-test="scope-search"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="scope-choose-shown"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="scope-clear"]').exists()).toBe(false);
    });
});

describe('the skills list', () => {
    it('shows the skills in use and folds the rest of the library', async () => {
        const wrapper = await mountSettings();
        expect(wrapper.find('#sk-qa').isVisible()).toBe(true);
        expect(wrapper.find('#sk-triage').isVisible()).toBe(false);

        await wrapper.find('[data-test="skills-more"]').trigger('click');
        expect(wrapper.find('#sk-triage').isVisible()).toBe(true);
    });

    it('keeps a library skill in view once it is turned on', async () => {
        const wrapper = await mountSettings();
        await wrapper.find('[data-test="skills-more"]').trigger('click');
        await wrapper.find('#sk-triage').setValue(true);
        await wrapper.find('[data-test="skills-more"]').trigger('click');
        expect(wrapper.find('#sk-triage').isVisible()).toBe(true);
        expect(wrapper.find('#sk-digest').isVisible()).toBe(false);
        expect(wrapper.find('[data-tab="skills"]').text()).toContain('2');
    });
});

describe('the tab strings', () => {
    it('has an English sentence for every key the page uses', () => {
        const source = fs.readFileSync(path.resolve(__dirname, '../../src/views/Ai/AgentSettings.vue'), 'utf8');
        const keys = [...new Set(source.match(/Ai\.(agent_tab|scope|skills_library|unsaved|all_saved)[a-z_]*/g))];
        ['skills', 'projects', 'autonomy', 'limits', 'runs', 'history', 'delete'].forEach((key) => expect(en.Ai[`agent_tab_${key}`], key).toEqual(expect.any(String)));
        keys.filter((key) => !key.endsWith('_')).forEach((key) => expect(en.Ai[key.slice(3)], key).toEqual(expect.any(String)));
    });
});
