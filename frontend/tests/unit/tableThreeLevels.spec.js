/* Three levels of subtasks in the real Table: the real group, row and store, the real loader and
   an unmocked `@/composable`. Only the HTTP layer is a stand-in. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { defineComponent, h, ref } from 'vue';
import en from '@/locales/en';

const { idle } = vi.hoisted(() => ({
    idle: () => ({ get: () => ({ state: 'idle' }), ensure: () => {}, generate: () => {}, pin: () => {}, unpin: () => {} })
}));
vi.mock('@/services', async () => ({ apiRequest: (await import('../fakeTaskServer')).apiRequest }));
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));
vi.mock('@/views/Projects/TableView/useTaskSummaries.js', () => ({ useTaskSummaries: idle }));
vi.mock('@/views/Projects/TableView/useTaskCategories.js', () => ({ useTaskCategories: idle }));

import '@/services';
import Store from '@/store/index';
import TableViewTable from '@/views/Projects/TableView/TableViewTable.vue';
import * as env from '@/config/env';
import { childReads, resetServer, server } from '../fakeTaskServer';
import { PROJECT, SPRINT, TODO_GROUP, fromSocket, readTable, seedStore, threeLevels, under } from '../threeLevelTasks';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];

const stored = (id) => server.tasks.find((task) => task._id === id);
const settle = async () => {
    await flushPromises();
    await flushPromises();
};

let wrapper;

async function openTable({ searched = false } = {}) {
    const Host = defineComponent({
        setup: () => () => h('div', { class: 'tv2' }, [h(TableViewTable, { data: TODO_GROUP, group: 0, sprintId: SPRINT })])
    });
    wrapper = mount(Host, {
        attachTo: document.body,
        global: {
            plugins: [Store],
            mocks: { $t: (...args) => i18n.global.t(...args) },
            provide: {
                selectedProject: ref(PROJECT), $companyId: ref('c1'), $userId: ref('u1'), $dateFormat: ref('DD/MM/YYYY'),
                showArchived: ref(false), searchedTask: ref(searched), tableColumns: ref([{ id: 'status' }])
            },
            stubs: { Skelaton: true, ShellIcon: true, ProvenanceBadge: true, TaskTagCell: true, ListStatusCircle: true, TaskColumnCell: true }
        }
    });
    await settle();
    return wrapper;
}

const rows = () => wrapper.findAll('.tv2__row');
const names = () => rows().map((el) => el.find('.tv2__name').text());
const rowOf = (name) => rows().find((el) => el.find('.tv2__name').text() === name);
const depthOf = (name) => rowOf(name).find('.tv2__name-cell').element.style.getPropertyValue('--tv2-depth');
const disclosure = (name) => rowOf(name).find('button.tv2__disclose');
const open = async (name) => {
    await disclosure(name).trigger('click');
    await settle();
};
const tick = async (name) => {
    await rowOf(name).find('input[type="checkbox"]').trigger('click');
    await settle();
};
const selected = () => [...Store.state.taskSelection.selectedTaskIds].sort();
const repairs = () => server.posts.filter((post) => post.url === env.ONLOAD_UPDATE_TASK_INDEX).map((post) => post.body.taskUpdate.data);

beforeEach(async () => {
    resetServer(threeLevels());
    seedStore(Store);
});
afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
});

describe('each level opens from its own row', () => {
    beforeEach(async () => {
        await readTable(Store);
        await openTable();
    });

    it('starts with the tasks only, and a disclosure on the one that has subtasks', () => {
        expect(names()).toEqual(['Parent', 'Loner']);
        expect(disclosure('Parent').exists()).toBe(true);
        expect(disclosure('Parent').attributes('aria-expanded')).toBe('false');
        expect(disclosure('Loner').exists()).toBe(false);
    });

    it('pages the tasks of the group, leaving the subtasks to their parents', () => {
        const page = server.calls.find((stages) => stages.some((stage) => '$limit' in stage));
        expect(JSON.stringify(page[0].$match)).toContain('"isParentTask":true');
        expect(wrapper.find('.tv2__group-count').text()).toBe('2');
    });

    it('opening a task reads its subtasks by parent and shows them one indent step in', async () => {
        await open('Parent');
        expect(names()).toEqual(['Parent', 'Child one', 'Child two', 'Loner']);
        expect(childReads('t1')).toHaveLength(1);
        expect(disclosure('Parent').attributes('aria-expanded')).toBe('true');
        expect(depthOf('Parent')).toBe('0');
        expect(depthOf('Child one')).toBe('1');
        expect(disclosure('Child one').exists()).toBe(true);
        expect(disclosure('Child two').exists()).toBe(false);
    });

    it('opening a subtask shows the third level two steps in, with no disclosure of its own', async () => {
        await open('Parent');
        await open('Child one');
        expect(names()).toEqual(['Parent', 'Child one', 'Grandchild one', 'Grandchild two', 'Child two', 'Loner']);
        expect(childReads('s1')).toHaveLength(1);
        expect(depthOf('Grandchild one')).toBe('2');
        expect(disclosure('Grandchild one').exists()).toBe(false);
    });

    it('reads each level once: closing and reopening asks for nothing', async () => {
        await open('Parent');
        await open('Child one');
        await open('Parent');
        expect(names()).toEqual(['Parent', 'Loner']);
        await open('Parent');
        expect(names()).toContain('Grandchild one');
        expect(childReads('t1')).toHaveLength(1);
        expect(childReads('s1')).toHaveLength(1);
    });

    it('counts direct children on each row: 0/2 on the task, 1/2 on its subtask', async () => {
        await open('Parent');
        expect(rowOf('Parent').find('.tv2__sub-count').text()).toBe('0/2');
        expect(rowOf('Child one').find('.tv2__sub-count').text()).toBe('1/2');
        expect(rowOf('Child two').find('.tv2__sub-count').exists()).toBe(false);
    });

    it('opens the task a nested row names', async () => {
        await open('Parent');
        await rowOf('Child two').find('.tv2__name').trigger('click');
        expect(wrapper.findComponent(TableViewTable).emitted('open')[0][0]._id).toBe('s2');
    });
});

describe('rows that arrive from elsewhere', () => {
    beforeEach(async () => {
        await readTable(Store);
        await openTable();
    });

    it('a subtask someone adds does not become a row of the group', async () => {
        const added = under(stored('t2'), 's9', 'Late child');
        fromSocket(Store, 'added', added, added);
        await settle();
        expect(names()).toEqual(['Parent', 'Loner']);
    });

    it('a level-three row that arrives before its parent is kept, and shown once the parent is read', async () => {
        await open('Parent');
        const late = under(stored('t2'), 's9', 'Late child', { subTasks: 1 });
        const early = under(late, 'g9', 'Early grandchild');
        server.tasks.push(late, early);
        fromSocket(Store, 'added', early, early);
        fromSocket(Store, 'modified', { ...stored('t2'), subTasks: 1 }, { subTasks: 1 });
        await settle();
        expect(names()).toEqual(['Parent', 'Child one', 'Child two', 'Loner']);
        await open('Loner');
        await open('Late child');
        expect(names()).toEqual(['Parent', 'Child one', 'Child two', 'Loner', 'Late child', 'Early grandchild']);
        expect(depthOf('Early grandchild')).toBe('2');
    });

    it('keeps every open level open when a sub-subtask changes', async () => {
        await open('Parent');
        await open('Child one');
        fromSocket(Store, 'modified', { ...stored('g1'), statusKey: 2, statusType: 'close' }, { statusKey: 2, statusType: 'close' });
        await settle();
        expect(names()).toEqual(['Parent', 'Child one', 'Grandchild one', 'Grandchild two', 'Child two', 'Loner']);
        expect(rowOf('Child one').find('.tv2__sub-count').text()).toBe('2/2');
    });
});

describe('selection follows the List: every row is ticked alone', () => {
    beforeEach(async () => {
        await readTable(Store);
        await openTable();
        await open('Parent');
        await open('Child one');
    });

    it('ticking a task leaves its loaded subtasks alone', async () => {
        await tick('Parent');
        expect(selected()).toEqual(['t1']);
    });

    it('ticking every subtask does not tick the task', async () => {
        await tick('Child one');
        await tick('Child two');
        expect(selected()).toEqual(['s1', 's2']);
    });

    it('a sub-subtask can be ticked', async () => {
        await tick('Grandchild two');
        expect(selected()).toEqual(['g2']);
    });

    it('the group box ticks the tasks of the group, not the rows under them', async () => {
        await wrapper.find('.tv2__group-cell input[type="checkbox"]').setValue(true);
        expect(selected()).toEqual(['t1', 't2']);
    });
});

describe('the index repair on load', () => {
    it('asks for a task without an index and never for the rows under it', async () => {
        delete stored('t2').groupByStatusIndex;
        await readTable(Store);
        const child = under(stored('t1'), 's8', 'No index child');
        delete child.groupByStatusIndex;
        fromSocket(Store, 'added', child, child);
        await openTable();
        expect(repairs()).toEqual(['t2']);
    });
});

describe('a searched Table', () => {
    it('shows the subtasks that matched under their task, opened', async () => {
        const [parent, first, , grandchild] = threeLevels();
        Store.state.projectData.searchedTasks = [{ ...parent, subtaskArray: [{ ...first, subtaskArray: [grandchild] }] }];
        await openTable({ searched: true });
        expect(names()).toEqual(['Parent', 'Child one', 'Grandchild one']);
        expect(childReads('t1')).toHaveLength(0);
    });
});
