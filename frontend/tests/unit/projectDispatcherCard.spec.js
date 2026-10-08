import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, echo, socket } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    socket: { handlers: {}, on(event, fn) { this.handlers[event] = fn; }, off(event) { delete this.handlers[event]; } },
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo, te: (key) => key === 'Blueprints.it_company' }) }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: { 'settings/getSocketInstance': socket } }) }));

import ProjectDispatcherCard from '@/views/Projects/ProjectDetail/ProjectDispatcherCard.vue';
import { priorityChoices } from '@/utils/dispatcher';

const BASE = '/api/v2/assignment-rules/dispatcher';
const TRIAGER = { key: 'it-company/bug-triager', name: 'Bug Triager', blueprint: 'it-company' };
const REVIEWER = { key: 'it-company/code-reviewer', name: 'Code Reviewer', blueprint: 'it-company' };
const PLANNER = { key: 'manufacturing/production-planner', name: 'Production Planner', blueprint: 'manufacturing' };
const SETTINGS = {
    mode: 'suggest', threshold: 80, modelGuess: false, roles: [TRIAGER.key, REVIEWER.key],
    rules: [{ role: TRIAGER.key, when: { taskTypeKeys: [2] } }, { role: REVIEWER.key, when: { tags: ['tag-ui'] } }],
};
const NEED = { decision: { _id: 'd9', state: 'needs_routing' }, task: { _id: 't9', TaskName: 'Odd one', TaskKey: 'LCH-9' } };
const ok = (data) => Promise.resolve({ data: { status: true, data } });

/* As the server seeds task_priorities (utils/data.js) and the settings store keeps them. */
const COMPANY_PRIORITIES = [
    { name: 'High', value: 'HIGH', image: '', statusImage: '', isDeleted: false },
    { name: 'Low', value: 'LOW', image: '', statusImage: '', isDeleted: false },
    { name: 'Old', value: 'OLD', image: '', statusImage: '', isDeleted: true },
];

const mountCard = async ({ canEdit = true, settings = SETTINGS } = {}) => {
    apiRequest.mockImplementation((type, url, body) => {
        if (type === 'get' && url.endsWith('/needs-routing')) return ok({ on: true, items: [NEED] });
        if (type === 'get') return ok({ on: true, settings, roles: [TRIAGER, REVIEWER, PLANNER] });
        if (type === 'put') return ok({ ...body, revision: 2 });
        return ok({ decision: { ...NEED.decision, state: 'routed' }, offer: null });
    });
    const wrapper = mount(ProjectDispatcherCard, {
        props: { projectId: 'p1', canEdit, choices: { type: [{ value: 2, label: 'Bug' }, { value: 3, label: 'Feature' }], priority: priorityChoices(COMPANY_PRIORITIES) } },
        global: { mocks: { $t: echo } },
    });
    await flushPromises();
    return wrapper;
};

const putBody = () => apiRequest.mock.calls.filter(([type]) => type === 'put').at(-1)[2];

