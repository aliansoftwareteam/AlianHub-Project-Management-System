import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest, echo, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    echo: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: echo }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: { 'u-priya': 'Priya' }[id] || 'Someone' }) }) }));

import TaskAssignmentSuggestion from '@/components/organisms/TaskDetailOverlay/TaskAssignmentSuggestion.vue';

const ok = (data) => Promise.resolve({ data: { status: true, data } });

const decision = (over = {}) => ({ _id: 'd1', state: 'suggested', userId: 'u-priya', reason: 'matched her rule: frontend bugs', source: 'model', ...over });

const mountChip = async ({ found = decision(), task = { _id: 't1', AssigneeUserId: [] }, canAssign = true } = {}) => {
    apiRequest.mockImplementation((type) => (type === 'get' ? ok({ decision: found, pending: false }) : ok({})));
    const wrapper = mount(TaskAssignmentSuggestion, { props: { task, canAssign }, global: { mocks: { $t: echo } } });
    await flushPromises();
    return wrapper;
};

const chip = (wrapper) => wrapper.find('[data-test="assignment-suggestion"]');

describe('TaskAssignmentSuggestion', () => {
    beforeEach(() => { apiRequest.mockReset(); toast.error.mockReset(); });

    it('shows who AI suggests and why, with Assign and Dismiss', async () => {
        const wrapper = await mountChip();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/assignment-rules/task/t1', undefined);
        expect(chip(wrapper).text()).toContain('AssignmentRules.chip_suggests {"name":"Priya"}');
        expect(chip(wrapper).text()).toContain('matched her rule: frontend bugs');
        expect(wrapper.find('[data-test="suggestion-assign"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="suggestion-dismiss"]').exists()).toBe(true);
    });

    it('names a fallback as the fallback, not as a rule match', async () => {
        const wrapper = await mountChip({ found: decision({ source: 'fallback', reason: 'no rule matched' }) });
        expect(chip(wrapper).text()).toContain('AssignmentRules.chip_fallback');
    });

    it('assigns through the suggestion endpoint and hides the chip', async () => {
        const wrapper = await mountChip();
        await wrapper.find('[data-test="suggestion-assign"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/assignment-rules/task/t1/decisions/d1/accept', {});
        expect(chip(wrapper).exists()).toBe(false);
    });

    it('dismisses and hides the chip', async () => {
        const wrapper = await mountChip();
        await wrapper.find('[data-test="suggestion-dismiss"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/assignment-rules/task/t1/decisions/d1/dismiss', {});
        expect(chip(wrapper).exists()).toBe(false);
    });

    it('offers undo for a rule assignment while that person is still assigned', async () => {
        const wrapper = await mountChip({ found: decision({ state: 'applied' }), task: { _id: 't1', AssigneeUserId: ['u-priya'] } });
        expect(chip(wrapper).text()).toContain('AssignmentRules.chip_assigned_by_rule');
        expect(chip(wrapper).text()).toContain('matched her rule: frontend bugs');
        await wrapper.find('[data-test="suggestion-undo"]').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/assignment-rules/task/t1/decisions/d1/undo', {});
    });

    it('stays hidden once the task has an assignee', async () => {
        const wrapper = await mountChip({ task: { _id: 't1', AssigneeUserId: ['u-sam'] } });
        expect(chip(wrapper).exists()).toBe(false);
    });

    it('shows the reason but no actions without the assignee permission', async () => {
        const wrapper = await mountChip({ canAssign: false });
        expect(chip(wrapper).exists()).toBe(true);
        expect(wrapper.find('[data-test="suggestion-assign"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="suggestion-dismiss"]').exists()).toBe(false);
    });

    it('renders nothing when there is no decision', async () => {
        const wrapper = await mountChip({ found: null });
        expect(chip(wrapper).exists()).toBe(false);
    });

    it('keeps the chip and reports a refused accept', async () => {
        const refusal = Object.assign(new Error('Request failed'), { response: { status: 409, data: { status: false, statusText: 'This task already has an assignee.' } } });
        const wrapper = await mountChip();
        apiRequest.mockImplementation(() => Promise.reject(refusal));
        await wrapper.find('[data-test="suggestion-assign"]').trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('This task already has an assignee.', expect.any(Object));
    });
});
