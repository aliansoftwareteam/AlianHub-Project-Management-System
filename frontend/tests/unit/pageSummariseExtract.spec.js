import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { api } = vi.hoisted(() => ({ api: { compose: null } }));

vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url) => {
        if (String(url).endsWith('/ai-status')) return Promise.resolve({ data: { status: true, data: { configured: true } } });
        return Promise.resolve({ data: api.compose });
    })
}));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/molecules/AiPreview/AiTaskChecklist.vue', () => ({
    default: { name: 'AiTaskChecklist', props: ['kind', 'sourceId', 'returnFocus'], emits: ['close'], template: '<div class="atc-stub" :data-kind="kind" :data-source="sourceId" />' }
}));

import { apiRequest } from '@/services';
import PageComposeRail from '@/components/molecules/Pages/PageComposeRail.vue';

const BLOCKS = { blocks: [{ type: 'paragraph', data: { text: 'In short: ship on the 4th.' } }] };

function mountRail() {
    return mount(PageComposeRail, {
        attachTo: document.body.appendChild(document.createElement('div')),
        props: { pageId: 'page-1', title: 'Plan', currentText: 'A long plan' }
    });
}

beforeEach(() => {
    apiRequest.mockClear();
    api.compose = { status: true, data: { markdown: 'In short: ship on the 4th.', previewText: 'In short…', blocks: BLOCKS } };
});
afterEach(() => { document.body.innerHTML = ''; });

describe('Summarise this page', () => {
    it('summarises the page into a preview offering Insert at top and Copy, never Replace', async () => {
        const wrapper = mountRail();
        await wrapper.get('.pcr__summarise').trigger('click');
        await flushPromises();

        const [[, , body]] = apiRequest.mock.calls.filter(([method, url]) => method === 'post' && String(url).endsWith('/ai'));
        expect(body).toEqual(expect.objectContaining({ action: 'summarize', pageId: 'page-1' }));
        const preview = wrapper.get('.aip');
        expect(preview.text()).toContain('In short: ship on the 4th.');
        expect(preview.find('.aip__replace').exists()).toBe(false);
        expect(preview.find('.aip__copy').exists()).toBe(true);
        expect(preview.get('.aip__insert').text()).toBe('Projects.pages_ai_insert_top');
    });

    it('puts the summary at the top of the page only on Insert', async () => {
        const wrapper = mountRail();
        await wrapper.get('.pcr__summarise').trigger('click');
        await flushPromises();
        expect(wrapper.emitted('apply')).toBeUndefined();

        await wrapper.get('.aip__insert').trigger('click');
        expect(wrapper.emitted('apply')).toEqual([[{ mode: 'prepend', blocks: BLOCKS }]]);
    });
});

describe('Extract action items', () => {
    it('opens the task checklist for this page and closes it again', async () => {
        const wrapper = mountRail();
        await wrapper.get('.pcr__extract').trigger('click');

        const checklist = wrapper.get('.atc-stub');
        expect(checklist.attributes('data-kind')).toBe('page');
        expect(checklist.attributes('data-source')).toBe('page-1');

        await wrapper.findComponent({ name: 'AiTaskChecklist' }).vm.$emit('close');
        expect(wrapper.find('.atc-stub').exists()).toBe(false);
    });
});
