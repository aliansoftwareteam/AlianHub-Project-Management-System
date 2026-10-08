import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import fs from 'fs';
import path from 'path';
import en from '@/locales/en';

const { apiRequest, replace } = vi.hoisted(() => ({ apiRequest: vi.fn(), replace: vi.fn(() => Promise.resolve()) }));
const composable = vi.hoisted(() => ({ useCustomComposable: () => ({ checkPermission: () => composable.details }), details: true }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/composable', () => ({ useCustomComposable: composable.useCustomComposable }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {}, meta: {} }), useRouter: () => ({ push: vi.fn(), replace }) }));

import BlueprintPicker from '@/views/Ai/BlueprintPicker.vue';
import BlueprintWelcome from '@/views/Ai/BlueprintWelcome.vue';
import aiRoutes from '@/router/ai';
import { BLUEPRINT_WELCOME_ROUTE } from '@/router/ai/connect';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const t = i18n.global.t;

const role = (name, team, key) => ({ name, team, key });
const IT_ROLES = [role('Bug Triager', 'engineering', 'it-company/bug-triager'), role('Support Agent', 'support', 'it-company/support-agent'), role('Tech Lead', 'engineering', 'it-company/tech-lead'), role('QA Engineer', 'engineering', 'it-company/qa-engineer')];
const CLINIC_ROLES = [role('Appointment Follow-up List', 'administration', null), role('Supplies Stock Alert', 'administration', null), role('Staff Roster Checker', 'administration', null)];
const size = (roles, packs, people = [5, 25], seats = [6, 9]) => ({ people, seats, teams: [...new Set(roles.map((one) => one.team))], roles, starter: roles.slice(0, 3).map((one) => one.name), packs });
const IT_PACKS = [{ blueprint: 'it-company', teams: ['engineering', 'support'], roles: IT_ROLES.slice(0, 3).map((one) => one.key) }];
const BLUEPRINTS = [
    { id: 'it-company', sizes: { small: size(IT_ROLES, IT_PACKS), medium: size(IT_ROLES, IT_PACKS, [25, 150], [20, 40]), large: size(IT_ROLES, IT_PACKS, [150, 1000], [60, 200]) } },
    { id: 'clinic', sizes: { small: size(CLINIC_ROLES, []), medium: size(CLINIC_ROLES, []), large: size(CLINIC_ROLES, []) } }
];

const TWO = [{ _id: 'p1', ProjectName: 'Mobile app' }, { _id: 'p2', ProjectName: 'Website' }];
const store = createStore({
    modules: {
        settings: { namespaced: true, state: () => ({ roleType: 1 }), getters: { companyUserDetail: (state) => ({ roleType: state.roleType }) } },
        projectData: { namespaced: true, state: () => ({ list: TWO }), getters: { projects: (state) => ({ data: state.list }) } }
    }
});

const ok = (data) => Promise.resolve({ data: { status: true, data } });
let posted;
const serve = ({ on = true } = {}) => apiRequest.mockImplementation((type, url, body) => {
    if (type === 'get') return ok({ on, packs: [], companyBlueprints: BLUEPRINTS });
    posted.push(body);
    if (body.undo) return ok({ projects: body.projectIds.map((projectId) => ({ projectId, removed: body.roles[projectId], mode: 'off' })) });
    return ok({ blueprint: body.blueprint, teams: body.teams, projects: body.projectIds.map((projectId) => ({ projectId, added: body.only, mode: projectId === 'p1' ? 'suggest' : 'off' })) });
});

const mounted = [];
const mountWith = async (component) => {
    const wrapper = mount(component, { attachTo: document.body, global: { plugins: [store, i18n], mocks: { $t: t } } });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};

beforeEach(() => {
    apiRequest.mockReset();
    replace.mockClear();
    posted = [];
    composable.details = true;
    store.state.settings.roleType = 1;
    store.state.projectData.list = TWO;
    serve();
});

afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
});

