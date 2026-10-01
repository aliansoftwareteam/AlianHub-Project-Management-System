/* Everything and search show the lists a task is in: the list it lives in, then the lists it was
   added to that this person can open. The server names only those; an entry it left unnamed is a
   list the person cannot open, and it is neither shown nor counted. */
import { describe, expect, it, vi } from 'vitest';
import { config, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

vi.mock('@/services', () => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn(), apiRequestWithoutSecure: vi.fn() }));

// The store and the composable import each other; the app loads the store first, and so must this.
import '@/store';
import { CHIP_CAP, listChips, openLists } from '@/views/Projects/composables/taskListChips';
import TaskListChips from '@/views/Projects/components/TaskListChips.vue';
import EverythingRow from '@/views/Everything/EverythingRow.vue';
import EverythingCard from '@/views/Everything/EverythingCard.vue';
import EverythingTableRow from '@/views/Everything/EverythingTableRow.vue';
import { taskPlace } from '@/components/molecules/AdvanceSearch/paletteRows';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const HOME_PROJECT = '6f0000000000000000000a01';
const OTHER_PROJECT = '6f0000000000000000000a02';
const named = (sprintId, name, projectId = HOME_PROJECT, projectName = 'Website') => ({ projectId, sprintId, addedBy: 'u1', addedAt: null, name, projectName });
const unnamed = (sprintId) => ({ projectId: OTHER_PROJECT, sprintId, addedBy: 'u1', addedAt: null });
const task = (extraLists, over = {}) => ({
    _id: 't1', TaskName: 'Write the brief', TaskKey: 'WEB-1', ProjectID: HOME_PROJECT, sprintId: 'home', sprintArray: { id: 'home', name: 'Sprint board' },
    status: { key: 1, text: 'To Do', type: 'default_active' }, statusKey: 1, statusType: 'default_active', AssigneeUserId: [], isParentTask: true, extraLists, ...over
});
const card = { _id: HOME_PROJECT, ProjectName: 'Website', taskStatusData: [], taskTypeCounts: [], apps: [], edit: { status: false, priority: false } };

const store = () => createStore({
    getters: {
        'settings/companyPriority': () => [],
        'settings/selectedCompany': () => ({ planFeature: {} }),
        'settings/companyMembers': () => [],
        'settings/teams': () => [],
        'users/users': () => []
    }
});
const mounted = (component, props) => mount(component, { props, global: { plugins: [store()], stubs: { Sidebar: true } } });

describe('the lists a task is shown with', () => {
    it('are the ones the server named, in the order it gave them', () => {
        const lists = [named('a', 'Launch'), unnamed('b'), named('c', 'Design queue')];

        expect(openLists(task(lists)).map((entry) => entry.name)).toEqual(['Launch', 'Design queue']);
        expect(openLists(task(undefined))).toEqual([]);
        expect(openLists(null)).toEqual([]);
    });

    it('start with the list it lives in, then a chip for each list it was added to', () => {
        const shown = listChips(task([named('a', 'Launch'), named('c', 'Ops queue', OTHER_PROJECT, 'Operations')]), t);

        expect(shown.home).toBe('Sprint board');
        expect(shown.chips).toEqual([
            { id: 'a', name: 'Launch', title: 'Also in Launch' },
            { id: 'c', name: 'Ops queue', title: 'Also in Ops queue, in Operations' }
        ]);
        expect(shown.more).toBeNull();
    });

    it('stop at two chips, then count the rest and name every list in the title', () => {
        const shown = listChips(task([named('a', 'Launch'), named('b', 'Design queue'), named('c', 'Ops queue', OTHER_PROJECT, 'Operations'), unnamed('d'), named('e', 'Retro')]), t);

        expect(CHIP_CAP).toBe(2);
        expect(shown.chips.map((chip) => chip.name)).toEqual(['Launch', 'Design queue']);
        expect(shown.more).toEqual({ text: '+2', title: 'Also in Launch, Design queue, Ops queue, in Operations, Retro' });
    });

    it('are none for a task that is only in the list it lives in', () => {
        expect(listChips(task([]), t)).toEqual({ home: 'Sprint board', chips: [], more: null });
        expect(listChips(task([unnamed('d')]), t)).toEqual({ home: 'Sprint board', chips: [], more: null });
    });
});

describe('the chips', () => {
    const lists = [named('a', 'Launch'), named('b', 'Design queue'), named('c', 'Retro')];

    it('follow the home list, two of them and then +N', () => {
        const wrapper = mounted(TaskListChips, { task: task(lists) });

        expect(wrapper.find('[data-home-list]').text()).toBe('Sprint board');
        expect(wrapper.findAll('[data-list-chip]').map((chip) => chip.text())).toEqual(['Launch', 'Design queue']);
        expect(wrapper.find('[data-more-lists]').text()).toBe('+1');
        expect(wrapper.find('[data-more-lists]').attributes('title')).toBe('Also in Launch, Design queue, Retro');
        expect(wrapper.find('[data-more-lists]').attributes('aria-label')).toBe('Also in Launch, Design queue, Retro');
    });

    it('are left out for a task in no other list, and the home list still shows', () => {
        const wrapper = mounted(TaskListChips, { task: task([]) });

        expect(wrapper.find('[data-home-list]').text()).toBe('Sprint board');
        expect(wrapper.find('[data-list-chip]').exists()).toBe(false);
        expect(mounted(TaskListChips, { task: task([], { sprintArray: {} }) }).find('.ah-list-chips').exists()).toBe(false);
    });

    it.each([
        ['a list row', EverythingRow],
        ['a board card', EverythingCard],
        ['a table row', EverythingTableRow]
    ])('show on %s of the Everything page', (_, component) => {
        const wrapper = mounted(component, { task: task(lists), project: card });

        expect(wrapper.findAll('[data-list-chip]').map((chip) => chip.text())).toEqual(['Launch', 'Design queue']);
        expect(wrapper.find('[data-more-lists]').text()).toBe('+1');
    });
});

describe('the search result line', () => {
    const found = (otherLists) => ({ sprintName: 'Sprint 4', folderName: 'Q3', otherLists });

    it('names where the task lives and how many other lists it is in', () => {
        expect(taskPlace(found(2), 'Budget ops', t)).toBe('Budget ops / Q3 / Sprint 4 · +2 lists');
        expect(taskPlace(found(1), 'Budget ops', t)).toBe('Budget ops / Q3 / Sprint 4 · +1 list');
    });

    it('is the home path alone for a task in no other list, or one read before the count was sent', () => {
        expect(taskPlace(found(0), 'Budget ops', t)).toBe('Budget ops / Q3 / Sprint 4');
        expect(taskPlace(found(undefined), 'Budget ops', t)).toBe('Budget ops / Q3 / Sprint 4');
        expect(taskPlace({ otherLists: 2 }, '', t)).toBe('+2 lists');
    });
});
