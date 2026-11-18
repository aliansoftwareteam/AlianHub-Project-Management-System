import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, shallowMount } from '@vue/test-utils';

const { api, push, socket } = vi.hoisted(() => ({
    api: { apiRequest: vi.fn() },
    push: vi.fn(),
    socket: { handlers: {}, on(name, handler) { this.handlers[name] = handler; }, off(name) { delete this.handlers[name]; } },
}));
const SEATS = [
    { userId: 'u-ann', roleType: 3, status: 2 },
    { userId: 'u-bob', roleType: 3, status: 2 },
    { userId: 'u-gus', roleType: 0, status: 2 },
    { userId: 'u-old', roleType: 3, status: 2, isDelete: true },
];
const NAMES = { 'u-ann': 'Ann', 'u-bob': 'Bob', 'u-gus': 'Gus' };

vi.mock('@/services', () => api);
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { cid: 'c1' }, query: {} }), useRouter: () => ({ push }) }));
vi.mock('vuex', () => ({
    useStore: () => ({
        getters: {
            'projectData/allProjects': { data: [{ _id: 'p1', ProjectName: 'Launch' }] },
            'settings/companyUsers': SEATS,
            'settings/getSocketInstance': socket,
        },
        commit: vi.fn(),
        dispatch: vi.fn(() => Promise.resolve()),
    }),
}));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => (NAMES[id] ? { Employee_Name: NAMES[id] } : {}) }),
    useCustomComposable: () => ({ checkPermission: () => true }),
}));

import PageSharePeople from '@/components/molecules/Pages/PageSharePeople.vue';
import PageDocument from '@/components/molecules/Pages/PageDocument.vue';
import PagesSpace from '@/views/Pages/PagesSpace.vue';
import { renderNotice } from '@/views/Inbox/renderNotice';

let wrapper;
const answer = (people) => ({ data: { status: true, data: { people, limit: 50 } } });
const writes = () => api.apiRequest.mock.calls.filter(([method]) => method !== 'get');

beforeEach(() => {
    api.apiRequest.mockReset();
    socket.handlers = {};
});
afterEach(() => wrapper?.unmount());

describe('the People section of the doc share dialog', () => {
    async function openSection(people) {
        api.apiRequest.mockResolvedValue(answer(people));
        wrapper = mount(PageSharePeople, { props: { pageId: 'doc-1' }, global: { stubs: { ShellIcon: true } } });
        await flushPromises();
    }
    const rows = () => wrapper.findAll('[data-test="doc-share-person"]');

    it('lists the people the doc is shared with, each with a role, and says how many', async () => {
        await openSection([{ userId: 'u-ann', role: 'viewer', active: true }, { userId: 'u-bob', role: 'editor', active: false }]);

        expect(api.apiRequest).toHaveBeenCalledWith('get', expect.stringMatching(/\/doc-1\/shares$/), undefined);
        expect(rows().map((row) => row.text())).toEqual([expect.stringContaining('Ann'), expect.stringContaining('Bob')]);
        expect(rows().map((row) => row.find('[data-test="doc-share-role"]').element.value)).toEqual(['viewer', 'editor']);
        expect(rows()[0].text()).not.toContain('Docs.share_inactive');
        expect(rows()[1].text()).toContain('Docs.share_inactive');
        expect(wrapper.emitted('changed').at(-1)).toEqual([2]);
    });

    it('says so when the doc is shared with nobody', async () => {
        await openSection([]);
        expect(wrapper.find('[data-test="doc-share-none"]').exists()).toBe(true);
    });

    it('names a person picked from the members as a viewer', async () => {
        await openSection([{ userId: 'u-ann', role: 'viewer', active: true }]);
        await wrapper.find('[data-test="doc-share-add"]').trigger('click');

        const choices = wrapper.findAll('[data-test="glp-person"]');
        expect(choices.map((choice) => choice.attributes('data-user'))).toEqual(['u-ann', 'u-bob', 'u-gus']);

        api.apiRequest.mockResolvedValue(answer([{ userId: 'u-ann', role: 'viewer', active: true }, { userId: 'u-bob', role: 'viewer', active: true }]));
        await choices[1].find('input').setValue(true);
        await flushPromises();

        expect(writes()).toEqual([['put', expect.stringMatching(/\/doc-1\/shares\/u-bob$/), { role: 'viewer' }]]);
        expect(rows()).toHaveLength(2);
        expect(wrapper.emitted('changed').at(-1)).toEqual([2]);
    });

    it('changes a role and stops sharing with a person', async () => {
        await openSection([{ userId: 'u-ann', role: 'viewer', active: true }]);

        api.apiRequest.mockResolvedValue(answer([{ userId: 'u-ann', role: 'editor', active: true }]));
        await rows()[0].find('[data-test="doc-share-role"]').setValue('editor');
        await flushPromises();
        api.apiRequest.mockResolvedValue(answer([]));
        await rows()[0].find('[data-test="doc-share-remove"]').trigger('click');
        await flushPromises();

        expect(writes()).toEqual([
            ['put', expect.stringMatching(/\/doc-1\/shares\/u-ann$/), { role: 'editor' }],
            ['delete', expect.stringMatching(/\/doc-1\/shares\/u-ann$/), undefined],
        ]);
        expect(rows()).toHaveLength(0);
        expect(wrapper.emitted('changed').at(-1)).toEqual([0]);
    });

    it('keeps the list as it was when the server refuses', async () => {
        await openSection([{ userId: 'u-ann', role: 'viewer', active: true }]);
        api.apiRequest.mockResolvedValue({ data: { status: false, statusText: 'No.' } });
        await rows()[0].find('[data-test="doc-share-remove"]').trigger('click');
        await flushPromises();
        expect(rows()).toHaveLength(1);
    });
});

