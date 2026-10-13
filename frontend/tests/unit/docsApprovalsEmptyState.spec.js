/* Task 047 S-5: the project Docs view with no docs, and Approvals with nothing waiting, say what the place is for;
   Docs offers Add a page only to someone who may write docs. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/store/index', () => ({ default: { getters: {} } }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }) }));
vi.mock('@/views/Timesheet/TimesheetTabs.vue', () => ({ default: { name: 'TimesheetTabs', render: () => null } }));
vi.mock('@/components/molecules/Pages/PageDocument.vue', () => ({ default: { name: 'PageDocument', render: () => null } }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import PagesPanel from '@/components/molecules/Pages/PagesPanel.vue';
import Approvals from '@/views/Approvals/Approvals.vue';
import { ROLE_GUEST } from '@/utils/roles';

const store = (roleType) => createStore({
    modules: { settings: { namespaced: true, getters: { companyUserDetail: () => ({ roleType }) } } }
});

let wrapper;
beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation((method) => Promise.resolve({ data: { status: true, data: method === 'post' ? { _id: 'new' } : [] } }));
});
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; });

const docs = async (roleType) => {
    wrapper = mount(PagesPanel, { attachTo: document.body, props: { projectData: { _id: 'p1' }, embedded: true }, global: { plugins: [store(roleType)] } });
    await flushPromises();
    return wrapper.find('[data-test="docs-empty"]');
};

describe('Docs of a project with none', () => {
    it('says what a doc is for and offers Add a page, which creates the page', async () => {
        const empty = await docs(1);
        expect(empty.find('h3').text()).toBe('Docs.empty_title');
        expect(empty.find('.empty-state__btn').text()).toBe('Projects.add_page');
        await empty.find('.empty-state__btn').trigger('click');
        expect(apiRequest.mock.calls.some(([method]) => method === 'post')).toBe(true);
    });

    it('gives a guest the sentence without the button', async () => {
        const empty = await docs(ROLE_GUEST);
        expect(empty.text()).toContain('Docs.empty_msg');
        expect(empty.find('button').exists()).toBe(false);
    });
});

describe('Approvals with nothing waiting', () => {
    it('says what lands there and offers nothing to do', async () => {
        wrapper = mount(Approvals, { global: { plugins: [store(1)], mocks: { $t: (key) => key } } });
        await flushPromises();
        const empty = wrapper.find('[data-test="approvals-empty"]');
        expect(empty.find('h3').text()).toBe('Time.queue_empty_title');
        expect(empty.text()).toContain('Time.queue_empty');
        expect(empty.find('button').exists()).toBe(false);
    });
});
