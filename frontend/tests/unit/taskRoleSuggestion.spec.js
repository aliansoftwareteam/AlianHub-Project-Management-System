import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, echo, toast, socket } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    socket: { handlers: {}, on(event, fn) { this.handlers[event] = fn; }, off(event) { delete this.handlers[event]; } },
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: { 'settings/getSocketInstance': socket } }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: (id) => ({ 'u-lead': { Employee_Name: 'Lena' } }[id]) }) }));

import TaskRoleSuggestion from '@/components/organisms/TaskDetailOverlay/TaskRoleSuggestion.vue';

const BASE = '/api/v2/assignment-rules/dispatcher';
const TRIAGER = { key: 'it-company/bug-triager', name: 'Bug Triager' };
const REVIEWER = { key: 'it-company/code-reviewer', name: 'Code Reviewer' };
const ok = (data) => Promise.resolve({ data: { status: true, data } });
const decision = (over = {}) => ({ _id: 'd1', state: 'suggested', role: TRIAGER.key, roleName: TRIAGER.name, source: 'rule', ruleIndex: 0, ...over });

const mountChip = async ({ found = decision(), on = true, canDecide = true, answer = {} } = {}) => {
    apiRequest.mockImplementation((type) => (type === 'get' ? ok({ on, decision: found, roles: [TRIAGER, REVIEWER] }) : ok(answer)));
    const wrapper = mount(TaskRoleSuggestion, { props: { task: { _id: 't1', ProjectID: 'p1' }, canDecide }, global: { mocks: { $t: echo } } });
    await flushPromises();
    return wrapper;
};

const chip = (wrapper) => wrapper.find('[data-test="role-suggestion"]');

describe('TaskRoleSuggestion', () => {
    beforeEach(() => { apiRequest.mockReset(); toast.error.mockReset(); });

    it('shows the suggested role and the rule that matched, with Accept and Dismiss', async () => {
        const wrapper = await mountChip();
        expect(apiRequest).toHaveBeenCalledWith('get', `${BASE}/task/t1`, undefined);
        expect(chip(wrapper).text()).toContain('Dispatcher.suggests {"role":"Bug Triager"}');
        expect(chip(wrapper).text()).toContain('Dispatcher.by_rule {"n":1}');
        expect(wrapper.find('[data-test="role-accept"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="role-dismiss"]').exists()).toBe(true);
    });

    it('shows the model\'s reason as plain text under its label, never as markup', async () => {
        const reason = '<img src=x onerror="window.pwned=1"> a crash report';
        const wrapper = await mountChip({ found: decision({ source: 'model', ruleIndex: null, confidence: 90, reason }) });
        const shown = wrapper.find('[data-test="model-reason"]');
        expect(shown.text()).toBe(`Dispatcher.model_reason ${reason}`);
        expect(shown.find('img').exists()).toBe(false);
        expect(chip(wrapper).text()).toContain('Dispatcher.by_model {"confidence":90}');
        const ruled = await mountChip();
        expect(ruled.find('[data-test="model-reason"]').exists()).toBe(false);
    });

    it('accepts through the dispatcher endpoint and then shows where the task went', async () => {
        const wrapper = await mountChip({ answer: { decision: decision({ state: 'accepted', resolvedBy: 'u-lead' }), offer: null } });
        await wrapper.find('[data-test="role-accept"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', `${BASE}/task/t1/decisions/d1/accept`, {});
        expect(chip(wrapper).text()).toContain('Dispatcher.accepted_by {"role":"Bug Triager","person":"Lena"}');
        expect(chip(wrapper).text()).toContain('Dispatcher.by_rule {"n":1}');
        expect(chip(wrapper).text()).toMatch(/"person":"Lena"\}\s+·\s*Dispatcher\.by_rule/);
        expect(wrapper.find('[data-test="role-accept"]').exists()).toBe(false);
    });

    it('dismisses and hides the chip', async () => {
        const wrapper = await mountChip({ answer: { decision: decision({ state: 'dismissed' }), offer: null } });
        await wrapper.find('[data-test="role-dismiss"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', `${BASE}/task/t1/decisions/d1/dismiss`, {});
        expect(chip(wrapper).exists()).toBe(false);
    });

    it('lets a lead send a task that needs routing to a role, and offers a rule when the dispatcher does', async () => {
        const offer = { role: REVIEWER, when: { taskTypeKeys: [2] }, times: 3 };
        const wrapper = await mountChip({
            found: decision({ state: 'needs_routing', role: null, roleName: '', source: null }),
            answer: { decision: decision({ state: 'routed', chosenRole: REVIEWER.key, roleName: REVIEWER.name }), offer },
        });
        expect(chip(wrapper).text()).toContain('Dispatcher.needs_routing');
        await wrapper.find('[data-test="role-pick"]').setValue(REVIEWER.key);
        await wrapper.find('[data-test="role-route"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', `${BASE}/task/t1/decisions/d1/route`, { role: REVIEWER.key });
        expect(wrapper.find('[data-test="role-offer"]').text()).toContain('"times":3');
        await wrapper.find('[data-test="role-offer-add"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', `${BASE}/project/p1/rules`, { role: REVIEWER.key, when: offer.when });
    });

    it('says which lead routed the task when a lead overrode the dispatcher', async () => {
        const wrapper = await mountChip({ found: decision({ state: 'routed', chosenRole: REVIEWER.key, roleName: REVIEWER.name, resolvedBy: 'u-lead' }) });
        expect(chip(wrapper).text()).toContain('Dispatcher.routed_by {"role":"Code Reviewer","person":"Lena"}');
    });

    it('reads the decision again when the dispatcher announces a change', async () => {
        const wrapper = await mountChip();
        apiRequest.mockImplementation(() => ok({ on: true, decision: decision({ state: 'accepted' }), roles: [] }));
        socket.handlers.dispatcherChanged({ kind: 'dispatchDecisions' });
        await flushPromises();
        expect(chip(wrapper).text()).toContain('Dispatcher.routed_to');
    });

    it('shows nothing while the dispatcher is off, and no buttons to someone who cannot decide', async () => {
        expect(chip(await mountChip({ on: false })).exists()).toBe(false);
        const wrapper = await mountChip({ canDecide: false });
        expect(chip(wrapper).exists()).toBe(true);
        expect(wrapper.find('[data-test="role-accept"]').exists()).toBe(false);
    });
});