describe('the doc header and its share dialog', () => {
    async function openDoc(doc) {
        api.apiRequest.mockResolvedValue({ status: 200, data: { status: true, data: { _id: 'p1', title: 'Plan', content: { html: '<p>Body</p>' }, visibility: 'project', ...doc } } });
        wrapper = shallowMount(PageDocument, { props: { pageId: 'p1' } });
        await flushPromises();
    }
    const line = () => wrapper.find('[data-test="doc-shared-line"]');
    async function openDialog() {
        api.apiRequest.mockResolvedValue({ data: { status: true, data: null } });
        await wrapper.findAll('.pd__actions .ah-btn--secondary').find((button) => button.text().includes('Docs.share')).trigger('click');
        await flushPromises();
    }

    it('tells a manager how many people the doc is shared with, and follows the dialog', async () => {
        await openDoc({ canManageShares: true, sharedCount: 3 });
        expect(line().text()).toContain('Docs.shared_with_n');

        await openDialog();
        const people = wrapper.findComponent(PageSharePeople);
        expect(people.exists()).toBe(true);
        expect(people.props('pageId')).toBe('p1');

        people.vm.$emit('changed', 1);
        await flushPromises();
        expect(line().text()).toContain('Docs.shared_with_one');
        people.vm.$emit('changed', 0);
        await flushPromises();
        expect(line().exists()).toBe(false);
    });

    it('tells a named person the doc is shared with them, and offers them no People section', async () => {
        await openDoc({ sharedWithMe: 'viewer', canManageShares: false });
        expect(line().text()).toContain('Docs.shared_with_you');

        await openDialog();
        expect(wrapper.findComponent(PageSharePeople).exists()).toBe(false);
    });

    it('says nothing on a doc that is shared with nobody by name', async () => {
        await openDoc({ canManageShares: true, sharedCount: 0 });
        expect(line().exists()).toBe(false);
        await openDoc({ canManageShares: false, sharedCount: 4 });
        expect(line().exists()).toBe(false);
    });
});

describe('the notice that a doc was shared', () => {
    it('names the doc, with its title escaped', () => {
        const t = (key, values) => `${key}|${values?.doc ?? ''}`;
        const html = renderNotice({ changeType: 'doc_shared', message: 'ignored', changeData: { pageId: 'p1', pageTitle: 'Plan <b>' } }, { t, changeText: (text) => text });
        expect(html).toBe('Inbox.doc_shared|Plan &lt;b&gt;');
    });
});

describe('the Shared with me filter of the Docs list', () => {
    const PAGES = [
        { _id: 'd1', title: 'Roadmap', sharedWithMe: 'viewer', updatedAt: '2026-01-02T00:00:00Z' },
        { _id: 'd2', title: 'Handbook', sharedWithMe: '', updatedAt: '2026-01-03T00:00:00Z' },
        { _id: 'd3', title: 'Budget', sharedWithMe: 'editor', updatedAt: '2026-01-04T00:00:00Z' },
    ];
    async function openHub(pages) {
        api.apiRequest.mockResolvedValue({ data: { status: true, data: pages } });
        wrapper = mount(PagesSpace, { global: { stubs: { ShellIcon: true } } });
        await flushPromises();
    }
    const shown = () => wrapper.find('[data-test="docs-shared-with-me"]').text();

    it('shows the docs shared with the person by name, and counts them', async () => {
        await openHub(PAGES);
        const filter = wrapper.find('[data-test="docs-nav-shared"]');
        expect(filter.text()).toContain('Docs.shared_with_me');
        expect(filter.text()).toContain('2');

        await filter.trigger('click');
        expect(shown()).toContain('Roadmap');
        expect(shown()).toContain('Budget');
        expect(shown()).not.toContain('Handbook');
        expect(wrapper.find('select.hub__view-select').element.value).toBe('shared');
    });

    it('says so when nothing is shared with them', async () => {
        await openHub([PAGES[1]]);
        await wrapper.find('[data-test="docs-nav-shared"]').trigger('click');
        expect(wrapper.find('[data-test="docs-empty-shared"]').exists()).toBe(true);
    });

    it('reads the list again when the person is told their shared docs changed', async () => {
        await openHub([PAGES[1]]);
        api.apiRequest.mockResolvedValue({ data: { status: true, data: PAGES } });
        socket.handlers.docSharesChanged();
        await flushPromises();
        expect(wrapper.find('[data-test="docs-nav-shared"]').text()).toContain('2');

        wrapper.unmount();
        expect(socket.handlers.docSharesChanged).toBeUndefined();
        wrapper = null;
    });
});
