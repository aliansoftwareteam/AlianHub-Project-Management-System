import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, shallowMount } from '@vue/test-utils';

const { api, push, role } = vi.hoisted(() => ({ api: { apiRequest: vi.fn() }, push: vi.fn(), role: { type: 3 } }));
vi.mock('@/services', () => api);
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { cid: 'c1' }, query: {} }), useRouter: () => ({ push }) }));
vi.mock('vuex', () => ({
    useStore: () => ({
        getters: {
            'projectData/allProjects': { data: [{ _id: 'p1', ProjectName: 'Launch' }] },
            get 'settings/companyUserDetail'() { return { roleType: role.type }; },
        },
        commit: vi.fn(),
        dispatch: vi.fn(() => Promise.resolve()),
    }),
}));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: () => ({}) }),
    useCustomComposable: () => ({ checkPermission: () => true }),
}));
vi.mock('@/composable/aiAvailability', () => ({ canUseAi: () => true }));

import PageDocument from '@/components/molecules/Pages/PageDocument.vue';
import PageBlockEditor from '@/components/molecules/Pages/PageBlockEditor.vue';
import PageComposeRail from '@/components/molecules/Pages/PageComposeRail.vue';
import PageComments from '@/components/molecules/Pages/PageComments.vue';
import PageHistory from '@/components/molecules/Pages/PageHistory.vue';
import PagesPanel from '@/components/molecules/Pages/PagesPanel.vue';
import PagesSpace from '@/views/Pages/PagesSpace.vue';

let wrapper;
const writes = () => api.apiRequest.mock.calls.filter(([method]) => method !== 'get');

beforeEach(() => {
    vi.useFakeTimers();
    api.apiRequest.mockReset();
    role.type = 3;
});
afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
});

