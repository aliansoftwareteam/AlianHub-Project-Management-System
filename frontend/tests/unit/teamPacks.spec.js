import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
const route = { query: {} };
const composable = vi.hoisted(() => ({ useCustomComposable: () => ({ checkPermission: () => composable.details }), details: true }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => ({ useCustomComposable: composable.useCustomComposable }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/views/Ai/AiSidebar.vue', () => ({ default: { name: 'AiSidebar', render: () => null } }));

import AgentCatalogue from '@/views/Ai/AgentCatalogue.vue';
import AiTeamPacks from '@/views/Ai/AiTeamPacks.vue';
import { applyAiAvailability, resetAiAvailability, AI_STATE } from '@/composable/aiAvailability';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const t = i18n.global.t;

const TWO = [{ _id: 'p1', ProjectName: 'Mobile app' }, { _id: 'p2', ProjectName: 'Website' }];
const store = createStore({
    modules: {
        settings: { namespaced: true, state: () => ({ roleType: 1 }), getters: { companyUserDetail: (state) => ({ roleType: state.roleType }) } },
        projectData: { namespaced: true, state: () => ({ list: TWO }), getters: { projects: (state) => ({ data: state.list }) } }
    }
});
const access = store.state.settings;
const projectState = store.state.projectData;

const TRIAGER = { key: 'it-company/bug-triager', slug: 'bug-triager', name: 'Bug Triager', department: 'Engineering', summary: 'Sorts new bugs.', tools: ['task.get', 'task.comment'], starterRules: [{ kind: 'type', value: 'Bug' }], tags: ['bug', 'needs-triage'] };
const REVIEWER = { key: 'it-company/code-reviewer', slug: 'code-reviewer', name: 'Code Reviewer', department: 'Engineering', summary: 'Reviews pull requests.', tools: ['task.get'], starterRules: [], tags: ['Bug'] };
const LEAD = { key: 'it-company/design-lead', slug: 'design-lead', name: 'Design Lead', department: 'Design', summary: 'Runs design reviews.', tools: ['task.get'] };
const PACKS = [{ blueprint: 'it-company', teams: [{ team: 'engineering', roles: [TRIAGER, REVIEWER] }, { team: 'design', roles: [LEAD] }] }];

const RULE = { role: 'it-company/bug-triager', when: { taskTypeKeys: [4] } };
const ok = (data) => Promise.resolve({ data: { status: true, data } });
let applied;
const serve = ({ on = true, refuse = null } = {}) => apiRequest.mockImplementation((type, url, body) => {
    if (url.endsWith('/team-packs') && type === 'get') return ok({ on, packs: PACKS });
    if (url.endsWith('/team-packs') && type === 'post') {
        if (refuse) return Promise.reject({ response: { status: refuse, data: { statusText: 'refused' } } });
        if (body.undo) return ok({ projects: body.projectIds.map((projectId) => ({ projectId, removed: [TRIAGER.key, REVIEWER.key], mode: 'off' })), agents: { removed: [], kept: [], narrowed: [] } });
        applied = body;
        return ok({ blueprint: body.blueprint, teams: body.teams, applyId: 'ap1', agents: { made: [], kept: [], widened: [] }, projects: [
            { projectId: 'p1', added: [TRIAGER.key, REVIEWER.key], mode: 'suggest', rules: body.starterRules ? [RULE] : [], skippedRules: 0, tags: ['bug', 'needs-triage'], proposalId: 'prop1' },
            { projectId: 'p2', added: [TRIAGER.key, REVIEWER.key], mode: 'off', rules: [], skippedRules: 1, rulesAwaitingTags: 2, tags: [], proposalId: null }
        ] });
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
    access.roleType = 1;
    composable.details = true;
    projectState.list = TWO;
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
    it('reads the team packs once and hands them to the blueprint picker', async () => {
        const wrapper = await mountWith(AiTeamPacks);
        expect(wrapper.find('[data-test="blueprint-picker"]').exists()).toBe(true);
        expect(apiRequest.mock.calls.filter(([type, url]) => type === 'get' && url.endsWith('/team-packs'))).toHaveLength(1);
    });

    it('turns the picked teams on in the picked projects, says where the dispatcher is off, and undoes it', async () => {
        route.query = { blueprint: 'it-company', team: 'engineering' };
        const wrapper = await mountWith(AiTeamPacks);
        const apply = wrapper.find('[data-test="tp-apply"]');
        expect(apply.text()).toBe('Turn on 2 roles');
        expect(apply.attributes('disabled')).toBeDefined();
        for (const input of wrapper.findAll('[data-test="tp-project"] input')) await input.setValue(true);
        await wrapper.find('[data-test="tp-apply"]').trigger('click');
        await flushPromises();
        expect(applied).toEqual({ blueprint: 'it-company', teams: ['engineering'], projectIds: ['p1', 'p2'], starterRules: true, proposeTags: true, createAgents: true });
        const result = wrapper.find('[data-test="tp-result"]');
        expect(result.text()).toContain('Turned on 4 roles.');
        expect(result.text()).toContain('Mobile app: the dispatcher is in suggest mode.');
        expect(result.text()).toContain('Website: the dispatcher is off in this project');

        await wrapper.find('[data-test="tp-undo"]').trigger('click');
        await flushPromises();
        const undo = apiRequest.mock.calls.find(([type, , body]) => type === 'post' && body.undo);
        expect(undo[2]).toEqual({ undo: true, blueprint: 'it-company', teams: ['engineering'], projectIds: ['p1', 'p2'], applyId: 'ap1' });
        expect(wrapper.find('[data-test="tp-result"]').text()).toContain('The pack\'s roles are off again.');
        expect(wrapper.find('[data-test="tp-undo"]').exists()).toBe(false);
    });

    it('offers the starter rules as a checkbox that is on, and sends what it says', async () => {
        route.query = { blueprint: 'it-company', team: 'engineering' };
        const wrapper = await mountWith(AiTeamPacks);
        const box = wrapper.find('[data-test="tp-starter-rules"]');
        expect(box.element.checked).toBe(true);
        expect(wrapper.find('[data-test="tp-starter-rules-hint"]').text()).toContain('One starter rule');
        expect(wrapper.find('[data-test="tp-tags-hint"]').text()).toContain('bug, needs-triage');
        await box.setValue(false);
        await wrapper.find('[data-test="tp-project"] input').setValue(true);
        await wrapper.find('[data-test="tp-apply"]').trigger('click');
        await flushPromises();
        expect(applied).toMatchObject({ starterRules: false, proposeTags: true });
        expect(wrapper.find('[data-test="tp-result"]').text()).not.toContain('routing rule');
    });

    it('tells what each project got: rules added, rules waiting and tags proposed for approval', async () => {
        route.query = { blueprint: 'it-company', team: 'engineering' };
        const wrapper = await mountWith(AiTeamPacks);
        for (const input of wrapper.findAll('[data-test="tp-project"] input')) await input.setValue(true);
        await wrapper.find('[data-test="tp-apply"]').trigger('click');
        await flushPromises();
        const lines = wrapper.findAll('[data-test="tp-result"] li').map((li) => li.text());
        expect(lines[0]).toContain('Added one routing rule.');
        expect(lines[0]).toContain('Proposed 2 tags for approval: bug, needs-triage.');
        expect(lines[1]).toContain('One starter rule waits for a tag or task type this project lacks.');
        expect(lines[1]).not.toContain('Proposed');
        expect(lines[1]).toContain('2 starter rules wait for their tags to be approved; they are added when the tags are approved.');
        expect(lines[0]).not.toContain('to be approved');
    });

    it('offers the team\'s agents on by default, can leave them off, and sends the made agents back on undo', async () => {
        route.query = { blueprint: 'it-company', team: 'engineering' };
        const wrapper = await mountWith(AiTeamPacks);
        const box = wrapper.find('[data-test="tp-create-agents"] input');
        expect(box.element.checked).toBe(true);
        expect(wrapper.find('[data-test="tp-create-agents"]').text()).toContain('Create the team\'s agents');
        expect(wrapper.find('[data-test="tp-create-agents"]').text()).toContain('Each starts paused');
        await box.setValue(false);
        await wrapper.find('[data-test="tp-project"] input').setValue(true);
        await wrapper.find('[data-test="tp-apply"]').trigger('click');
        await flushPromises();
        expect(applied.createAgents).toBe(false);

        apiRequest.mockImplementation((type, url, body) => {
            if (type === 'get') return ok({ on: true, packs: PACKS });
            if (body.undo) return ok({ projects: [], agents: { removed: [{ agentId: 'g1', name: 'Bug Triager · IT company' }], kept: [{ agentId: 'g2', name: 'Code Reviewer · IT company', why: 'has_worked' }, { agentId: 'g3', name: 'QA Engineer · IT company', why: 'running' }] } });
            return ok({ blueprint: 'it-company', teams: ['engineering'], applyId: 'ap2', projects: [{ projectId: 'p1', added: [TRIAGER.key], mode: 'off' }], agents: { made: [{ agentId: 'g1', roleKey: TRIAGER.key, name: 'Bug Triager · IT company' }, { agentId: 'g2', roleKey: REVIEWER.key, name: 'Code Reviewer · IT company' }], kept: [] } });
        });
        await wrapper.find('[data-test="tp-apply"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-test="tp-agents"]').text()).toContain('Created 2 agents.');
        expect(wrapper.find('[data-test="tp-agents-paused"]').text()).toContain('The new agents are paused.');
        await wrapper.find('[data-test="tp-undo"]').trigger('click');
        await flushPromises();
        const undo = apiRequest.mock.calls.find(([type, , body]) => type === 'post' && body.undo);
        expect(undo[2].applyId).toBe('ap2');
        expect(wrapper.find('[data-test="tp-agents"]').text()).toContain('2 agents stay.');
        expect(wrapper.find('[data-test="tp-kept"]').text()).toContain('Code Reviewer · IT company stays: it has done work');
        expect(wrapper.find('[data-test="tp-kept"]').text()).toContain('QA Engineer · IT company stays: it has runs in progress.');
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

    it('offers a member only the projects they may change, and says why the others are shut', async () => {
        access.roleType = 3;
        projectState.list = [...TWO, { _id: 'p3', ProjectName: 'Own roles', isGlobalPermission: false }];
        route.query = { team: 'design' };
        const wrapper = await mountWith(AiTeamPacks);
        const rows = wrapper.findAll('[data-test="tp-project"]');
        expect(rows.map((row) => row.attributes('data-why') || '')).toEqual(['', '', 'own_roles']);
        expect(rows[2].find('input').attributes('disabled')).toBeDefined();
        expect(rows[2].text()).toContain('This project has its own roles');

        expect(wrapper.find('[data-test="tp-create-agents"]').exists()).toBe(false);
        await rows[0].find('input').setValue(true);
        await wrapper.find('[data-test="tp-apply"]').trigger('click');
        await flushPromises();
        expect(applied.createAgents).toBe(false);

        composable.details = false;
        const shut = await mountWith(AiTeamPacks);
        expect(shut.findAll('[data-test="tp-project"]').map((row) => row.attributes('data-why'))).toEqual(['no_permission', 'no_permission', 'own_roles']);
    });

    it('stops at 50 projects', async () => {
        projectState.list = Array.from({ length: 52 }, (_, i) => ({ _id: `p${i}`, ProjectName: `Project ${i}` }));
        route.query = { team: 'design' };
        const wrapper = await mountWith(AiTeamPacks);
        const inputs = wrapper.findAll('[data-test="tp-project"] input');
        for (const input of inputs.slice(0, 50)) await input.setValue(true);
        expect(inputs[50].attributes('disabled')).toBeDefined();
        expect(inputs[0].attributes('disabled')).toBeUndefined();
        expect(wrapper.find('[data-test="tp-projects-hint"]').text()).toBe('You can pick up to 50 projects at a time.');
    });
});
