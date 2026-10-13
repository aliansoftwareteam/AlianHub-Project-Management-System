import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';

const { api } = vi.hoisted(() => ({ api: { apiRequest: vi.fn() } }));
vi.mock('@/services', () => api);
vi.mock('vuex', () => ({ useStore: () => ({ getters: {}, commit: vi.fn(), dispatch: vi.fn() }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }), useCustomComposable: () => ({ checkPermission: () => true }) }));

import PageDocument from '@/components/molecules/Pages/PageDocument.vue';
import PageBlockEditor from '@/components/molecules/Pages/PageBlockEditor.vue';
import PageHistory from '@/components/molecules/Pages/PageHistory.vue';
import { readUnsaved, unsavedKeyOf, SAVE_DELAY_MS } from '@/components/molecules/Pages/docAutosave';

const block = (text) => ({ id: 'a', type: 'paragraph', data: { text } });
const doc = (over = {}) => ({
    _id: 'p1', title: 'Plan', ProjectID: 'proj1', visibility: 'project', editedAt: 't0', updatedAt: '2026-10-01T09:00:00Z',
    content: { html: '<p>One</p>', blocks: { blocks: [block('One')] } }, ...over,
});

let server;
let put;

function route() {
    api.apiRequest.mockImplementation((method, url, body) => {
        if (method === 'get') return Promise.resolve({ status: 200, data: { status: true, data: server } });
        if (method === 'put') return put(body);
        if (method === 'post') return Promise.resolve({ data: { status: true, data: { _id: 'copy1', title: body.title } } });
        return Promise.resolve({ data: { status: true } });
    });
}

const calls = (method) => api.apiRequest.mock.calls.filter(([m]) => m === method);
const state = (wrapper) => wrapper.find('.pd__save-state').text();
const pause = async (ms = SAVE_DELAY_MS) => {
    await vi.advanceTimersByTimeAsync(ms);
    await flushPromises();
};

async function openDoc() {
    const wrapper = shallowMount(PageDocument, { props: { pageId: 'p1' } });
    await flushPromises();
    await wrapper.findComponent(PageBlockEditor).vm.$emit('ready');
    return wrapper;
}

async function type(wrapper, text) {
    await wrapper.findComponent(PageBlockEditor).vm.$emit('change', { blocks: { blocks: [block(text)] }, html: `<p>${text}</p>` });
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    localStorage.clear();
    api.apiRequest.mockReset();
    server = doc();
    put = vi.fn(() => Promise.resolve({ data: { status: true, data: { _id: 'p1', title: 'Plan', editedAt: 't1' } } }));
    route();
});
afterEach(() => vi.useRealTimers());

describe('a doc saves itself', () => {
    it('shows Saving while a change waits, saves after the pause, and then shows Saved', async () => {
        const wrapper = await openDoc();
        expect(state(wrapper)).toBe('Docs.updated');

        await type(wrapper, 'One, two');
        expect(state(wrapper)).toBe('Docs.saving');
        expect(put).not.toHaveBeenCalled();

        await pause();
        expect(put).toHaveBeenCalledTimes(1);
        expect(put.mock.calls[0][0]).toMatchObject({ title: 'Plan', contentHtml: '<p>One, two</p>', baseEditedAt: 't0', autosave: true });
        expect(state(wrapper)).toBe('Docs.saved');
        expect(wrapper.emitted('saved')).toBeUndefined();
        wrapper.unmount();
    });

    it('tells the doc tree when the title changed', async () => {
        const wrapper = await openDoc();
        await wrapper.find('.pd__title').setValue('Plan B');
        await pause();

        expect(put.mock.calls[0][0]).toMatchObject({ title: 'Plan B', autosave: true });
        expect(wrapper.emitted('saved')).toHaveLength(1);
        wrapper.unmount();
    });

    it('saves a title typed before the editor has finished drawing', async () => {
        const wrapper = shallowMount(PageDocument, { props: { pageId: 'p1' } });
        await flushPromises();
        await wrapper.find('.pd__title').setValue('Plan B');
        await wrapper.findComponent(PageBlockEditor).vm.$emit('ready');
        expect(state(wrapper)).toBe('Docs.saving');

        await pause();
        expect(put).toHaveBeenCalledTimes(1);
        expect(put.mock.calls[0][0]).toMatchObject({ title: 'Plan B', contentHtml: '<p>One</p>', autosave: true });
        wrapper.unmount();
    });

    it('saves at once when focus leaves the doc, and when the doc is closed, without asking', async () => {
        const confirm = vi.spyOn(window, 'confirm');
        const wrapper = await openDoc();
        await type(wrapper, 'One, two');
        await wrapper.find('.pd').trigger('focusout', { relatedTarget: null });
        await flushPromises();
        expect(put).toHaveBeenCalledTimes(1);
        expect(put.mock.calls[0][0]).not.toHaveProperty('autosave');

        await type(wrapper, 'One, two, three');
        wrapper.unmount();
        await flushPromises();
        expect(put).toHaveBeenCalledTimes(2);
        expect(put.mock.calls[1][0]).toMatchObject({ contentHtml: '<p>One, two, three</p>', baseEditedAt: 't1' });
        expect(confirm).not.toHaveBeenCalled();
    });

    it('keeps Save as save now', async () => {
        const wrapper = await openDoc();
        const save = wrapper.find('.pd__actions .ah-btn--primary');
        expect(save.attributes('disabled')).toBeDefined();

        await type(wrapper, 'One, two');
        await save.trigger('click');
        await flushPromises();

        expect(put).toHaveBeenCalledTimes(1);
        expect(put.mock.calls[0][0]).not.toHaveProperty('autosave');
        expect(state(wrapper)).toBe('Docs.saved');
        wrapper.unmount();
    });

    it('saves what is in the editor before a version is restored over it', async () => {
        const wrapper = await openDoc();
        await type(wrapper, 'One, two');
        await wrapper.findAll('.pd__actions .ah-btn--secondary').find((b) => b.text().includes('Docs.history')).trigger('click');

        expect(await wrapper.findComponent(PageHistory).props('beforeRestore')()).toBe(true);
        expect(put).toHaveBeenCalledTimes(1);
        wrapper.unmount();
    });
});