describe('the company blueprint picker', () => {
    it('shows the teams, roles and seats of the chosen industry and size, marking the first three', async () => {
        const wrapper = await mountWith(BlueprintPicker);
        expect(wrapper.find('[data-test="bp-seats"]').text()).toBe('About 4 roles and 6 to 9 seats');
        expect(wrapper.findAll('[data-test="bp-role"]').map((row) => row.text())).toHaveLength(4);
        expect(wrapper.findAll('.bp__role--start')).toHaveLength(3);
        expect(wrapper.find('[data-test="bp-teams"]').text()).toContain('Engineering');

        await wrapper.findAll('[data-test="bp-size"] input')[2].setValue(true);
        expect(wrapper.find('[data-test="bp-seats"]').text()).toBe('About 4 roles and 60 to 200 seats');
    });

    it('applies the first three roles to the chosen projects in one request narrowed by only', async () => {
        const wrapper = await mountWith(BlueprintPicker);
        const apply = wrapper.find('[data-test="bp-apply"]');
        expect(apply.attributes('disabled')).toBeDefined();
        await wrapper.findAll('[data-test="bp-project"] input')[0].setValue(true);
        await wrapper.findAll('[data-test="bp-project"] input')[1].setValue(true);
        expect(apply.text()).toBe('Turn on 3 starter roles');
        await apply.trigger('click');
        await flushPromises();
        expect(posted).toEqual([{ blueprint: 'it-company', teams: ['engineering', 'support'], only: IT_PACKS[0].roles, projectIds: ['p1', 'p2'] }]);
        expect(wrapper.find('[data-test="bp-result"]').text()).toContain('Turned on 6 roles');
        expect(wrapper.findAll('[data-test="bp-result"] li').map((li) => li.attributes('data-mode'))).toEqual(['suggest', 'off']);
        expect(wrapper.find('[data-test="bp-result"]').text()).toContain('the roles wait until someone switches it on');
    });

    it('undoes with the roles it turned on', async () => {
        const wrapper = await mountWith(BlueprintPicker);
        await wrapper.findAll('[data-test="bp-project"] input')[0].setValue(true);
        await wrapper.find('[data-test="bp-apply"]').trigger('click');
        await flushPromises();
        await wrapper.find('[data-test="bp-undo"]').trigger('click');
        await flushPromises();
        expect(posted[1]).toMatchObject({ undo: true, blueprint: 'it-company', roles: { p1: IT_PACKS[0].roles } });
        expect(wrapper.find('[data-test="bp-result"]').text()).toContain('off again');
    });

    it('turns nothing on for an industry whose first roles are not written, and says so', async () => {
        const wrapper = await mountWith(BlueprintPicker);
        await wrapper.find('[data-test="bp-industry"]').setValue('clinic');
        await wrapper.findAll('[data-test="bp-project"] input')[0].setValue(true);
        expect(wrapper.find('[data-test="bp-none-written"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="bp-apply"]').attributes('disabled')).toBeDefined();
        expect(apiRequest).not.toHaveBeenCalledWith('post', expect.anything(), expect.anything());
    });

    it('uses the team packs it is handed instead of asking again', async () => {
        const wrapper = mount(BlueprintPicker, { props: { teamPacks: { on: true, packs: [], companyBlueprints: BLUEPRINTS } }, global: { plugins: [store, i18n], mocks: { $t: t } } });
        mounted.push(wrapper);
        await flushPromises();
        expect(apiRequest).not.toHaveBeenCalled();
        expect(wrapper.find('[data-test="bp-seats"]').text()).toBe('About 4 roles and 6 to 9 seats');
    });

    it('is closed with a note while the dispatcher is off', async () => {
        serve({ on: false });
        const wrapper = await mountWith(BlueprintPicker);
        expect(wrapper.find('[data-test="bp-off"]').exists()).toBe(true);
        await wrapper.findAll('[data-test="bp-project"] input')[0].setValue(true);
        expect(wrapper.find('[data-test="bp-apply"]').attributes('disabled')).toBeDefined();
    });

    it('keeps out a project a member may not change', async () => {
        store.state.settings.roleType = 3;
        composable.details = false;
        const wrapper = await mountWith(BlueprintPicker);
        expect(wrapper.findAll('[data-test="bp-project"] input').every((box) => box.attributes('disabled') !== undefined)).toBe(true);
    });

    it('stacks on a 390px screen and uses only tokens', async () => {
        const source = fs.readFileSync(path.resolve(__dirname, '../../src/views/Ai/BlueprintPicker.vue'), 'utf8');
        expect(source).toMatch(/@media \(max-width: 480px\)[\s\S]*\.bp__sizes \{ grid-template-columns: 1fr; \}/);
        expect(source.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsl\(/gi)).toBeNull();
    });
});

describe('the sign-up step', () => {
    it('has its own welcome route', () => {
        expect(aiRoutes.find((route) => route.name === BLUEPRINT_WELCOME_ROUTE)).toMatchObject({ path: '/:cid/welcome/blueprint', meta: { welcome: true, requiresAuth: true } });
    });

    it('shows the picker and leaves for Home on Continue', async () => {
        const wrapper = await mountWith(BlueprintWelcome);
        expect(wrapper.find('[data-test="blueprint-picker"]').exists()).toBe(true);
        expect(replace).not.toHaveBeenCalled();
        await wrapper.find('[data-test="blueprint-continue"]').trigger('click');
        expect(replace).toHaveBeenCalledWith({ name: 'Home', params: { cid: 'company-1' } });
    });

    it('goes straight to Home while the dispatcher is off', async () => {
        serve({ on: false });
        await mountWith(BlueprintWelcome);
        expect(replace).toHaveBeenCalledTimes(1);
    });
});
