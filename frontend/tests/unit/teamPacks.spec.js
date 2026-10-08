import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
const route = { query: {} };

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import AgentCatalogue from '@/views/Ai/AgentCatalogue.vue';
import AiTeamPacks from '@/views/Ai/AiTeamPacks.vue';
import { applyAiAvailability, resetAiAvailability, AI_STATE } from '@/composable/aiAvailability';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const t = i18n.global.t;

const PROJECTS = [{ _id: 'p1', ProjectName: 'Mobile app' }, { _id: 'p2', ProjectName: 'Website' }];
const store = createStore({
    modules: {
        settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType: 1 }) } },
        projectData: { namespaced: true, getters: { projects: () => ({ data: PROJECTS }) } }
    }
});

const TRIAGER = { key: 'it-company/bug-triager', slug: 'bug-triager', name: 'Bug Triager', department: 'Engineering', summary: 'Sorts new bugs.', tools: ['task.get', 'task.comment'] };
const REVIEWER = { key: 'it-company/code-reviewer', slug: 'code-reviewer', name: 'Code Reviewer', department: 'Engineering', summary: 'Reviews pull requests.', tools: ['task.get'] };
const LEAD = { key: 'it-company/design-lead', slug: 'design-lead', name: 'Design Lead', department: 'Design', summary: 'Runs design reviews.', tools: ['task.get'] };
const PACKS = [{ blueprint: 'it-company', teams: [{ team: 'engineering', roles: [TRIAGER, REVIEWER] }, { team: 'design', roles: [LEAD] }] }];

const ok = (data) => Promise.resolve({ data: { status: true, data } });
let applied;
const serve = ({ on = true, refuse = null } = {}) => apiRequest.mockImplementation((type, url, body) => {
    if (url.endsWith('/team-packs') && type === 'get') return ok({ on, packs: PACKS });
    if (url.endsWith('/team-packs') && type === 'post') {
        if (refuse) return Promise.reject({ response: { status: refuse, data: { statusText: 'refused' } } });
        if (body.undo) return ok({ projects: body.projectIds.map((projectId) => ({ projectId, removed: body.roles[projectId], mode: 'off' })) });
        applied = body;
        return ok({ blueprint: body.blueprint, teams: body.teams, projects: [{ projectId: 'p1', added: [TRIAGER.key, REVIEWER.key], mode: 'suggest' }, { projectId: 'p2', added: [TRIAGER.key, REVIEWER.key], mode: 'off' }] });
    }
    return ok([]);
});

const mounted = [];
const mountWith = async (component) => {
    const wrapper = mount(component, { attachTo: document.body, global: { plugins: [store, i18n], mocks: { $t: t }, stubs: { teleport: true } } });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    apiRequest.mockReset();
    applied = null;
    route.query = {};
    serve();
    resetAiAvailability();
    applyAiAvailability({ state: AI_STATE.ON });
});

afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
});

describe('the catalogue Team filter', () => {
    it('lists each blueprint\'s teams and shows the team\'s roles as cards with who they are and their tools', async () => {
        const wrapper = await mountWith(AgentCatalogue);
        const select = wrapper.find('[data-test="catalogue-team"]');
        expect(select.findAll('option').map((o) => o.text())).toEqual(['Any team: show the templates', 'IT company · Engineering', 'IT company · Design']);
        await select.setValue('it-company/engineering');
        const cards = wrapper.findAll('[data-test="catalogue-role"]');
        expect(cards.map((card) => card.attributes('data-role'))).toEqual([TRIAGER.key, REVIEWER.key]);
        expect(cards[0].text()).toContain('Sorts new bugs.');
        expect(cards[0].text()).toContain('2 tools');
        expect(cards[0].text()).toContain('task.comment');
        expect(wrapper.find('[data-test="catalogue-card"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="catalogue-needs-key"]').exists()).toBe(false);
    });

    it('says a role needs a server key when none is set', async () => {
        applyAiAvailability({ state: AI_STATE.UNCONFIGURED });
        const wrapper = await mountWith(AgentCatalogue);
        await wrapper.find('[data-test="catalogue-team"]').setValue('it-company/design');
        expect(wrapper.find('[data-test="catalogue-needs-key"]').text()).toBe('Needs a server key to run here; works now with your own AI.');
    });
});

describe('Team packs', () => {
    it('turns the picked teams on in the picked projects, says where the dispatcher is off, and undoes it', async () => {
        route.query = { blueprint: 'it-company', team: 'engineering' };
        const wrapper = await mountWith(AiTeamPacks);
        const apply = wrapper.find('[data-test="tp-apply"]');
        expect(apply.text()).toBe('Turn on 2 roles');
        expect(apply.attributes('disabled')).toBeDefined();
        for (const input of wrapper.findAll('[data-test="tp-project"] input')) await input.setValue(true);
        await wrapper.find('[data-test="tp-apply"]').trigger('click');
        await flushPromises();
        expect(applied).toEqual({ blueprint: 'it-company', teams: ['engineering'], projectIds: ['p1', 'p2'] });
        const result = wrapper.find('[data-test="tp-result"]');
        expect(result.text()).toContain('Turned on 4 roles.');
        expect(result.text()).toContain('Mobile app: the dispatcher is in suggest mode.');
        expect(result.text()).toContain('Website: the dispatcher is off in this project');

        await wrapper.find('[data-test="tp-undo"]').trigger('click');
        await flushPromises();
        const undo = apiRequest.mock.calls.find(([type, , body]) => type === 'post' && body.undo);
        expect(undo[2]).toEqual({ undo: true, blueprint: 'it-company', teams: ['engineering'], projectIds: ['p1', 'p2'], roles: { p1: [TRIAGER.key, REVIEWER.key], p2: [TRIAGER.key, REVIEWER.key] } });
        expect(wrapper.find('[data-test="tp-result"]').text()).toContain('The pack\'s roles are off again.');
        expect(wrapper.find('[data-test="tp-undo"]').exists()).toBe(false);
    });

    it('says the dispatcher is off and keeps the button shut', async () => {
        serve({ on: false });
        const wrapper = await mountWith(AiTeamPacks);
        expect(wrapper.find('[data-test="tp-off"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="tp-apply"]').attributes('disabled')).toBeDefined();
    });

    it('shows the server\'s refusal', async () => {
        serve({ refuse: 403 });
        route.query = { team: 'design' };
        const wrapper = await mountWith(AiTeamPacks);
        await wrapper.find('[data-test="tp-project"] input').setValue(true);
        await wrapper.find('[data-test="tp-apply"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="tp-error"]').text()).toBe('refused');
    });
});
