import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));

import AiTaskCreator from '@/components/organisms/AiTaskCreator/AiTaskCreator.vue';

const PROJECT = 'p1';
const PLAN_URL = `/api/v1/ai/project/${PROJECT}/tasks/plan`;
const EXECUTE_URL = `/api/v1/ai/project/${PROJECT}/tasks/execute`;
const plan = { sprints: [{ sprintName: 'Week 1', tasks: [{ TaskName: 'One' }, { TaskName: 'Two' }] }, { sprintName: 'Week 2', tasks: [{ TaskName: 'Three' }] }] };

class FakeEventSource { constructor() { this.onmessage = null; } close() {} }

function routes(execute) {
    apiRequest.mockImplementation((method, url) => {
        if (url === PLAN_URL) return Promise.resolve({ data: { status: true, planId: 'tp-1', plan: JSON.parse(JSON.stringify(plan)) } });
        if (url === EXECUTE_URL) return execute();
        return Promise.resolve({ data: { status: false } });
    });
}

async function reachPreview() {
    const wrapper = mount(AiTaskCreator, { props: { modelValue: false, projectId: PROJECT }, global: { stubs: { teleport: true } } });
    await wrapper.setProps({ modelValue: true });
    await wrapper.find('textarea').setValue('Plan the launch of the shop');
    await wrapper.vm.generate();
    await flushPromises();
    return wrapper;
}

describe('AiTaskCreator makes the plan the server stored', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        window.EventSource = FakeEventSource;
    });

    it('sends the planId and the places of the ticked tasks, never the plan', async () => {
        routes(() => Promise.resolve({ data: { status: true, jobId: 'job-1' } }));
        const wrapper = await reachPreview();
        expect(wrapper.vm.step).toBe('preview');
        wrapper.vm.plan.sprints[0].tasks[1].__selected = false;
        await wrapper.vm.create();
        await flushPromises();
        const body = apiRequest.mock.calls.find((c) => c[1] === EXECUTE_URL)[2];
        expect(body).toMatchObject({ planId: 'tp-1', keep: [0, 2], mode: 'full' });
        expect(body).not.toHaveProperty('plan');
    });

    it.each([
        [410, 'AiTask.plan_expired'],
        [409, 'AiTask.plan_in_use'],
    ])('explains a %s answer', async (status, message) => {
        routes(() => Promise.reject({ response: { status, data: { status: false } } }));
        const wrapper = await reachPreview();
        await wrapper.vm.create();
        await flushPromises();
        expect(wrapper.vm.step).toBe('preview');
        expect(wrapper.vm.error).toBe(message);
    });
});
