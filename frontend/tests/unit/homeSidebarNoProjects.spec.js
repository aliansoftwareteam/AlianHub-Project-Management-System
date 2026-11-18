/* Task 047 S-5: the Projects group of the Home sidebar on an account with none says what a project is
   and, to a person who may create one, offers to create it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createMemoryHistory, createRouter } from 'vue-router';

const perms = vi.hoisted(() => ({ create: true }));
const composable = vi.hoisted(() => ({ useCustomComposable: () => ({ checkPermission: (key) => (key === 'project.project_create' ? perms.create : true) }) }));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@/services', () => ({
    apiRequest: vi.fn(() => Promise.resolve({ data: { status: false } })),
    apiRequestWithoutCompnay: vi.fn(() => Promise.resolve({ data: { status: false } })),
}));

import HomeSidebar from '@/components/molecules/Home/HomeSidebar.vue';
import { shellState } from '@/components/organisms/Shell/shellState';
import { resetFavourites } from '@/composable/favourites';

const blank = { render: () => null };
let wrapper;

const open = async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [
            { path: '/:cid/home', name: 'Home', component: blank },
            { path: '/:cid/inbox', name: 'inbox', component: blank },
            { path: '/:cid/personal', name: 'PersonalList', component: blank },
        ],
    });
    await router.push({ name: 'Home', params: { cid: 'company-1' } });
    await router.isReady();
    const store = createStore({
        modules: {
            projectData: {
                namespaced: true,
                getters: { projects: () => ({ data: [] }), personalProject: () => null },
                actions: { setSprints: () => [] },
            },
        },
    });
    wrapper = mount(HomeSidebar, { attachTo: document.body, global: { plugins: [store, router] } });
    await flushPromises();
};

beforeEach(() => {
    perms.create = true;
    shellState.nav = { pinned: [], hidden: [] };
    resetFavourites();
});
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; });

describe('Home sidebar with no projects', () => {
    it('says what a project is and offers to create one', async () => {
        await open();
        expect(wrapper.find('[data-test="sidebar-no-projects"]').text()).toContain('Home.no_projects');
        const button = wrapper.find('[data-test="sidebar-create-project"]');
        expect(button.text()).toBe('Home.create_first_project');
        await button.trigger('click');
        expect(wrapper.emitted('create-project')).toHaveLength(1);
    });

    it('shows the sentence without the button to a person who may not create projects', async () => {
        perms.create = false;
        await open();
        expect(wrapper.find('[data-test="sidebar-no-projects"]').text()).toContain('Home.no_projects');
        expect(wrapper.find('[data-test="sidebar-create-project"]').exists()).toBe(false);
    });
});
