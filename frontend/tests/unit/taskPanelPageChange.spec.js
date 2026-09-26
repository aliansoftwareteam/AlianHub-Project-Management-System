import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

const { stub } = vi.hoisted(() => ({ stub: (name) => ({ default: { name, render: () => null } }) }));

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: null })) }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskTimer', () => ({ initTimer: vi.fn() }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => stub('ShellIcon'));
vi.mock('@/components/molecules/UndoToast/UndoToast.vue', () => stub('UndoToast'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskDetailPanel.vue', () => ({
    default: {
        name: 'TaskDetailPanel',
        props: ['taskId'],
        emits: ['step', 'close', 'expand', 'minimize'],
        render() { return h('div', { class: 'panel-stub' }, this.taskId); }
    }
}));

import TaskDetailOverlay from '@/components/organisms/TaskDetailOverlay/TaskDetailOverlay.vue';
import { closeTask, openTask, overlayState, registerTaskSequence } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
import { taskNavAttrs } from '@/components/organisms/TaskDetailOverlay/taskNavigation';

const Page = { render: () => null };

function makeRouter() {
    return createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/:cid/home', name: 'Home', component: Page },
            { path: '/:cid/time', name: 'Time', component: Page },
            { path: '/:cid/project/:id/s/:sprintId', name: 'ProjectSprint', component: Page },
            { path: '/:cid/project/:id/s/:sprintId/:taskId', name: 'ProjectSprintTask', component: Page }
        ]
    });
}

function viewRows(ids) {
    const root = document.createElement('div');
    root.innerHTML = ids.map((id) => {
        const attrs = Object.entries(taskNavAttrs({ _id: id, sprintId: 's1' }, 'p1')).map(([k, v]) => `${k}="${v}"`).join(' ');
        return `<div ${attrs}></div>`;
    }).join('');
    return root;
}

describe('the task panel when you move to another page', () => {
    let router;
    let wrapper;
    let unregister;

    const panel = () => wrapper.findComponent({ name: 'TaskDetailPanel' });
    const here = () => router.currentRoute.value;

    beforeEach(async () => {
        router = makeRouter();
        await router.push('/c1/project/p1/s/s1');
        wrapper = mount(TaskDetailOverlay, { global: { plugins: [router] } });
        await router.isReady();
        const rows = viewRows(['t1', 't2', 't3']);
        unregister = registerTaskSequence(() => rows);
        openTask({ companyId: 'c1', projectId: 'p1', sprintId: 's1', taskId: 't1' });
        await flushPromises();
    });

    afterEach(() => {
        closeTask({ keepRoute: true });
        overlayState.minimized = [];
        unregister();
        wrapper.unmount();
    });

    it('opens as a side panel on the page it was opened from', () => {
        expect(here().query.task).toBe('t1');
        expect(panel().exists()).toBe(true);
    });

    it('closes when you go to Home', async () => {
        await router.push('/c1/home');
        await flushPromises();

        expect(overlayState.open).toBe(false);
        expect(overlayState.current).toBeNull();
        expect(panel().exists()).toBe(false);
        expect(here().fullPath).toBe('/c1/home');
    });

    it('closes when you go to Time from a page with other query params', async () => {
        await router.push({ query: { ...here().query, group: 'status' } });
        await router.push({ name: 'Time', params: { cid: 'c1' }, query: { range: 'week' } });
        await flushPromises();

        expect(overlayState.open).toBe(false);
        expect(here().fullPath).toBe('/c1/time?range=week');
    });

    it('stays open when only the query changes', async () => {
        await router.push({ query: { ...here().query, group: 'priority' } });
        await flushPromises();

        expect(overlayState.open).toBe(true);
        expect(overlayState.current.taskId).toBe('t1');
        expect(panel().exists()).toBe(true);
    });

    it('stays open while the panel steps to the next and previous task', async () => {
        panel().vm.$emit('step', 1);
        await flushPromises();
        expect(overlayState.current.taskId).toBe('t2');
        expect(here().query.task).toBe('t2');

        panel().vm.$emit('step', -1);
        await flushPromises();
        expect(overlayState.open).toBe(true);
        expect(overlayState.current.taskId).toBe('t1');
    });

    it('stays open when the panel expands to the full page and steps from there', async () => {
        panel().vm.$emit('expand');
        await flushPromises();
        expect(here().name).toBe('ProjectSprintTask');
        expect(overlayState.open).toBe(true);

        panel().vm.$emit('step', 1);
        await flushPromises();
        expect(here().params.taskId).toBe('t2');
        expect(overlayState.open).toBe(true);
        expect(overlayState.current.taskId).toBe('t2');
    });

    it('opens the task a new page asks for instead of closing it', async () => {
        await router.push({ name: 'Home', params: { cid: 'c1' }, query: { task: 't3' } });
        await flushPromises();

        expect(overlayState.open).toBe(true);
        expect(overlayState.current.taskId).toBe('t3');
        expect(here().query.task).toBe('t3');
    });
});
