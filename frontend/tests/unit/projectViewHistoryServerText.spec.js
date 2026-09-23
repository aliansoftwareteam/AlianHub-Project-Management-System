import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import fs from 'fs';
import path from 'path';

const { apiRequest, editView, deleteView, editPrivateName, deletePrivateView } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    editView: vi.fn(),
    deleteView: vi.fn(),
    editPrivateName: vi.fn(),
    deletePrivateView: vi.fn(),
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('vuex', () => ({ useStore: () => ({ commit: vi.fn(), getters: { 'settings/companyOwnerDetail': { userId: 'owner-1' } } }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: 'Ada' }) }) }));
vi.mock('@/components/molecules/EmbedView/helper.js', () => ({ editView, deleteView }));
vi.mock('@/components/molecules/ProjectViews/helper.js', async (importOriginal) => ({ ...(await importOriginal()), editPrivateName, deletePrivateView }));

import * as env from '@/config/env';
import { useEmbedViews } from '@/views/Projects/composables/useEmbedViews';

const SRC = path.resolve(__dirname, '../../src');
const posted = () => apiRequest.mock.calls.filter(([method, url]) => method === 'post' && [env.HANDLE_HISTORY, env.HANDLE_NOTIFICATION].includes(url));

const withEmbedViews = (views) => {
    let api;
    const refs = { renameValue: ref({ name: '', id: '' }), openDelete: ref({ flag: true, data: null }) };
    mount(defineComponent({
        setup() {
            api = useEmbedViews(ref({ _id: 'project-1' }), ref(views), ref({ _id: 'cu-1' }), refs.renameValue, refs.openDelete, ref(null));
            return () => h('div');
        },
    }), { global: { provide: { $userId: ref('user-1'), $companyId: ref('company-1') } } });
    return { api, ...refs };
};

beforeEach(() => {
    [apiRequest, editView, deleteView, editPrivateName, deletePrivateView].forEach((fn) => fn.mockReset());
    [apiRequest, editView, deleteView, deletePrivateView].forEach((fn) => fn.mockImplementation(() => Promise.resolve({ status: true, data: {} })));
});

describe('project view changes leave their history text to the server', () => {
    it('the view list posts no history text', () => {
        const source = fs.readFileSync(path.join(SRC, 'components/atom/ViewsList/ViewsList.vue'), 'utf8');
        expect(source).not.toMatch(/HANDLE_HISTORY|HANDLE_NOTIFICATION/);
    });

    it.each([
        'components/molecules/ProjectViews/ViewsDropdown.vue',
        'components/molecules/EmbedView/EmbedView.vue',
        'views/Projects/composables/useEmbedViews.js',
    ])('%s posts history text only for private views, through the private view helper', (file) => {
        const source = fs.readFileSync(path.join(SRC, file), 'utf8');
        expect(source).not.toMatch(/HANDLE_HISTORY|HANDLE_NOTIFICATION/);
    });

    it('renaming and deleting a project embed view saves it and posts no text', async () => {
        const view = { _id: 'v1', id: 'v1', name: 'Budget sheet', isPrivate: false };
        const { api, renameValue, openDelete } = withEmbedViews([view]);
        renameValue.value = { name: 'Q3 budget', id: 'v1' };
        api.editViewName(view);
        openDelete.value = { flag: true, data: view };
        api.deleteEmbedView();
        await flushPromises();

        expect(editView).toHaveBeenCalledWith({ cid: 'company-1', pid: 'project-1' }, view, 'Q3 budget', 'name');
        expect(deleteView).toHaveBeenCalled();
        expect(posted()).toEqual([]);
    });

    it('a private embed view still records its own row, since private views are saved on the member', async () => {
        const view = { _id: 'p1', id: 'p1', name: 'Mine', isPrivate: true };
        const { api, openDelete } = withEmbedViews([view]);
        openDelete.value = { flag: true, data: view };
        api.deleteEmbedView();
        await flushPromises();

        expect(deletePrivateView).toHaveBeenCalled();
        expect(posted()).toHaveLength(1);
        expect(posted()[0][2]).toMatchObject({ type: 'project', projectId: 'project-1', object: { key: 'Project_Name' } });
    });
});
