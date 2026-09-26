import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createMemoryHistory, createRouter } from 'vue-router';

const composable = vi.hoisted(() => ({ useCustomComposable: () => ({ checkPermission: () => true }) }));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@/services', () => ({
    apiRequest: vi.fn(() => Promise.resolve({ data: { status: false } })),
    apiRequestWithoutCompnay: vi.fn(() => Promise.resolve({ data: { status: false } })),
}));

import HomeSidebar from '@/components/molecules/Home/HomeSidebar.vue';
import { shellState } from '@/components/organisms/Shell/shellState';

const INTERACTIVE = 'a[href], button, input, select, textarea, [role="link"], [role="button"], [tabindex]:not([tabindex="-1"])';
const blank = { render: () => null };

const open = async () => {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/:cid/home', name: 'Home', component: blank },
            { path: '/:cid/inbox', name: 'inbox', component: blank },
            { path: '/:cid/personal', name: 'PersonalList', component: blank },
            { path: '/:cid/project/:id', name: 'Project', component: blank },
            { path: '/:cid/project/:id/sprint/:sprintId', name: 'ProjectSprint', component: blank },
            { path: '/:cid/project/:id/folder/:folderId/sprint/:sprintId', name: 'ProjectFolderSprint', component: blank },
        ],
    });
    await router.push({ name: 'Home', params: { cid: 'company-1' } });
    await router.isReady();
    const store = createStore({
        modules: {
            projectData: {
                namespaced: true,
                getters: {
                    projects: () => ({ data: [{ _id: 'p1', ProjectName: 'Alpha' }, { _id: 'p2', ProjectName: 'Beta' }] }),
                    personalProject: () => null,
                },
                actions: { setSprints: () => [] },
            },
        },
    });
    const wrapper = mount(HomeSidebar, { attachTo: document.body, global: { plugins: [store, router] } });
    await flushPromises();
    return { wrapper, router };
};

const group = (wrapper, label) => wrapper.find(`nav[aria-label="${label}"]`).element;
const rowOf = (nav, name) => [...nav.querySelectorAll('.hs-item')].find((el) => el.textContent.includes(name));
const nameOf = (el) => el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent.trim();
const nestedControls = (root) => [root, ...root.querySelectorAll('*')]
    .filter((el) => el.matches(INTERACTIVE))
    .filter((el) => el.querySelector(INTERACTIVE));

describe('Home sidebar project rows', () => {
    beforeEach(() => {
        shellState.nav = { pinned: [], hidden: [] };
    });

    it('put no control inside another', async () => {
        const { wrapper } = await open();
        const nav = group(wrapper, 'Home.projects');
        expect(nestedControls(rowOf(nav, 'Alpha'))).toEqual([]);
        expect(nestedControls(rowOf(nav, 'Beta'))).toEqual([]);
        wrapper.unmount();
    });

    it('name the project with a link that opens it', async () => {
        const { wrapper, router } = await open();
        const row = rowOf(group(wrapper, 'Home.projects'), 'Alpha');
        const link = [...row.querySelectorAll('a[href]')].find((a) => a.textContent.trim() === 'Alpha');
        expect(link).toBeTruthy();
        expect(link.getAttribute('href')).toBe(router.resolve({ name: 'Project', params: { cid: 'company-1', id: 'p1' } }).href);

        link.click();
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('Project');
        expect(router.currentRoute.value.params.id).toBe('p1');
        wrapper.unmount();
    });

    it('keep pin and lists as named buttons that do not open the project', async () => {
        const { wrapper, router } = await open();
        const row = rowOf(group(wrapper, 'Home.projects'), 'Alpha');
        const buttons = [...row.querySelectorAll('button')];
        expect(buttons).toHaveLength(2);
        buttons.forEach((button) => {
            expect(button.getAttribute('type')).toBe('button');
            expect(nameOf(button)).not.toBe('');
        });
        const [pin, chevron] = buttons;
        expect(nameOf(pin)).toBe('Home.pin');
        expect(nameOf(chevron)).toBe('Home.show_lists');

        pin.click();
        chevron.click();
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('Home');
        expect(shellState.nav.pinned.map((f) => f.id)).toEqual(['p1']);
        expect(chevron.getAttribute('aria-expanded')).toBe('true');
        wrapper.unmount();
    });
});

describe('Home sidebar favorite rows', () => {
    beforeEach(() => {
        shellState.nav = { pinned: [{ id: 'p1', type: 'project', label: 'Alpha', to: { name: 'Project', params: { cid: 'company-1', id: 'p1' } } }], hidden: [] };
    });

    it('keep the unpin button beside the link, not inside it', async () => {
        const { wrapper, router } = await open();
        const row = rowOf(group(wrapper, 'Home.favorites'), 'Alpha');
        expect(nestedControls(row)).toEqual([]);

        const unpin = row.querySelector('button');
        expect(nameOf(unpin)).toBe('Home.unpin');
        unpin.click();
        await flushPromises();
        expect(router.currentRoute.value.name).toBe('Home');
        expect(shellState.nav.pinned).toEqual([]);
        wrapper.unmount();
    });
});