describe('a doc the person may only read', () => {
    async function openDoc(doc) {
        api.apiRequest.mockResolvedValue({ status: 200, data: { status: true, data: { _id: 'p1', title: 'Plan', content: { html: '<p>Body</p>' }, visibility: 'project', ProjectID: 'p1', isWiki: true, reviewState: 'due', ...doc } } });
        wrapper = shallowMount(PageDocument, { props: { pageId: 'p1' } });
        await flushPromises();
    }
    const buttonTexts = () => wrapper.findAll('.pd__actions button').map((button) => button.text());

    it('opens read-only: no title, property, Save, delete or AI control, and a read-only editor', async () => {
        await openDoc({ canEdit: false, canChangeProperties: false });

        expect(wrapper.find('[data-test="doc-view-only"]').exists()).toBe(true);
        expect(wrapper.find('.pd__title').attributes('readonly')).toBeDefined();
        expect(wrapper.findComponent(PageBlockEditor).props('readOnly')).toBe(true);
        expect(wrapper.findComponent(PageComposeRail).exists()).toBe(false);
        expect(buttonTexts().join(' ')).not.toMatch(/Docs\.save|Docs\.link_tasks|Docs\.edit|Docs\.preview/);
        expect(wrapper.find('.pd__icon--danger').exists()).toBe(false);
        expect(wrapper.find('.pd__select').exists()).toBe(false);
        expect(wrapper.find('.pd__props .ah-check').exists()).toBe(false);
        expect(wrapper.find('.pd__date').exists()).toBe(false);
        expect(wrapper.find('.pd__prop--btn').attributes('disabled')).toBeDefined();
        expect(wrapper.find('.pd__save-state').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Docs.mark_reviewed');
    });

    it('starts no autosave, whatever reaches the title or the body', async () => {
        await openDoc({ canEdit: false, canChangeProperties: false });
        const editor = wrapper.findComponent(PageBlockEditor);
        editor.vm.$emit('ready');
        editor.vm.$emit('change', { blocks: { blocks: [] }, html: '<p>Other</p>' });
        await wrapper.find('.pd__title').setValue('Other');
        await wrapper.find('.pd').trigger('focusout');
        vi.advanceTimersByTime(60000);
        await flushPromises();

        expect(writes()).toEqual([]);
    });

    it('still offers the comments, and a history with nothing to restore or save', async () => {
        await openDoc({ canEdit: false, canChangeProperties: false });
        expect(wrapper.findComponent(PageComments).exists()).toBe(true);
        expect(buttonTexts().join(' ')).toMatch(/Docs\.comments/);

        await wrapper.findAll('.pd__actions button').find((button) => button.text().includes('Docs.history')).trigger('click');
        expect(wrapper.findComponent(PageHistory).props('readOnly')).toBe(true);
    });

    it('opens as before for a person who may change it', async () => {
        await openDoc({ canEdit: true, canChangeProperties: true });

        expect(wrapper.find('[data-test="doc-view-only"]').exists()).toBe(false);
        expect(wrapper.find('.pd__title').attributes('readonly')).toBeUndefined();
        expect(wrapper.findComponent(PageBlockEditor).props('readOnly')).toBe(false);
        expect(wrapper.findComponent(PageComposeRail).exists()).toBe(true);
        expect(buttonTexts().join(' ')).toMatch(/Docs\.save/);
        expect(wrapper.find('.pd__icon--danger').exists()).toBe(true);
        expect(wrapper.find('.pd__select').exists()).toBe(true);

        wrapper.findComponent(PageBlockEditor).vm.$emit('ready');
        await wrapper.find('.pd__title').setValue('Other');
        vi.advanceTimersByTime(60000);
        await flushPromises();
        expect(writes().map(([method, , body]) => [method, body.title])).toEqual([['put', 'Other']]);
    });

    it('lets a person the doc is shared with to edit write in it, and keeps its properties from them', async () => {
        await openDoc({ canEdit: true, canChangeProperties: false, sharedWithMe: 'editor' });

        expect(wrapper.find('[data-test="doc-view-only"]').exists()).toBe(false);
        expect(wrapper.findComponent(PageBlockEditor).props('readOnly')).toBe(false);
        expect(buttonTexts().join(' ')).toMatch(/Docs\.save/);
        expect(buttonTexts().join(' ')).not.toMatch(/Docs\.link_tasks/);
        expect(wrapper.find('.pd__icon--danger').exists()).toBe(false);
        expect(wrapper.find('.pd__select').exists()).toBe(false);
        expect(wrapper.find('.pd__prop--btn').attributes('disabled')).toBeDefined();
    });

    it('says who sees a private doc in words that fit the reader', async () => {
        await openDoc({ canEdit: false, canChangeProperties: false, visibility: 'private', createdBy: 'someone-else' });
        api.apiRequest.mockResolvedValue({ data: { status: true, data: null } });
        await wrapper.findAll('.pd__actions button').find((button) => button.text().includes('Docs.share')).trigger('click');
        await flushPromises();

        expect(wrapper.find('.pd__share').text()).toContain('Projects.doc_share_scope_off_hint_reader');
        expect(wrapper.findAll('.pd__share .pd__switch').every((toggle) => toggle.attributes('disabled') !== undefined)).toBe(true);
    });
});

describe('the history of a doc the person may only read', () => {
    it('lists the versions without offering to save, name or restore one', async () => {
        api.apiRequest.mockResolvedValue({ data: { status: true, data: [] } });
        wrapper = shallowMount(PageHistory, { props: { pageId: 'p1', readOnly: true } });
        await flushPromises();
        expect(wrapper.find('.ph__save').exists()).toBe(false);
        expect(wrapper.find('.ph__restore').exists()).toBe(false);

        wrapper.unmount();
        wrapper = shallowMount(PageHistory, { props: { pageId: 'p1' } });
        await flushPromises();
        expect(wrapper.find('.ph__save').exists()).toBe(true);
    });
});

describe('what the Docs screens offer a guest', () => {
    const PAGES = [{ _id: 'd1', title: 'Roadmap', isWiki: true, reviewState: 'due', createdByAgent: true, agentStatus: 'draft', updatedAt: '2026-01-02T00:00:00Z' }];
    async function openHub() {
        api.apiRequest.mockResolvedValue({ data: { status: true, data: PAGES } });
        wrapper = mount(PagesSpace, { global: { stubs: { ShellIcon: true } } });
        await flushPromises();
    }
    const offered = () => wrapper.text();
    const views = () => wrapper.findAll('select.hub__view-select option').map((option) => option.attributes('value'));

    it('lists the docs and offers nothing that starts, signs off, reviews or restores one', async () => {
        role.type = 0;
        await openHub();

        expect(offered()).toContain('Roadmap');
        expect(offered()).not.toMatch(/Docs\.new_doc|Docs\.new_wiki_page|Docs\.approve|Docs\.mark_reviewed/);
        expect(wrapper.find('.hub__new').exists()).toBe(false);
        expect(views()).not.toContain('templates');

        await wrapper.find('select.hub__view-select').setValue('trash');
        await flushPromises();
        expect(offered()).toContain('Roadmap');
        expect(offered()).not.toContain('Docs.restore');
        await wrapper.find('select.hub__view-select').setValue('project:p1');
        expect(offered()).not.toContain('Docs.new_doc');
    });

    it('offers a member all of it', async () => {
        await openHub();

        expect(offered()).toMatch(/Docs\.new_doc/);
        expect(offered()).toMatch(/Docs\.approve/);
        expect(offered()).toMatch(/Docs\.mark_reviewed/);
        expect(wrapper.find('.hub__new').exists()).toBe(true);
        expect(views()).toContain('templates');
        await wrapper.find('select.hub__view-select').setValue('trash');
        await flushPromises();
        expect(offered()).toContain('Docs.restore');
    });

    it('offers no new page in a project\'s docs panel', async () => {
        role.type = 0;
        api.apiRequest.mockResolvedValue({ data: { status: true, data: [{ _id: 'd1', title: 'Roadmap' }] } });
        wrapper = shallowMount(PagesPanel, { props: { projectData: { _id: 'p1' }, embedded: true } });
        await flushPromises();
        expect(wrapper.find('.pg__row-add').exists()).toBe(false);
        expect(wrapper.findAll('button').some((button) => button.attributes('title') === 'Projects.add_page' || button.text().includes('Projects.add_page'))).toBe(false);

        wrapper.unmount();
        role.type = 3;
        wrapper = shallowMount(PagesPanel, { props: { projectData: { _id: 'p1' }, embedded: true } });
        await flushPromises();
        expect(wrapper.find('.pg__row-add').exists()).toBe(true);
    });
});
