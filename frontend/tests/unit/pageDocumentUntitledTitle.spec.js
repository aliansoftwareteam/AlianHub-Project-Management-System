/* A new doc is stored under the fallback title "Untitled". The editor shows that as a placeholder, so typing a
   title gives just the typed text, while every list, crumb and tab still reads "Untitled". */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { ref } from 'vue';
import en from '@/locales/en';

const { api, route } = vi.hoisted(() => ({ api: { apiRequest: vi.fn() }, route: { params: { cid: 'c1', pageId: 'p1' } } }));
vi.mock('@/services', () => api);
vi.mock('vuex', () => ({ useStore: () => ({ getters: { 'projectData/allProjects': { data: [] } }, commit: vi.fn(), dispatch: vi.fn(() => Promise.resolve()) }) }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }), useCustomComposable: () => ({ checkPermission: () => true }) }));
vi.mock('@/composable/aiAvailability', () => ({ canUseAi: () => false }));

import PageDocument from '@/components/molecules/Pages/PageDocument.vue';
import PageEditorView from '@/views/Pages/PageEditorView.vue';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const global = { plugins: [i18n], mocks: { $t: (...args) => i18n.global.t(...args) }, provide: { $userId: ref('user-1') } };

let wrapper;
let server;
const puts = () => api.apiRequest.mock.calls.filter(([method]) => method === 'put');

async function openDoc(title) {
    server = { _id: 'p1', title, content: { html: '<p>Body</p>' }, visibility: 'project', createdBy: 'user-1' };
    api.apiRequest.mockImplementation((method, url, body) => Promise.resolve({
        status: 200,
        data: { status: true, data: method === 'put' ? { ...server, title: body.title } : server },
    }));
    wrapper = shallowMount(PageDocument, { props: { pageId: 'p1' }, global });
    await flushPromises();
    return wrapper;
}

const titleField = () => wrapper.get('textarea.pd__title');
const save = async () => {
    await wrapper.get('.ah-btn--primary').trigger('click');
    await flushPromises();
};

beforeEach(() => api.apiRequest.mockReset());
afterEach(() => wrapper?.unmount());

describe('the title of a new doc', () => {
    it('is a placeholder, not text the writer has to delete', async () => {
        await openDoc('Untitled');
        expect(titleField().element.value).toBe('');
        expect(titleField().attributes('placeholder')).toBe('Untitled');
    });

    it('becomes just the typed text', async () => {
        await openDoc('Untitled');
        await titleField().setValue('Roadmap');
        expect(titleField().element.value).toBe('Roadmap');
        await save();
        expect(puts().at(-1)[2]).toEqual(expect.objectContaining({ title: 'Roadmap' }));
    });

    it('is not saved again when nothing was typed', async () => {
        await openDoc('Untitled');
        await titleField().setValue('');
        await save();
        expect(puts().every(([, , body]) => body.title === 'Untitled')).toBe(true);
    });

    it('falls back to Untitled when the writer clears a title, as the server refuses an empty one', async () => {
        await openDoc('Roadmap');
        expect(titleField().element.value).toBe('Roadmap');
        await titleField().setValue('');
        await save();
        expect(puts().at(-1)[2]).toEqual(expect.objectContaining({ title: 'Untitled' }));
        expect(titleField().element.value).toBe('');
    });

    it('keeps a title the writer chose', async () => {
        await openDoc('Untitled plan');
        expect(titleField().element.value).toBe('Untitled plan');
    });
});

describe('an untitled doc elsewhere', () => {
    it('reads Untitled in the breadcrumb of the page, stored as the fallback or still empty', async () => {
        for (const title of ['Untitled', '']) {
            const view = shallowMount(PageEditorView, { global, props: {} });
            view.findComponent(PageDocument).vm.$emit('loaded', { _id: 'p1', title });
            await flushPromises();
            expect(view.get('.pev__crumb-title').text()).toBe('Untitled');
            view.unmount();
        }
    });
});
