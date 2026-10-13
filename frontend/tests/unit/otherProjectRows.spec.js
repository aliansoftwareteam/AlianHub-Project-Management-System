/* A list also shows the tasks added to it from other projects. The page loaded one project, so
   these rows come from the Everything read with each row's own project card, are drawn with that
   card's statuses, and are read-only here: the task panel is where the other project is loaded. */
import { readFileSync } from 'fs';
import path from 'path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, toRef } from 'vue';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { sent, opened } = vi.hoisted(() => ({ sent: { calls: [], answer: null }, opened: [] }));

vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url, body) => {
        sent.calls.push({ method, url, body });
        return sent.answer ? sent.answer(body) : Promise.resolve({ data: { status: true, data: { rows: [], projects: {}, nextCursor: null } } });
    }),
    apiRequestWithoutCompnay: vi.fn(),
    apiRequestWithoutSecure: vi.fn()
}));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: (payload) => opened.push(payload) }));

// The store and the composable import each other; the app loads the store first, and so must this.
import '@/store';
import * as env from '@/config/env';
import { mutateUpdateFirebaseTasks } from '@/store/ProjectData/mutations';
import { statusChipStyle } from '@/utils/statusChipColors';
import {
    MAX_PROJECTS, columnFor, keepOtherRows, otherProjectIds, otherRowsRequest, placeOnBoard, readOnlyCard, useOtherProjectRows
} from '@/views/Projects/composables/otherProjectRows';
import OtherProjectRows from '@/views/Projects/components/OtherProjectRows.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const HERE_PROJECT = '6f0000000000000000000a01';
const THERE_PROJECT = '6f0000000000000000000a02';
const THIRD_PROJECT = '6f0000000000000000000a03';
const HERE = '6f0000000000000000000b01';
const THERE = '6f0000000000000000000b02';

const IN_REVIEW = { key: 7, name: 'In review', type: 'active', bgColor: '#7c3aed35', textColor: '#7c3aed' };
const cardThere = {
    _id: THERE_PROJECT, ProjectName: 'Operations', ProjectCode: 'OPS', projectIcon: { type: 'color', data: '#0F766E' },
    taskStatusData: [{ key: 1, name: 'To Do', type: 'default_active', bgColor: '#6b728035', textColor: '#6b7280' }, IN_REVIEW],
    taskTypeCounts: [{ key: 1, name: 'Task', value: 'task' }], apps: [{ key: 'Priority' }], statusType: 'active', isPersonal: false,
    edit: { status: true, priority: true }
};
const rowThere = (id, over = {}) => ({
    _id: id, TaskName: `Task ${id}`, TaskKey: 'OPS-4', ProjectID: THERE_PROJECT, sprintId: THERE, sprintArray: { id: THERE, name: 'Ops queue' },
    status: { key: 7, text: 'In review', type: 'active' }, statusKey: 7, statusType: 'active', Task_Priority: 'HIGH', AssigneeUserId: [],
    TaskType: 'task', TaskTypeKey: 1, tagsArray: [], subTasks: 0, isParentTask: true,
    extraLists: [{ projectId: HERE_PROJECT, sprintId: HERE, name: 'Launch', projectName: 'Website' }], ...over
});
const answer = (rows, projects = { [THERE_PROJECT]: cardThere }, nextCursor = null) => Promise.resolve({ data: { status: true, data: { rows, projects, nextCursor } } });

const storeWith = (projects = [{ _id: HERE_PROJECT }, { _id: THERE_PROJECT }]) => createStore({
    state: { changes: 0 },
    getters: {
        'projectData/onlyActiveProjects': () => ({ data: projects }),
        'projectData/otherProjectChanges': (state) => state.changes,
        'settings/companyPriority': () => [{ value: 'HIGH', name: 'High' }],
        'settings/selectedCompany': () => ({ planFeature: { projectProjectApp: true } }),
        'settings/companyMembers': () => [],
        'settings/teams': () => [],
        'users/users': () => []
    },
    mutations: { changed(state) { state.changes += 1; } }
});

