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
    __esModule: true,
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
import { apiRequest } from '@/services';

const Page = { render: () => null };

function makeRouter() {
    return createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/:cid/chat', name: 'Chat', component: Page },
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

describe('the task panel follows the route', () => {
    let router;
    let wrapper;
    let unregister;

    const here = () => router.currentRoute.value;

    async function mountOverlay(startAt) {
        router = makeRouter();
        await router.push(startAt);
        wrapper = mount(TaskDetailOverlay, { global: { plugins: [router] } });
        await router.isReady();
        const rows = viewRows(['t1', 't2', 't3']);
        unregister = registerTaskSequence(() => rows);
        await flushPromises();
    }

    async function openOnPage() {
        openTask({ companyId: 'c1', projectId: 'p1', sprintId: 's1', taskId: 't1' });
        await flushPromises();
        await vi.dynamicImportSettled();
        await flushPromises();
    }

    afterEach(() => {
        closeTask({ keepRoute: true });
        overlayState.minimized = [];
        unregister?.();
        wrapper?.unmount();
    });

    describe('opened from a page', () => {
        beforeEach(async () => {
            await mountOverlay('/c1/project/p1/s/s1?tab=list');
            await openOnPage();
        });

        it('closes when the task query is removed from the URL', async () => {
            expect(overlayState.open).toBe(true);
            const { task, ...rest } = here().query;
            await router.push({ query: rest });
            await flushPromises();

            expect(overlayState.open).toBe(false);
            expect(overlayState.current).toBeNull();
            expect(wrapper.find('.ah-detail__panel').exists()).toBe(false);
        });

        it('closes on another page even when the task query is carried along', async () => {
            await router.push({ name: 'Chat', params: { cid: 'c1' }, query: { task: 't1' } });
            await flushPromises();

            expect(overlayState.open).toBe(false);
        });

        it('stays open when the task query moves to another task', async () => {
            await router.push({ query: { ...here().query, task: 't2' } });
            await flushPromises();

            expect(overlayState.open).toBe(true);
            expect(overlayState.current.taskId).toBe('t2');
        });

        it('stays open on a query change that keeps the same task', async () => {
            await router.push({ query: { ...here().query, tab: 'board' } });
            await flushPromises();

            expect(overlayState.open).toBe(true);
            expect(overlayState.current.taskId).toBe('t1');
        });
    });

    describe('opened by the URL', () => {
        it('does not close on the initial route resolution when the URL already has a task', async () => {
            router = makeRouter();
            wrapper = mount(TaskDetailOverlay, { global: { plugins: [router] } });
            const rows = viewRows(['t1', 't2']);
            unregister = registerTaskSequence(() => rows);
            await router.push('/c1/project/p1/s/s1?tab=list&task=t1');
            await router.isReady();
            await flushPromises();
            await vi.dynamicImportSettled();
            await flushPromises();

            expect(apiRequest).not.toHaveBeenCalledWith('get', expect.stringContaining('/t1'));
            expect(overlayState.open).toBe(true);
            expect(overlayState.current.taskId).toBe('t1');
        });
    });
});
