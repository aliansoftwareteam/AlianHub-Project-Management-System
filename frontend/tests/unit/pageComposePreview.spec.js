import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { api, editorState } = vi.hoisted(() => ({
    api: { compose: null },
    editorState: { data: { blocks: [] }, renders: [] }
}));

vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url) => {
        if (String(url).endsWith('/ai-status')) return Promise.resolve({ data: { status: true, data: { configured: true } } });
        return Promise.resolve({ data: api.compose });
    })
}));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import { apiRequest } from '@/services';
import PageComposeRail from '@/components/molecules/Pages/PageComposeRail.vue';

const BLOCKS = { blocks: [{ type: 'paragraph', data: { text: 'New intro' } }] };

function mountRail() {
    return mount(PageComposeRail, {
        attachTo: document.body.appendChild(document.createElement('div')),
        props: { pageId: 'page-1', title: 'Plan', currentText: 'Old intro' }
    });
}

async function compose(wrapper, action = 'draft', instruction = 'Write an intro') {
    const tab = wrapper.findAll('.ah-tab').find((b) => b.text() === `Projects.pages_compose_${action}`);
    await tab.trigger('click');
    await wrapper.get('input').setValue(instruction);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
}

beforeEach(() => {
    apiRequest.mockClear();
    api.compose = { status: true, data: { markdown: 'New intro', previewText: 'New intro', blocks: BLOCKS } };
});
afterEach(() => { document.body.innerHTML = ''; });

describe('docs compose', () => {
    it('shows the result first and leaves the page alone', async () => {
        const wrapper = mountRail();
        await compose(wrapper);
        expect(wrapper.get('.aip').text()).toContain('New intro');
        expect(wrapper.emitted('apply')).toBeUndefined();
    });

    it('replaces the page only on Replace', async () => {
        const wrapper = mountRail();
        await compose(wrapper);
        await wrapper.get('.aip__replace').trigger('click');
        expect(wrapper.emitted('apply')).toEqual([[{ mode: 'replace', blocks: BLOCKS }]]);
        expect(wrapper.find('.aip').exists()).toBe(false);
    });

    it('adds below the page only on Insert', async () => {
        const wrapper = mountRail();
        await compose(wrapper);
        await wrapper.get('.aip__insert').trigger('click');
        expect(wrapper.emitted('apply')).toEqual([[{ mode: 'append', blocks: BLOCKS }]]);
    });

    it('drops the result on Cancel', async () => {
        const wrapper = mountRail();
        await compose(wrapper);
        await wrapper.get('.aip__cancel').trigger('click');
        expect(wrapper.find('.aip').exists()).toBe(false);
        expect(wrapper.emitted('apply')).toBeUndefined();
    });

    it('composes again on Try again with the same request', async () => {
        const wrapper = mountRail();
        await compose(wrapper);
        await wrapper.get('.aip__retry').trigger('click');
        await flushPromises();
        const calls = apiRequest.mock.calls.filter(([method, url]) => method === 'post' && String(url).endsWith('/ai'));
        expect(calls).toHaveLength(2);
        expect(calls[1][2]).toEqual(calls[0][2]);
        expect(wrapper.emitted('apply')).toBeUndefined();
    });

    it('offers Undo after applying and asks the page to restore', async () => {
        const wrapper = mountRail();
        await compose(wrapper);
        await wrapper.get('.aip__replace').trigger('click');
        await wrapper.get('.pcr__undo').trigger('click');
        expect(wrapper.emitted('undo')).toHaveLength(1);
        expect(wrapper.find('.pcr__undo').exists()).toBe(false);
    });

    it('shows an Ask answer in the preview with Copy and no way to write it into the page', async () => {
        api.compose = { status: true, data: { markdown: 'The launch is on the 4th.\nOwner: Ana', previewText: 'The launch…', blocks: BLOCKS } };
        const wrapper = mountRail();
        await compose(wrapper, 'ask', 'When is the launch?');
        const preview = wrapper.get('.aip');
        expect(preview.text()).toContain('The launch is on the 4th.');
        expect(preview.text()).toContain('Owner: Ana');
        expect(preview.find('.aip__copy').exists()).toBe(true);
        expect(preview.find('.aip__replace').exists()).toBe(false);
        expect(preview.find('.aip__insert').exists()).toBe(false);
        expect(wrapper.find('.pcr__notice').exists()).toBe(false);
    });
});

describe('the page editor keeps what an AI result replaced', () => {
    beforeEach(() => {
        editorState.data = { blocks: [{ type: 'paragraph', data: { text: 'Old intro' } }] };
        editorState.renders = [];
    });

    it('returns the content it replaced and puts it back on restore', async () => {
        vi.resetModules();
        vi.doMock('@editorjs/editorjs', () => ({
            default: class {
                constructor(opts) { this.opts = opts; setTimeout(() => opts.onReady && opts.onReady(), 0); }
                async save() { return JSON.parse(JSON.stringify(editorState.data)); }
                async render(data) { editorState.data = data; editorState.renders.push(data); }
                destroy() {}
            }
        }));
        for (const tool of ['header', 'nested-list', 'checklist', 'marker', 'code', 'inline-code', 'embed', 'table']) {
            vi.doMock(`@editorjs/${tool}`, () => ({ default: class {} }));
        }
        vi.doMock('vue-router', () => ({ useRoute: () => ({ params: {} }), useRouter: () => ({ push: vi.fn() }) }));
        vi.doMock('vuex', () => ({ useStore: () => ({ getters: {} }) }));
        vi.doMock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => null }) }));
        vi.doMock('@/components/molecules/Pages/blockTools', () => ({ createBlockTools: () => ({}), TASK_LIST_LIMIT: 20 }));
        const { default: PageBlockEditor } = await import('@/components/molecules/Pages/PageBlockEditor.vue');
        const wrapper = mount(PageBlockEditor, { attachTo: document.body.appendChild(document.createElement('div')), props: { seed: {}, editorKey: 'k1' } });
        await flushPromises();

        const replaced = await wrapper.vm.applyBlocks({ mode: 'replace', blocks: BLOCKS });
        expect(editorState.data.blocks.map((b) => b.data.text)).toEqual(['New intro']);
        expect(replaced.blocks.map((b) => b.data.text)).toEqual(['Old intro']);

        await wrapper.vm.restore(replaced);
        expect(editorState.data.blocks.map((b) => b.data.text)).toEqual(['Old intro']);
        expect(wrapper.emitted('change').length).toBeGreaterThanOrEqual(2);
    });
});
