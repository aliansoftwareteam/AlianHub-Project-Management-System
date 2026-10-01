import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import TaskSummaryBlock from '@/components/organisms/TaskDetailOverlay/TaskSummaryBlock.vue';

enableAutoUnmount(afterEach);

const URL = '/api/v1/ai/task-summary';
const ok = (data) => ({ data: { status: true, data } });
const kept = (over = {}) => ok({ summary: 'Shipping on Friday.', commentCount: 3, updatedAt: '2026-09-30T10:00:00.000Z', cached: true, ...over });
const none = (commentCount = 3) => ok({ summary: '', commentCount, updatedAt: '', cached: false, pending: commentCount > 0 });

const bodies = () => apiRequest.mock.calls.filter(([, url]) => url === URL).map(([, , body]) => body);
const modelRequests = () => bodies().filter((body) => body.keptOnly !== true);

const open = async (props = {}) => {
    const wrapper = mount(TaskSummaryBlock, { props: { taskId: 'task-1', pollMs: 0, ...props } });
    await flushPromises();
    return wrapper;
};
const askButton = (wrapper) => wrapper.find('[data-test="summary-ask"]');

describe('the task panel summary', () => {
    beforeEach(() => { apiRequest.mockReset(); });
    afterEach(() => { vi.useRealTimers(); });

    it('shows a summary the server already has when the task opens, without asking for one', async () => {
        apiRequest.mockResolvedValue(kept());
        const wrapper = await open();
        expect(bodies()).toEqual([{ taskId: 'task-1', force: false, keptOnly: true }]);
        expect(wrapper.find('.ah-summary__text').text()).toBe('Shipping on Friday.');
        expect(askButton(wrapper).exists()).toBe(false);
        expect(wrapper.emitted('count')[0]).toEqual([3]);
    });

    it('offers to summarise a thread that has no summary yet, and asks only when the person presses it', async () => {
        apiRequest.mockResolvedValue(none());
        const wrapper = await open();
        expect(modelRequests()).toEqual([]);
        expect(askButton(wrapper).text()).toContain('TaskPanel.summarise_thread');
        expect(wrapper.emitted('count')[0]).toEqual([3]);

        apiRequest.mockResolvedValue(kept({ cached: false }));
        await askButton(wrapper).trigger('click');
        await flushPromises();
        expect(modelRequests()).toEqual([{ taskId: 'task-1', force: false, keptOnly: false }]);
        expect(wrapper.find('.ah-summary__text').text()).toBe('Shipping on Friday.');
        expect(askButton(wrapper).exists()).toBe(false);
    });

    it('stays out of the way of a task nobody has commented on', async () => {
        apiRequest.mockResolvedValue(none(0));
        const wrapper = await open();
        expect(wrapper.find('.ah-summary').exists()).toBe(false);
        expect(modelRequests()).toEqual([]);
    });

    it('does not ask when a comment arrives, when it polls, or when another task opens', async () => {
        vi.useFakeTimers();
        apiRequest.mockResolvedValue(kept());
        const wrapper = await open({ pollMs: 60000 });

        await wrapper.vm.refresh();
        await vi.advanceTimersByTimeAsync(180000);
        await wrapper.setProps({ taskId: 'task-2' });
        await flushPromises();

        expect(bodies().length).toBeGreaterThanOrEqual(5);
        expect(modelRequests()).toEqual([]);
    });

    it('keeps the summary it shows when the thread has moved on, and says it is behind', async () => {
        apiRequest.mockResolvedValue(kept());
        const wrapper = await open();
        apiRequest.mockResolvedValue(none(4));
        await wrapper.vm.refresh();
        await flushPromises();

        expect(wrapper.find('.ah-summary__text').text()).toBe('Shipping on Friday.');
        expect(wrapper.find('[data-test="summary-behind"]').text()).toContain('TaskPanel.summary_behind');
        expect(wrapper.emitted('count').at(-1)).toEqual([4]);
        expect(modelRequests()).toEqual([]);
    });

    it('asks again when the person presses refresh', async () => {
        apiRequest.mockResolvedValue(kept());
        const wrapper = await open();
        await wrapper.find('.ah-summary__refresh').trigger('click');
        await flushPromises();
        expect(modelRequests()).toEqual([{ taskId: 'task-1', force: true, keptOnly: false }]);
    });
});
