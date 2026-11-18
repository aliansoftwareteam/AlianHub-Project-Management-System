import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';

const { api } = vi.hoisted(() => ({ api: { apiRequest: vi.fn() } }));
vi.mock('@/services', () => api);
vi.mock('vuex', () => ({ useStore: () => ({ getters: {}, commit: vi.fn(), dispatch: vi.fn() }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }), useCustomComposable: () => ({ checkPermission: () => true }) }));

import PageDocument from '@/components/molecules/Pages/PageDocument.vue';
import PageHistory from '@/components/molecules/Pages/PageHistory.vue';
import PageBlockEditor from '@/components/molecules/Pages/PageBlockEditor.vue';

const doc = (over = {}) => ({ _id: 'p1', title: 'Plan', content: { html: '<p>Body</p>', blocks: { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'Body' } }] } }, visibility: 'project', ...over });

async function openDoc() {
    api.apiRequest.mockResolvedValue({ status: 200, data: { status: true, data: doc() } });
    const wrapper = shallowMount(PageDocument, { props: { pageId: 'p1' } });
    await flushPromises();
    return wrapper;
}

const historyButton = (wrapper) => wrapper.findAll('.pd__actions .ah-btn--secondary').find((b) => b.text().includes('Docs.history'));
const pageLoads = () => api.apiRequest.mock.calls.filter(([method, url]) => method === 'get' && url.endsWith('/pages/p1'));

describe('doc history from the doc', () => {
    beforeEach(() => api.apiRequest.mockReset());

    it('opens from a button that says whether it is open, with the doc as it is now', async () => {
        const wrapper = await openDoc();
        expect(wrapper.findComponent(PageHistory).exists()).toBe(false);
        expect(historyButton(wrapper).attributes('aria-expanded')).toBe('false');

        await historyButton(wrapper).trigger('click');

        const panel = wrapper.findComponent(PageHistory);
        expect(historyButton(wrapper).attributes('aria-expanded')).toBe('true');
        expect(panel.props()).toMatchObject({ pageId: 'p1', currentTitle: 'Plan', currentBlocks: [{ id: 'a', type: 'paragraph', data: { text: 'Body' } }] });
        expect(typeof panel.props('savePending')).toBe('function');
        expect(typeof panel.props('beforeRestore')).toBe('function');

        await panel.vm.$emit('close');
        expect(wrapper.findComponent(PageHistory).exists()).toBe(false);
    });

    it('closes on Escape before anything else', async () => {
        const wrapper = await openDoc();
        await historyButton(wrapper).trigger('click');

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await flushPromises();

        expect(wrapper.findComponent(PageHistory).exists()).toBe(false);
        expect(wrapper.emitted('close')).toBeUndefined();
        wrapper.unmount();
    });

    it('loads the restored doc again and gives the editor a fresh start', async () => {
        const wrapper = await openDoc();
        const firstKey = wrapper.findComponent(PageBlockEditor).props('editorKey');
        await historyButton(wrapper).trigger('click');

        api.apiRequest.mockResolvedValue({ status: 200, data: { status: true, data: doc({ title: 'Plan (draft)' }) } });
        await wrapper.findComponent(PageHistory).vm.$emit('restored', { _id: 'p1', title: 'Plan (draft)' });
        await flushPromises();

        expect(pageLoads()).toHaveLength(2);
        expect(wrapper.findComponent(PageHistory).exists()).toBe(false);
        expect(wrapper.find('.pd__title').element.value).toBe('Plan (draft)');
        expect(wrapper.findComponent(PageBlockEditor).props('editorKey')).not.toBe(firstKey);
        expect(wrapper.emitted('saved').at(-1)[0]).toMatchObject({ title: 'Plan (draft)' });
        wrapper.unmount();
    });
});
