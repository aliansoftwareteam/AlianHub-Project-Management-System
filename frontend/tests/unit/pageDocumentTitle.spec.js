import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';

const { api } = vi.hoisted(() => ({ api: { apiRequest: vi.fn() } }));
vi.mock('@/services', () => api);
vi.mock('vuex', () => ({ useStore: () => ({ getters: {}, commit: vi.fn(), dispatch: vi.fn() }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }) }));

import PageDocument from '@/components/molecules/Pages/PageDocument.vue';

const LONG = 'Quarterly planning notes for the platform team, covering hiring, the move off the legacy billing service and the on-call rota';

async function openDoc() {
    api.apiRequest.mockResolvedValue({ status: 200, data: { status: true, data: { _id: 'p1', title: LONG, content: { html: '<p>Body</p>' } } } });
    const wrapper = shallowMount(PageDocument, { props: { pageId: 'p1' } });
    await flushPromises();
    return wrapper;
}

describe('doc title', () => {
    beforeEach(() => api.apiRequest.mockReset());

    it('shows a long title in a field that wraps and grows, not a single-line input', async () => {
        const wrapper = await openDoc();
        const title = wrapper.find('.pd__title');
        expect(title.element.tagName).toBe('TEXTAREA');
        expect(title.attributes('rows')).toBe('1');
        expect(title.element.value).toBe(LONG);
        expect(wrapper.find('.pd__title-wrap').attributes('data-title')).toBe(LONG);
    });

    it('keeps Enter from adding a line break, and Enter still saves nothing', async () => {
        const wrapper = await openDoc();
        const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        wrapper.find('.pd__title').element.dispatchEvent(enter);
        await flushPromises();
        expect(enter.defaultPrevented).toBe(true);
        expect(api.apiRequest).toHaveBeenCalledTimes(1);
    });

    it('turns a pasted line break into a space, so the saved title stays on one line', async () => {
        const wrapper = await openDoc();
        const title = wrapper.find('.pd__title');
        await title.setValue('First line\nsecond line');
        expect(title.element.value).toBe('First line second line');

        api.apiRequest.mockResolvedValue({ data: { status: true, data: {} } });
        await wrapper.find('.ah-btn--primary').trigger('click');
        expect(api.apiRequest).toHaveBeenLastCalledWith('put', expect.any(String), expect.objectContaining({ title: 'First line second line' }));
    });
});