describe('a save that does not land', () => {
    it('says the text is kept on this device, and brings it back into the editor the next time the doc is opened', async () => {
        put = vi.fn(() => Promise.reject(new Error('Network Error')));
        const wrapper = await openDoc();
        await type(wrapper, 'One, two');
        await pause();

        expect(state(wrapper)).toBe('Docs.autosave_offline');
        expect(readUnsaved('p1')).toMatchObject({ html: '<p>One, two</p>', base: 't0' });
        wrapper.unmount();
        await flushPromises();

        put = vi.fn(() => Promise.resolve({ data: { status: true, data: { _id: 'p1', title: 'Plan', editedAt: 't1' } } }));
        const again = shallowMount(PageDocument, { props: { pageId: 'p1' } });
        await flushPromises();

        expect(again.findComponent(PageBlockEditor).props('seed')).toEqual({ blocks: { blocks: [block('One, two')] } });
        await pause();
        expect(put).toHaveBeenCalledTimes(1);
        expect(put.mock.calls[0][0]).toMatchObject({ contentHtml: '<p>One, two</p>', baseEditedAt: 't0' });
        expect(readUnsaved('p1')).toBe(null);
        again.unmount();
    });
});

describe('a doc someone else saved meanwhile', () => {
    const behind = () => Promise.resolve({ data: { status: false, statusCode: 409, conflict: true } });
    const buttons = (wrapper) => wrapper.findAll('.pd__banner button');

    it('is not overwritten: a banner offers to keep this text as a copy or to reload the saved doc', async () => {
        put = vi.fn(behind);
        const wrapper = await openDoc();
        expect(wrapper.find('.pd__banner').exists()).toBe(false);

        await type(wrapper, 'One, mine');
        await pause();

        expect(wrapper.find('.pd__banner').attributes('role')).toBe('alert');
        expect(buttons(wrapper).map((b) => b.text())).toEqual(['Docs.conflict_keep_copy', 'Docs.conflict_reload']);
        expect(state(wrapper)).toBe('Docs.autosave_not_saved');
        expect(wrapper.find('.pd__actions .ah-btn--primary').attributes('disabled')).toBeDefined();
        expect(readUnsaved('p1')).toMatchObject({ html: '<p>One, mine</p>' });

        await pause(10 * SAVE_DELAY_MS);
        expect(put).toHaveBeenCalledTimes(1);
        wrapper.unmount();
    });

    it('reloads the saved doc and drops this text when asked to', async () => {
        put = vi.fn(behind);
        const wrapper = await openDoc();
        await type(wrapper, 'One, mine');
        await pause();
        server = doc({ editedAt: 't5', content: { html: '<p>One, theirs</p>', blocks: { blocks: [block('One, theirs')] } } });

        await buttons(wrapper)[1].trigger('click');
        await flushPromises();

        expect(calls('get')).toHaveLength(2);
        expect(readUnsaved('p1')).toBe(null);
        expect(wrapper.find('.pd__banner').exists()).toBe(false);
        expect(wrapper.findComponent(PageBlockEditor).props('seed')).toEqual(server.content);
        wrapper.unmount();
    });

    it('keeps this text as a doc of its own beside the saved one', async () => {
        put = vi.fn(behind);
        const wrapper = await openDoc();
        await type(wrapper, 'One, mine');
        await pause();

        await buttons(wrapper)[0].trigger('click');
        await flushPromises();

        expect(calls('post')).toHaveLength(1);
        expect(calls('post')[0][2]).toEqual({ title: 'Docs.conflict_copy_title', contentBlocks: { blocks: [block('One, mine')] }, projectId: 'proj1' });
        expect(readUnsaved('p1')).toBe(null);
        expect(wrapper.find('.pd__banner').exists()).toBe(false);
        expect(wrapper.emitted('saved')).toHaveLength(1);
        wrapper.unmount();
    });

    it('shows the banner on opening when the text kept on this device was written against an older doc', async () => {
        localStorage.setItem(unsavedKeyOf('p1'), JSON.stringify({ title: 'Plan', html: '<p>One, mine</p>', blocks: { blocks: [block('One, mine')] }, base: 'older' }));
        const wrapper = await openDoc();

        expect(wrapper.find('.pd__banner').exists()).toBe(true);
        await pause(10 * SAVE_DELAY_MS);
        expect(put).not.toHaveBeenCalled();
        wrapper.unmount();
    });
});