describe('ProjectDispatcherCard', () => {
    beforeEach(() => { apiRequest.mockReset(); socket.handlers = {}; });

    it('groups the roles by blueprint and saves the roles switched on', async () => {
        const wrapper = await mountCard();
        const groups = wrapper.findAll('[data-test="dispatcher-role-group"]');
        expect(groups).toHaveLength(2);
        expect(groups[0].find('summary').text()).toContain('"blueprint":"Blueprints.it_company"');
        expect(groups[1].find('summary').text()).toContain('"blueprint":"manufacturing"');
        expect(wrapper.find('[data-test="project-dispatcher"]').classes()).toContain('ah-card');
        await wrapper.find(`[data-test="dispatcher-role-${PLANNER.key}"]`).setValue(true);
        await wrapper.find('[data-test="dispatcher-save"]').trigger('click');
        await flushPromises();
        expect(putBody().roles).toEqual([TRIAGER.key, REVIEWER.key, PLANNER.key]);
        expect(putBody().mode).toBe('suggest');
    });

    it('adds, reorders and removes rules, one condition to one role each', async () => {
        const wrapper = await mountCard();
        expect(wrapper.findAll('[data-test="dispatcher-rule"]')).toHaveLength(2);
        await wrapper.find('[data-test="dispatcher-rule-add"]').trigger('click');
        expect(wrapper.find('[data-test="dispatcher-save"]').attributes('disabled')).toBeDefined();
        const added = wrapper.findAll('[data-test="dispatcher-rule"]')[2];
        const selects = added.findAll('select');
        await selects[1].setValue('3');
        await selects[2].setValue(REVIEWER.key);
        await wrapper.findAll('[data-test="dispatcher-rule"]')[1].findAll('button')[0].trigger('click');
        await wrapper.findAll('[data-test="dispatcher-rule-remove"]')[0].trigger('click');
        await wrapper.find('[data-test="dispatcher-save"]').trigger('click');
        await flushPromises();
        expect(putBody().rules).toEqual([
            { role: TRIAGER.key, when: { taskTypeKeys: [2] } },
            { role: REVIEWER.key, when: { taskTypeKeys: [3] } },
        ]);
    });

    it('offers the company priorities that are not deleted, and saves the value a task stores', async () => {
        expect(priorityChoices(COMPANY_PRIORITIES)).toEqual([{ value: 'HIGH', label: 'High' }, { value: 'LOW', label: 'Low' }]);
        const wrapper = await mountCard();
        await wrapper.find('[data-test="dispatcher-rule-add"]').trigger('click');
        const added = wrapper.findAll('[data-test="dispatcher-rule"]')[2];
        await added.findAll('select')[0].setValue('priority');
        const values = added.findAll('select')[1];
        expect(values.findAll('option').map((option) => option.text())).toEqual(['Dispatcher.rule_value', 'High', 'Low']);
        await values.setValue('LOW');
        await added.findAll('select')[2].setValue(REVIEWER.key);
        await wrapper.find('[data-test="dispatcher-save"]').trigger('click');
        await flushPromises();
        expect(putBody().rules[2]).toEqual({ role: REVIEWER.key, when: { priorities: ['LOW'] } });
    });

    it('saves a mode change with the saved roles and rules', async () => {
        const wrapper = await mountCard();
        await wrapper.find('[data-test="dispatcher-mode"]').setValue('apply');
        await flushPromises();
        expect(putBody()).toEqual({ mode: 'apply', roles: SETTINGS.roles, rules: SETTINGS.rules, threshold: 80, modelGuess: false });
    });

    it('lists the tasks that need routing and sends one to the role a lead picks', async () => {
        const wrapper = await mountCard();
        const need = wrapper.find('[data-test="dispatcher-need"]');
        expect(need.text()).toContain('Odd one');
        await need.find('select').setValue(REVIEWER.key);
        await need.find('[data-test="dispatcher-need-send"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', `${BASE}/task/t9/decisions/d9/route`, { role: REVIEWER.key });
        expect(wrapper.find('[data-test="dispatcher-need"]').exists()).toBe(false);
    });

    it('offers no editing to someone who is not a lead', async () => {
        const wrapper = await mountCard({ canEdit: false });
        expect(wrapper.find('[data-test="dispatcher-save"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="dispatcher-need-send"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="dispatcher-mode"]').attributes('disabled')).toBeDefined();
    });

    it('reads the settings again when the dispatcher announces a change', async () => {
        await mountCard();
        const reads = apiRequest.mock.calls.length;
        socket.handlers.dispatcherChanged({ kind: 'dispatcherSettings' });
        await flushPromises();
        expect(apiRequest.mock.calls.length).toBeGreaterThan(reads);
        expect(apiRequest).toHaveBeenLastCalledWith('get', `${BASE}/project/p1/needs-routing`, undefined);
    });
});