const Host = defineComponent({
    props: { project: { type: Object, default: null }, listId: { type: String, default: '' } },
    setup(props) { return { other: useOtherProjectRows(toRef(props, 'project'), toRef(props, 'listId')) }; },
    render: () => null
});
const host = (store = storeWith(), props = { project: { _id: HERE_PROJECT }, listId: HERE }) => mount(Host, { props, global: { plugins: [store] } });

const section = (props = {}, store = storeWith()) => mount(OtherProjectRows, {
    props: { rows: [rowThere('t1')], projects: { [THERE_PROJECT]: cardThere }, list: { sprintId: HERE, projectId: HERE_PROJECT }, heading: true, ...props },
    global: {
        plugins: [store],
        provide: { $companyId: { value: 'c1' }, $defaultUserAvatar: '', $defaultGhostCustomUserImg: '' },
        stubs: { Sidebar: true, PriorityComp: { render() { return this.$slots.trigger?.({ open: () => {} }); } } }
    }
});

beforeEach(() => {
    sent.calls.length = 0;
    sent.answer = null;
    opened.length = 0;
});
afterEach(() => { vi.useRealTimers(); });

describe('what the list asks for', () => {
    it('names the projects the person has, other than the one on screen', () => {
        const projects = [{ _id: HERE_PROJECT }, { _id: THERE_PROJECT }, { _id: THIRD_PROJECT, deletedStatusKey: 1 }, {}];

        expect(otherProjectIds(projects, HERE_PROJECT)).toEqual([THERE_PROJECT]);
        expect(otherProjectIds(Array.from({ length: MAX_PROJECTS + 20 }, (_, n) => ({ _id: `p${n}` })), 'p0')).toHaveLength(MAX_PROJECTS);
        expect(otherProjectIds(undefined, HERE_PROJECT)).toEqual([]);
    });

    it('asks the Everything read for the list, in those projects only', () => {
        expect(otherRowsRequest(HERE, [THERE_PROJECT])).toEqual({ filter: { sprintIds: [HERE], projectIds: [THERE_PROJECT] }, limit: 100 });
        expect(otherRowsRequest(HERE, [THERE_PROJECT], 'next')).toMatchObject({ cursor: 'next' });
    });

    it('sends that request once the list is on screen', async () => {
        sent.answer = () => answer([rowThere('t1')]);
        const wrapper = host();
        await flushPromises();

        expect(sent.calls).toEqual([{ method: 'post', url: env.V2_TASKS_EVERYTHING, body: otherRowsRequest(HERE, [THERE_PROJECT]) }]);
        expect(wrapper.vm.other.rows.value.map((row) => row._id)).toEqual(['t1']);
        expect(wrapper.vm.other.projects.value[THERE_PROJECT].ProjectName).toBe('Operations');
    });

    it('asks nothing when the person has no other project, or no list is open', async () => {
        host(storeWith([{ _id: HERE_PROJECT }]));
        host(storeWith(), { project: { _id: HERE_PROJECT }, listId: '' });
        await flushPromises();

        expect(sent.calls).toEqual([]);
    });

    it('reads every page, up to three', async () => {
        const cursors = ['c1', 'c2', 'c3'];
        sent.answer = (body) => answer([rowThere(`t${body.cursor || 0}`)], { [THERE_PROJECT]: cardThere }, cursors[cursors.indexOf(body.cursor) + 1]);
        const wrapper = host();
        await flushPromises();

        expect(sent.calls.map((call) => call.body.cursor)).toEqual([undefined, 'c1', 'c2']);
        expect(wrapper.vm.other.rows.value).toHaveLength(3);
        expect(wrapper.vm.other.truncated.value).toBe(true);
    });

    it('shows nothing when the read fails', async () => {
        sent.answer = () => Promise.reject(new Error('refused'));
        const wrapper = host();
        await flushPromises();

        expect(wrapper.vm.other.rows.value).toEqual([]);
    });
});

