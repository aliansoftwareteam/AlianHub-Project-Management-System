import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';

const { api } = vi.hoisted(() => ({ api: { apiRequest: vi.fn() } }));
vi.mock('@/services', () => api);
vi.mock('vuex', () => ({ useStore: () => ({ getters: {}, commit: vi.fn(), dispatch: vi.fn() }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }), useCustomComposable: () => ({ checkPermission: () => true }) }));

import PageDocument from '@/components/molecules/Pages/PageDocument.vue';

const ME = 'user-1';

async function openDoc(doc) {
    api.apiRequest.mockResolvedValue({ status: 200, data: { status: true, data: { _id: 'p1', title: 'Plan', content: { html: '<p>Body</p>' }, visibility: 'project', ...doc } } });
    const wrapper = shallowMount(PageDocument, { props: { pageId: 'p1' } });
    await flushPromises();
    return wrapper;
}

const propSwitch = (wrapper) => wrapper.find('.pd__prop--btn');

async function panelSwitch(wrapper) {
    api.apiRequest.mockResolvedValue({ data: { status: true, data: null } });
    await wrapper.findAll('.pd__actions .ah-btn--secondary').find((b) => b.text().includes('Docs.share')).trigger('click');
    await flushPromises();
    return wrapper.find('.pd__share .pd__switch');
}

const visibilityWrites = () => api.apiRequest.mock.calls.filter(([method, , body]) => method === 'put' && body && 'visibility' in body);

describe('doc private switch', () => {
    beforeEach(() => api.apiRequest.mockReset());

    it('is off for someone who did not write the doc, with the reason on it', async () => {
        const wrapper = await openDoc({ createdBy: 'user-2' });

        const inline = propSwitch(wrapper);
        expect(inline.attributes('disabled')).toBeDefined();
        expect(inline.attributes('title')).toBe('Projects.doc_private_author_only');
        await inline.trigger('click');

        const inPanel = await panelSwitch(wrapper);
        expect(inPanel.attributes('disabled')).toBeDefined();
        expect(inPanel.attributes('title')).toBe('Projects.doc_private_author_only');
        await inPanel.trigger('click');

        expect(visibilityWrites()).toEqual([]);
    });

    it('works for the author', async () => {
        const wrapper = await openDoc({ createdBy: ME });

        const inline = propSwitch(wrapper);
        expect(inline.attributes('disabled')).toBeUndefined();
        expect(inline.attributes('title')).toBe('Projects.doc_shared_hint');
        expect((await panelSwitch(wrapper)).attributes('disabled')).toBeUndefined();

        api.apiRequest.mockResolvedValue({ data: { status: true, data: { visibility: 'private' } } });
        await inline.trigger('click');
        expect(visibilityWrites().map(([, , body]) => body)).toEqual([{ visibility: 'private' }]);
    });
});
