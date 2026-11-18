/* Task 046 M3, slice G4: the lists a target can be counted from come from the app's own project
   store, which holds only the projects and lists this person can open. Here that store is the real
   module, filled through its real mutation, so the picker is checked against the shape the app
   keeps and not against a stand-in that always has the list. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import en from '@/locales/en';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));
/* The module's mutations load the app's composables, which load the whole app store and so the module
   again. Nothing here asks for a permission: the stand-in only ends that circle, and grants nothing. */
vi.mock('@/composable', () => ({ useCustomComposable: () => ({ checkPermission: () => null }) }));

import projectData from '@/store/ProjectData';
import GoalSourcePicker from '@/views/Goals/GoalSourcePicker.vue';

const added = (data) => ({ op: 'added', data, snap: null, privateSnap: false });
const WEBSITE = added({
    _id: 'p-website', ProjectName: 'Website', statusType: 'active',
    sprintsObj: { 'l-sprint': { id: 'l-sprint', name: 'Sprint 1' }, 'l-trashed': { id: 'l-trashed', name: 'Thrown away', deletedStatusKey: 1 } },
    sprintsfolders: { 'f-q4': { name: 'Q4', sprintsObj: { 'l-backlog': { id: 'l-backlog', name: 'Backlog' } } } }
});
const CLOSED = added({ _id: 'p-closed', ProjectName: 'Last year', statusType: 'close', sprintsObj: { 'l-old': { id: 'l-old', name: 'Old list' } }, sprintsfolders: {} });
const HIRING = added({ _id: 'p-hiring', ProjectName: 'Hiring plan', statusType: 'active', sprintsObj: { 'l-team': { id: 'l-team', name: 'Interviews' } }, sprintsfolders: {} });

let wrapper;
let store;
const show = (sources) => {
    wrapper = mount(GoalSourcePicker, { props: { modelValue: sources }, global: { plugins: [store] }, attachTo: document.body });
};
const offered = () => wrapper.findAll('[data-test="gsp-list"]').map((option) => option.text());
const chips = () => wrapper.findAll('[data-test="gsc-chip"]').map((chip) => chip.find('.gsc__name').text());

const i18n = config.global.plugins[0];

beforeEach(() => {
    i18n.global.setLocaleMessage('en', en);
    config.global.mocks.$t = i18n.global.t;
    apiRequest.mockReset();
    store = createStore({ modules: { projectData: { ...projectData, state: () => JSON.parse(JSON.stringify(projectData.state)) } } });
});

afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
});

describe('the lists a person can link, from the project store the app keeps', () => {
    it('offers nothing before the person has any project', () => {
        show({ sprintIds: [], taskIds: [] });
        expect(offered()).toEqual([]);
    });

    it('offers the lists of open projects, in and out of folders, and not one in the trash or in a closed project', () => {
        store.commit('projectData/mutateProjects', [WEBSITE, CLOSED]);
        show({ sprintIds: [], taskIds: [] });
        expect(offered()).toEqual(['Sprint 1Website', 'BacklogWebsite · Q4']);
    });

    it('names a linked list only when its project is in the store', async () => {
        store.commit('projectData/mutateProjects', [WEBSITE, CLOSED]);
        show({ sprintIds: ['l-sprint', 'l-old', 'l-team', 'l-trashed'], taskIds: [] });
        expect(chips()).toEqual(['Sprint 1', 'Old list', 'A list you cannot open', 'A list you cannot open']);
        expect(wrapper.text()).not.toContain('Interviews');

        store.commit('projectData/mutateProjects', [HIRING]);
        await flushPromises();
        expect(chips()).toEqual(['Sprint 1', 'Old list', 'Interviews', 'A list you cannot open']);
    });
});
