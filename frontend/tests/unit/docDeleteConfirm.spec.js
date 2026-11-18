/* Task 047, tenth sweep — deleting a doc asks in the app's own dialog and says where the doc goes:
   the Trash in Docs, from where it can be restored. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';

const { api, toast } = vi.hoisted(() => ({ api: { apiRequest: vi.fn() }, toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services', () => api);
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vuex', () => ({ useStore: () => ({ getters: {}, commit: vi.fn(), dispatch: vi.fn() }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }), useCustomComposable: () => ({ checkPermission: () => true }) }));

import PageDocument from '@/components/molecules/Pages/PageDocument.vue';
import ConfirmDelete from '@/components/atom/ConfirmDelete/ConfirmDelete.vue';
import en from '@/locales/en.js';

enableAutoUnmount(afterEach);

const stubs = Object.fromEntries(['ShellIcon', 'WhoCanSeeModal', 'TaskChipPicker', 'PageBlockEditor', 'PageComposeRail', 'PagePresenter', 'PageComments', 'PageHistory', 'PageSharePeople'].map((name) => [name, true]));

async function openDoc() {
    api.apiRequest.mockResolvedValue({ status: 200, data: { status: true, data: { _id: 'p1', title: 'Plan', content: { html: '<p>Body</p>' }, visibility: 'project', createdBy: 'user-1' } } });
    const wrapper = mount(PageDocument, { props: { pageId: 'p1' }, attachTo: document.body, global: { stubs } });
    await flushPromises();
    return wrapper;
}

const deletes = () => api.apiRequest.mock.calls.filter(([method]) => method === 'delete');
const dialog = (wrapper) => wrapper.findComponent(ConfirmDelete);

describe('deleting a doc', () => {
    let browserConfirm;
    beforeEach(() => {
        api.apiRequest.mockReset();
        browserConfirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    });
    afterEach(() => browserConfirm.mockRestore());

    it('asks in the app\'s dialog, not the browser\'s, and deletes nothing yet', async () => {
        const wrapper = await openDoc();
        await wrapper.get('.pd__icon--danger').trigger('click');
        expect(browserConfirm).not.toHaveBeenCalled();
        expect(dialog(wrapper).exists()).toBe(true);
        expect(dialog(wrapper).props()).toMatchObject({ title: 'Projects.page_delete_title', description: 'Projects.page_delete_with_children', confirmLabel: 'Docs.delete' });
        expect(deletes()).toEqual([]);
    });

    it('says the doc goes to the Trash and can be restored', () => {
        expect(en.Projects.page_delete_title).toBe('Delete this doc?');
        expect(en.Projects.page_delete_with_children).toBe('The doc and every sub-page under it go to the Trash in Docs. You can restore them from there.');
        expect(en.Projects.page_delete_with_children).not.toMatch(/cannot be undone/i);
    });

    it('keeps the doc on Cancel', async () => {
        const wrapper = await openDoc();
        await wrapper.get('.pd__icon--danger').trigger('click');
        dialog(wrapper).vm.$emit('cancel');
        await flushPromises();
        expect(dialog(wrapper).exists()).toBe(false);
        expect(deletes()).toEqual([]);
        expect(wrapper.emitted('deleted')).toBeUndefined();
    });

    it('deletes it on Delete and tells the host', async () => {
        const wrapper = await openDoc();
        await wrapper.get('.pd__icon--danger').trigger('click');
        api.apiRequest.mockResolvedValue({ data: { status: true } });
        dialog(wrapper).vm.$emit('confirm');
        await flushPromises();
        expect(deletes()).toHaveLength(1);
        expect(wrapper.emitted('deleted')).toEqual([['p1']]);
        expect(toast.success).toHaveBeenCalledTimes(1);
    });
});
