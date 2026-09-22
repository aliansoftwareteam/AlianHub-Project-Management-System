import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, shallowMount } from '@vue/test-utils';

const api = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => api);
vi.mock('vuex', () => ({ useStore: () => ({ getters: { 'settings/selectedCompany': { planFeature: { embadeVIew: true } } } }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }));

import EmbedViewItem from '@/components/molecules/EmbedView/EmbedViewItem.vue';
import HtmlPreviewer from '@/components/molecules/HtmlPreviewer/HtmlPreviewer.vue';

const STORED = '<h1>Report</h1><img src="x" onerror="alert(1)"><script>alert(2)</script>';
const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('embed view with stored html', () => {
    it('renders the stored html in a frame with an empty sandbox, not in the page', async () => {
        const wrapper = mount(EmbedViewItem, {
            props: { data: { isPrivate: true, id: 'e1', type: 'Anything_html', html: STORED } },
            global: { stubs: { SpinnerComp: true, UpgradePlan: true } },
            attachTo: document.body,
        });
        await tick();
        await flushPromises();
        const frame = wrapper.find('iframe[srcdoc]');
        expect(frame.exists()).toBe(true);
        expect(frame.attributes('sandbox')).toBe('');
        expect(frame.attributes('srcdoc')).toBe(STORED);
        expect(wrapper.element.querySelectorAll('script, [onerror], h1')).toHaveLength(0);
        wrapper.unmount();
    });
});

describe('html file preview', () => {
    it('renders the uploaded file in a frame with an empty sandbox, not in the page', async () => {
        api.apiRequest.mockResolvedValue({ data: STORED });
        const wrapper = shallowMount(HtmlPreviewer, { props: { url: '/file.html' } });
        await flushPromises();
        const frame = wrapper.find('iframe.html-previewer');
        expect(frame.exists()).toBe(true);
        expect(frame.attributes('sandbox')).toBe('');
        expect(frame.attributes('srcdoc')).toBe(STORED);
        expect(wrapper.element.querySelectorAll('script, [onerror], h1')).toHaveLength(0);
    });
});