describe('which rows are kept', () => {
    it('only what the server sent, of another project, with that project\'s card', () => {
        const rows = [rowThere('t1'), rowThere('mine', { ProjectID: HERE_PROJECT }), rowThere('no-card', { ProjectID: THIRD_PROJECT })];

        expect(keepOtherRows(rows, { [THERE_PROJECT]: cardThere }, HERE_PROJECT).map((row) => row._id)).toEqual(['t1']);
        expect(keepOtherRows(undefined, {}, HERE_PROJECT)).toEqual([]);
    });
});

describe('when the rows are read again', () => {
    it('after a change to a task of another project reaches the list', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const store = storeWith();
        host(store);
        await flushPromises();
        sent.calls.length = 0;

        store.commit('changed');
        store.commit('changed');
        await nextTick();
        expect(sent.calls).toHaveLength(0);
        vi.advanceTimersByTime(1000);
        await flushPromises();

        expect(sent.calls).toHaveLength(1);
    });

    it('and not once the list is gone', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const store = storeWith();
        const wrapper = host(store);
        await flushPromises();
        sent.calls.length = 0;

        store.commit('changed');
        await nextTick();
        wrapper.unmount();
        vi.advanceTimersByTime(1000);
        await flushPromises();

        expect(sent.calls).toHaveLength(0);
    });

    describe('the store raises the marker', () => {
        let state;
        const change = (pid, sprintId, data, updatedFields = { statusKey: 2 }) => mutateUpdateFirebaseTasks(state, { snap: {}, op: 'modified', pid, sprintId, data, updatedFields });
        beforeEach(() => {
            state = { tasks: { [HERE_PROJECT]: { projectId: HERE_PROJECT, sprints: [HERE], [HERE]: { index: {}, found: {}, tasks: [] } } }, tableTasks: {} };
        });

        it('when a change to a task of another project reaches the list, and takes nothing of it', () => {
            change(HERE_PROJECT, HERE, rowThere('t1'));
            change(HERE_PROJECT, HERE, rowThere('t1'));

            expect(state.otherProjectChanges).toBe(2);
            expect(state.tasks[HERE_PROJECT][HERE].tasks).toEqual([]);
        });

        it('when the person changes such a task in its own project, or takes it out of a list', () => {
            change(THERE_PROJECT, THERE, rowThere('t1'));
            expect(state.otherProjectChanges).toBe(1);

            change(THERE_PROJECT, THERE, rowThere('t1', { extraLists: [] }), { extraLists: [] });
            expect(state.otherProjectChanges).toBe(2);
        });

        it('and not for a task that is in no list of another project', () => {
            const own = { _id: 'own', ProjectID: HERE_PROJECT, sprintId: HERE, isParentTask: true, ParentTaskId: '' };

            change(HERE_PROJECT, HERE, own);
            change(HERE_PROJECT, HERE, { ...own, extraLists: [{ projectId: HERE_PROJECT, sprintId: THERE }] });

            expect(state.otherProjectChanges).toBeUndefined();
        });
    });
});

