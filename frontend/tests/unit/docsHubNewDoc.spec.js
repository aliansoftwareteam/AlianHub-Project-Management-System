import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { api, push } = vi.hoisted(() => ({ api: { apiRequest: vi.fn() }, push: vi.fn() }));
vi.mock('@/services', () => api);
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { cid: 'c1' } }), useRouter: () => ({ push }) }));
vi.mock('vuex', () => ({
    useStore: () => ({
        getters: { 'projectData/allProjects': { data: [{ _id: 'p1', ProjectName: 'QA Sweep' }, { _id: 'p2', ProjectName: 'Launch' }] } },
        dispatch: vi.fn(() => Promise.resolve()),
    }),
}));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({ ghostUser: true }) }) }));

import PagesSpace from '@/views/Pages/PagesSpace.vue';

let wrapper;
const created = () => api.apiRequest.mock.calls.filter(([method]) => method === 'post').map(([, , body]) => body);
const newDocButtons = () => wrapper.findAll('button').filter((button) => button.text().includes('Docs.new_doc'));

async function openHub(view) {
    wrapper = mount(PagesSpace, { global: { stubs: { ShellIcon: true } } });
    await flushPromises();
    if (view) {
        await wrapper.find('select.hub__view-select').setValue(view);
        await flushPromises();
    }
}

async function clickEach(buttons) {
    for (const button of buttons) {
        await button.trigger('click');
        await flushPromises();
    }
}

beforeEach(() => {
    api.apiRequest.mockImplementation(async (method) => (method === 'post'
        ? { data: { status: true, data: { _id: 'new-doc' } } }
        : { data: { status: true, data: [] } }));
});
afterEach(() => wrapper?.unmount());

describe('New doc in the Docs hub', () => {
    it('lands in the selected project from every entry on the screen', async () => {
        await openHub('project:p1');
        const buttons = newDocButtons();
        expect(buttons).toHaveLength(3);

        await clickEach(buttons);

        expect(created().map((body) => body.projectId)).toEqual(['p1', 'p1', 'p1']);
    });

    it('puts a new wiki page in the selected project too', async () => {
        await openHub('project:p2');
        await wrapper.find('.hub__wiki-btn').trigger('click');
        await flushPromises();
        expect(created()).toEqual([expect.objectContaining({ projectId: 'p2', isWiki: true })]);
    });

    it.each([
        ['no project is selected', ''],
        ['Workspace is selected', 'project:'],
    ])('makes a workspace doc when %s', async (_, view) => {
        await openHub(view);
        const buttons = newDocButtons();
        expect(buttons.length).toBeGreaterThanOrEqual(2);

        await clickEach(buttons);

        expect(created()).toHaveLength(buttons.length);
        created().forEach((body) => expect(body).not.toHaveProperty('projectId'));
    });
});
