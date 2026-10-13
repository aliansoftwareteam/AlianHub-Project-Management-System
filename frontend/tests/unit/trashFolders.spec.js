import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({ id: 'user-1', Employee_Name: 'Mia' }) }) }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));

import TrashPage from '@/views/Trash/TrashPage.vue';

const FOLDER = { _id: 'f1', kind: 'folders', title: 'Design', code: '', projectId: 'p1', updatedAt: '2026-10-01T00:00:00.000Z' };
const refusal = (statusText) => Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { status: false, statusText } } });

const open = async () => {
    const store = createStore({ getters: { 'projectData/allProjects': () => ({ data: [{ _id: 'p1', ProjectName: 'Alpha' }] }) } });
    const wrapper = mount(TrashPage, { global: { plugins: [store], stubs: { EmptyState: true } } });
    await flushPromises();
    return wrapper;
};
const tab = (wrapper, label) => wrapper.findAll('[role="tab"]').find((button) => button.text() === label);

beforeEach(() => {
    Object.values(toast).forEach((spy) => spy.mockClear());
    apiRequest.mockReset();
    apiRequest.mockImplementation((method, url) => Promise.resolve({ data: { status: true, data: method === 'get' && url.endsWith('kind=folders') ? [FOLDER] : [] } }));
});

describe('folders in the trash', () => {
    it('have their own tab, after projects', async () => {
        const wrapper = await open();
        expect(wrapper.findAll('[role="tab"]').map((button) => button.text())).toEqual(['Trash.projects', 'Trash.folders', 'Trash.lists', 'Trash.tasks', 'Trash.docs']);
    });

    it('are listed with their project and restored through the trash', async () => {
        const wrapper = await open();
        await tab(wrapper, 'Trash.folders').trigger('click');
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/trash?kind=folders');
        expect(wrapper.find('.tr__row').text()).toContain('Design');
        expect(wrapper.find('.tr__row').text()).toContain('Alpha');

        await wrapper.find('.tr__row button').trigger('click');
        await flushPromises();
        expect(apiRequest.mock.calls.find(([method]) => method === 'put').slice(0, 2)).toEqual(['put', '/api/v2/trash/folders/f1/restore']);
        expect(wrapper.find('.tr__row').exists()).toBe(false);
        expect(toast.success).toHaveBeenCalledWith('Trash.restored', { position: 'top-right' });
    });

    it('say why when the restore is refused, and stay listed', async () => {
        const wrapper = await open();
        await tab(wrapper, 'Trash.folders').trigger('click');
        await flushPromises();
        apiRequest.mockImplementation((method) => (method === 'put'
            ? Promise.reject(refusal('The parent folder is archived or deleted. Restore the parent folder first.'))
            : Promise.resolve({ data: { status: true, data: [FOLDER] } })));

        await wrapper.find('.tr__row button').trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('The parent folder is archived or deleted. Restore the parent folder first.', { position: 'top-right' });
        expect(wrapper.find('.tr__row').exists()).toBe(true);
    });

    it('fall back to the general message when no reason comes back', async () => {
        const wrapper = await open();
        await tab(wrapper, 'Trash.folders').trigger('click');
        await flushPromises();
        apiRequest.mockImplementation((method) => (method === 'put' ? Promise.reject(new Error('Network Error')) : Promise.resolve({ data: { status: true, data: [FOLDER] } })));
        await wrapper.find('.tr__row button').trigger('click');
        await flushPromises();
        expect(toast.error).toHaveBeenCalledWith('Trash.restore_failed', { position: 'top-right' });
    });
});
