import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

vi.mock('@/composable', () => ({ useCustomComposable: () => ({ debounce: (fn) => fn }) }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';

const Page = { render: () => null };

const makeRouter = () => createRouter({
    history: createMemoryHistory(),
    routes: [
        { path: '/:cid/project/:id/s/:sprintId', name: 'ProjectSprint', component: Page },
        { path: '/:cid/chat', name: 'Chat', component: Page }
    ]
});

const Host = defineComponent({
    setup() {
        const visible = ref(true);
        return { visible };
    },
    render() {
        return h(Sidebar, { title: 'List Of User', visible: this.visible, 'onUpdate:visible': (value) => { this.visible = value; } });
    }
});

const mounted = [];
afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    document.body.innerHTML = '';
});

async function openSheet(startAt) {
    const target = document.createElement('div');
    target.id = 'my-sidebar';
    document.body.appendChild(target);
    const router = makeRouter();
    await router.push(startAt);
    await router.isReady();
    const wrapper = mount(Host, { global: { plugins: [router] }, attachTo: document.body });
    mounted.push(wrapper);
    await flushPromises();
    return { router, wrapper };
}

const sheet = () => document.querySelector('#my-sidebar .sidebar-content');

describe('a side sheet opened from a picker', () => {
    it('closes when the page changes', async () => {
        const { router } = await openSheet('/c1/project/p1/s/s1?tab=list&task=t1');
        expect(sheet()).not.toBeNull();

        await router.push({ name: 'Chat', params: { cid: 'c1' } });
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(sheet()).toBeNull();
    });

    it('closes when the task panel moves to another task', async () => {
        const { router } = await openSheet('/c1/project/p1/s/s1?task=t1');

        await router.push({ query: { task: 't2' } });
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(sheet()).toBeNull();
    });

    it('stays open while only the other query parts change', async () => {
        const { router } = await openSheet('/c1/project/p1/s/s1?task=t1&tab=list');

        await router.push({ query: { task: 't1', tab: 'board' } });
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(sheet()).not.toBeNull();
    });
});