describe('a row from another project', () => {
    it('shows the status of its own project, by name and colour', () => {
        const chip = section().find('.lv2__status-chip');

        expect(chip.text()).toBe('In review');
        expect(chip.element.style.color).toBe(mount({ template: '<i :style="style" />', data: () => ({ style: statusChipStyle(IN_REVIEW) }) }).element.style.color);
    });

    it('cannot be edited in place: no status or priority picker opens', () => {
        const wrapper = section();

        expect(readOnlyCard(cardThere).edit).toEqual({ status: false, priority: false });
        expect(readOnlyCard(null)).toBeNull();
        expect(wrapper.find('.evr__status button').exists()).toBe(false);
        expect(wrapper.find('.evr__prio button').exists()).toBe(false);
        expect(wrapper.find('.evr__prio').text()).toBe('High');
    });

    it('says where it lives', () => {
        const mark = section().find('[data-home-mark]');

        expect(mark.text()).toBe('Ops queue');
        expect(mark.attributes('title')).toBe('Lives in Ops queue, in Operations');
    });

    it('opens the task panel on the project it lives in', async () => {
        const wrapper = section();

        await wrapper.find('.evr__name').trigger('click');

        expect(opened).toEqual([{ companyId: 'c1', projectId: THERE_PROJECT, sprintId: THERE, folderId: '', taskId: 't1' }]);
    });

    it('sits under a heading, with a note when there are more than were read', () => {
        expect(section().find('.opr__head').text()).toContain('From other projects');
        expect(section().find('.opr__note').exists()).toBe(false);
        expect(section({ truncated: true }).find('.opr__note').text()).toBe('This list holds more tasks from other projects than are shown here.');
        expect(section({ rows: [] }).find('[data-other-project-rows]').exists()).toBe(false);
    });

    it('is a card on the Board that cannot be dragged', () => {
        const card = section({ as: 'card', heading: false }).find('.evr__card');

        expect(card.attributes('draggable')).toBe('false');
        expect(card.find('[data-home-mark]').text()).toBe('Ops queue');
    });
});

describe('where a card from another project sits on the Board', () => {
    const status = (key, name) => ({ key: `statusKey_${key}`, searchKey: 'statusKey', searchValue: key, name });
    const columns = [status(1, 'To Do'), status(2, 'In review'), status(7, 'Blocked')];

    it('under the column named like its own status, whatever the key is here', () => {
        expect(columnFor(rowThere('t1'), columns)).toBe(columns[1]);
        expect(columnFor(rowThere('t1', { status: { key: 9, text: 'Shipped' }, statusKey: 9 }), columns)).toBeNull();
    });

    it('by its own value under another grouping', () => {
        const priority = [{ key: 'Task_Priority_HIGH', searchKey: 'Task_Priority', searchValue: 'HIGH', name: 'High' }];
        const custom = [{ key: 'f_1', customFieldId: 'f', searchKey: 'customField.f', searchValue: 'x', name: 'X' }];

        expect(columnFor(rowThere('t1'), priority)).toBe(priority[0]);
        expect(columnFor(rowThere('t1'), custom)).toBeNull();
    });

    it('and the cards no column is named for are kept apart', () => {
        const shipped = rowThere('t2', { status: { key: 9, text: 'Shipped' }, statusKey: 9 });

        expect(placeOnBoard([rowThere('t1'), shipped], columns)).toEqual({ placed: { statusKey_2: [rowThere('t1')] }, unplaced: [shipped] });
        expect(placeOnBoard([], columns)).toEqual({ placed: {}, unplaced: [] });
    });
});

describe('the views that show them', () => {
    const source = (file) => readFileSync(path.resolve(__dirname, '../../src', file), 'utf8');

    it('the List, at the foot of the open list, and not under a search or in the archive', () => {
        const list = source('views/Projects/ListView/ListView.vue');

        expect(list).toContain('useOtherProjectRows(project');
        expect(list).toMatch(/<OtherProjectRows\s+heading/);
        expect(list).toMatch(/otherRowsShown = computed\(\(\) => !searchedTask\.value && !showArchived\.value/);
    });

    it('the Board, in its columns and in one more for the rest', () => {
        const view = source('views/Projects/Kanban/BoardView.vue');
        const board = source('views/Projects/Kanban/KanbanBoard.vue');

        expect(view).toContain('useOtherProjectRows(project');
        expect(view).toContain('placeOnBoard(');
        expect(board).toMatch(/<OtherProjectRows\s+as="card"/);
        expect(board).toContain('data-other-project-column');
    });
});
