import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, shallowMount } from '@vue/test-utils';

const api = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => api);
vi.mock('../../src/services', () => api);
vi.mock('vuex', () => ({ useStore: () => ({ getters: {}, commit: vi.fn(), dispatch: vi.fn() }) }));
vi.mock('vue3-editor', () => ({ VueEditor: { template: '<div />' } }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: () => ({ Employee_Name: 'Max' }) }),
    useCustomComposable: () => ({ checkGenerateResponseLimit: vi.fn(), checkPermission: () => true, debouncerWithPromise: vi.fn(), makeUniqueId: () => 'u1' }),
}));
vi.mock('@/composable/aiHelper', () => ({ useAiApiFunction: () => ({ generateAiRequestForFunction: vi.fn() }) }));
vi.mock('@/composable/commonFunction', () => ({ taskPlanPermission: () => ({ checkTaskPerSprintPermisssion: vi.fn() }) }));
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));

import Description from '@/components/atom/OldDescription/Description.vue';
import PagePresenter from '@/components/molecules/Pages/PagePresenter.vue';
import PageDocument from '@/components/molecules/Pages/PageDocument.vue';
import AiWriteDescription from '@/components/molecules/AiWriteDescription/AiWriteDescription.vue';
import HubAiSidebar from '@/components/molecules/HubAiSidebar/HubAiSidebar.vue';
import { createBlockTools } from '@/components/molecules/Pages/blockTools';

const MARKUP = '<img src="x" onerror="alert(1)"><a href="javascript:alert(2)">bad</a><script>alert(3)</script>';
const unsafe = (root) => root.querySelectorAll('script, [onerror], a[href^="javascript"]');

describe('task description', () => {
    it('sanitises the stored description and keeps its formatting', () => {
        const wrapper = shallowMount(Description, { props: { description: `<p><strong>Plan</strong> <a href="https://x.test">doc</a></p>${MARKUP}` } });
        expect(unsafe(wrapper.element)).toHaveLength(0);
        expect(wrapper.find('.ql-editor strong').text()).toBe('Plan');
        expect(wrapper.find('.ql-editor a').attributes('href')).toBe('https://x.test');
    });
});

describe('page presenter', () => {
    it('sanitises block text and keeps its formatting', () => {
        const blocks = { blocks: [{ type: 'paragraph', data: { text: `<b>Bold</b>${MARKUP}` } }] };
        const wrapper = mount(PagePresenter, { props: { title: 'T', blocks }, global: { stubs: { ShellIcon: true } }, attachTo: document.body });
        const body = document.body.querySelector('.pp__body');
        expect(unsafe(body)).toHaveLength(0);
        expect(body.querySelector('b').textContent).toBe('Bold');
        wrapper.unmount();
    });
});

describe('page preview', () => {
    it('sanitises the stored page and keeps its formatting', async () => {
        api.apiRequest.mockResolvedValue({ status: 200, data: { status: true, data: { _id: 'p1', title: 'T', content: { html: `<h2>Head</h2>${MARKUP}` } } } });
        const wrapper = shallowMount(PageDocument, { props: { pageId: 'p1' } });
        await flushPromises();
        await wrapper.find('.ah-tab:nth-child(2)').trigger('click');
        await flushPromises();
        const preview = wrapper.find('.pd__preview');
        expect(unsafe(preview.element)).toHaveLength(0);
        expect(preview.find('h2').text()).toBe('Head');
    });
});

describe('page callout and quote blocks', () => {
    const tools = createBlockTools({ t: (key) => key });

    it('sanitises stored callout text when loaded', () => {
        const node = new tools.callout.class({ data: { text: `<b>Note</b>${MARKUP}`, tone: 'info' }, readOnly: true }).render();
        expect(unsafe(node)).toHaveLength(0);
        expect(node.querySelector('.pb-callout__text b').textContent).toBe('Note');
    });

    it('sanitises stored quote text when loaded', () => {
        const node = new tools.quote.class({ data: { text: `<i>Said</i>${MARKUP}` }, readOnly: true }).render();
        expect(unsafe(node)).toHaveLength(0);
        expect(node.querySelector('i').textContent).toBe('Said');
    });
});

describe('ai write description', () => {
    it('renders the generated markdown with formatting and no markup from it', async () => {
        const wrapper = shallowMount(AiWriteDescription, { props: { modelValue: true } });
        wrapper.vm.generatedMarkdown = `**Goal** [link](https://x.test)\n\n${MARKUP}`;
        wrapper.vm.step = 'preview';
        await wrapper.vm.$nextTick();
        const preview = wrapper.find('.aiwd-preview');
        expect(unsafe(preview.element)).toHaveLength(0);
        expect(preview.find('strong').text()).toBe('Goal');
        expect(preview.find('a').attributes('rel')).toBe('noopener noreferrer');
    });
});

describe('hub ai sidebar', () => {
    it('sanitises the ai description and keeps its formatting', () => {
        const wrapper = shallowMount(HubAiSidebar, {
            props: { selectedPrompt: { title: 'P' }, content: { uID: 'u1', title: 'T', description: `<p><em>Idea</em></p>${MARKUP}`, displayButton: [] } },
            global: { stubs: { Sidebar: { template: '<div><slot name="body" /></div>' } }, provide: { injectDescription: null } },
        });
        const description = wrapper.find('#description-single');
        expect(unsafe(description.element)).toHaveLength(0);
        expect(description.find('em').text()).toBe('Idea');
    });
});
