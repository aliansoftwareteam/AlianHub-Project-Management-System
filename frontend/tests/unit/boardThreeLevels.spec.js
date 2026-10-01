/* Three levels of subtasks on the real Board: the real BoardView, KanbanBoard and card, the real
   loader and store, and an unmocked `@/composable`. Only the HTTP layer is a stand-in. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { defineComponent, h, ref } from 'vue';
import en from '@/locales/en';

const { movedByGroup } = vi.hoisted(() => ({ movedByGroup: vi.fn(() => Promise.resolve(true)) }));
vi.mock('@/services', async () => ({ apiRequest: (await import('../fakeTaskServer')).apiRequest }));
vi.mock('@/views/Projects/helper', async (importOriginal) => ({ ...(await importOriginal()), useUpdateTasks: () => ({ updateTaskByGroup: movedByGroup }) }));
vi.mock('vue-router', async () => {
    const { reactive } = await import('vue');
    const route = reactive({ name: 'Project', query: { tab: 'ProjectKanban' }, params: {} });
    return { useRoute: () => route, useRouter: () => ({ resolve: () => ({ href: '/task' }), hasRoute: () => false, push: vi.fn() }) };
});
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));
vi.mock('@/views/Projects/Kanban/useProjectAgents', () => ({
    useProjectAgents: () => ({ start: () => {}, runFor: () => null, proposalFor: () => null })
}));
vi.mock('@/components/molecules/Home/useTimer', () => ({ useTimer: () => ({ timer: { active: null }, elapsedMs: { value: 0 }, isTracking: () => false }) }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn(), useTaskSequenceSource: () => {} }));
vi.mock('@/composable/firstRunProgress', () => ({ markFirstRunStep: () => {}, FIRST_RUN_STEPS: {} }));

import '@/services';
import Store from '@/store/index';
import BoardView from '@/views/Projects/Kanban/BoardView.vue';
import { childReads, resetServer, server } from '../fakeTaskServer';
import { PID, PROJECT, SPRINT, TODO_GROUP, fromSocket, readTable, seedStore, threeLevels, under } from '../threeLevelTasks';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];

const DraggableStub = defineComponent({
    name: 'DraggableStub',
    props: ['list'],
    setup: (props, { slots }) => () => h('div', props.list.map((element) => slots.item({ element })))
});
const CreateStub = defineComponent({
    name: 'BoardViewTaskCreate',
    props: ['taskId', 'data', 'isSubTask'],
    emits: ['toggle'],
    setup: (props) => () => h('div', { class: 'create-stub', 'data-parent': props.taskId, 'data-column': props.data?.name })
});

const settle = async (ms = 0) => {
    await flushPromises();
    if (ms) vi.advanceTimersByTime(ms);
    await flushPromises();
};
const stored = (id) => server.tasks.find((task) => task._id === id);

let wrapper;
const openedTasks = vi.fn();

async function openBoard() {
    wrapper = mount(BoardView, {
        attachTo: document.body,
        props: { grouped: 0, sprints: [{ id: SPRINT, name: 'List', projectId: PID, tasks: 6, deletedStatusKey: 0 }], projectData: PROJECT },
        global: {
            plugins: [Store],
            mocks: { $t: (...args) => i18n.global.t(...args) },
            provide: {
                selectedProject: ref(PROJECT), $clientWidth: ref(1280), $companyId: ref('c1'), $userId: ref('u1'), $dateFormat: ref('DD/MM/YYYY'),
                showArchived: ref(false), searchedTask: ref(false), taskCollapsed: ref(true), toggleTaskDetail: openedTasks
            },
            stubs: {
                Draggable: DraggableStub, draggable: DraggableStub, BoardViewTaskCreate: CreateStub, BoardViewTaskCreateVue: CreateStub,
                UpgradePlan: true, Skelaton: true, ListBulkBar: true, EmptyState: true, ViewColumnChooser: true, ListSortControl: true,
                Assignee: true, Priority: true, CalenderCompo: true, TagChip: true, CreateTagPopup: true, ConfirmationSidebar: true,
                TaskMenuSidebars: true, ProvenanceBadge: true
            }
        }
    });
    await settle(600);
    return wrapper;
}

const cards = () => wrapper.findAll('.kanban-card');
const cardNames = () => cards().map((el) => el.find('.card-title').text());
const cardOf = (name) => cards().find((el) => el.find('.card-title').text().includes(name));
const toggleOf = (name) => cardOf(name).find('button.card-subtasks-toggle');
const subRows = (name) => cardOf(name).findAll('.card-subtask');
const subNames = (name) => subRows(name).map((el) => el.find('.card-subtask__name').text());
const subRow = (name) => wrapper.findAll('.card-subtask').find((el) => el.find('.card-subtask__name').text() === name);
const menuItems = () => [...document.body.querySelectorAll('[role="menu"] [role="menuitem"]')].map((item) => item.dataset.item);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    resetServer(threeLevels());
    seedStore(Store);
    openedTasks.mockReset();
    movedByGroup.mockClear();
});
afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = '';
    vi.useRealTimers();
});

describe('a card and the subtasks under it', () => {
    beforeEach(async () => { await openBoard(); });

    it('shows a card for each task, and none for a subtask', () => {
        expect(cardNames().map((text) => text.replace(/^QA-\S+\s*/, ''))).toEqual(['Parent', 'Loner']);
    });

    it('counts the direct subtasks that are done on the card: 0/2', async () => {
        await settle();
        expect(toggleOf('Parent').text()).toBe('0/2');
        expect(toggleOf('Parent').attributes('aria-expanded')).toBe('false');
        expect(toggleOf('Parent').attributes('aria-label')).toBe('Subtasks: 0 of 2 done');
        expect(toggleOf('Loner').exists()).toBe(false);
    });

    it('opening the count reads the subtasks by parent and lists them inside the card', async () => {
        await toggleOf('Parent').trigger('click');
        await settle();
        expect(childReads('t1')).toHaveLength(1);
        expect(toggleOf('Parent').attributes('aria-expanded')).toBe('true');
        expect(subNames('Parent')).toEqual(['Child one', 'Child two']);
        expect(subRow('Child one').attributes('data-depth')).toBe('1');
        expect(subRow('Child one').find('.card-subtask__count').text()).toBe('1/2');
        expect(subRow('Child two').find('.card-subtask__count').exists()).toBe(false);
        expect(openedTasks).not.toHaveBeenCalled();
    });

    it('a subtask opens its own subtasks: the third level is listed, and takes none', async () => {
        await toggleOf('Parent').trigger('click');
        await settle();
        await subRow('Child one').find('button.card-subtask__disclose').trigger('click');
        await settle();
        expect(childReads('s1')).toHaveLength(1);
        expect(subNames('Parent')).toEqual(['Child one', 'Grandchild one', 'Grandchild two', 'Child two']);
        expect(subRow('Grandchild one').attributes('data-depth')).toBe('2');
        expect(subRow('Grandchild one').find('button.card-subtask__disclose').exists()).toBe(false);
        expect(subRow('Grandchild one').find('button.card-subtask__add').exists()).toBe(false);
        expect(cards()).toHaveLength(2);
    });

    it('opens the task a nested row names, not the card', async () => {
        await toggleOf('Parent').trigger('click');
        await settle();
        await subRow('Child two').find('.card-subtask__name').trigger('click');
        expect(openedTasks).toHaveBeenCalledTimes(1);
        expect(openedTasks.mock.calls[0][0]._id).toBe('s2');
    });

    it('never drops a level-three row someone else adds: it lands under its subtask', async () => {
        await toggleOf('Parent').trigger('click');
        await settle();
        await subRow('Child one').find('button.card-subtask__disclose').trigger('click');
        await settle();
        const added = under(stored('s1'), 'g3', 'Grandchild three', { groupByStatusIndex: 3 });
        fromSocket(Store, 'added', added, added);
        await settle();
        expect(subNames('Parent')).toEqual(['Child one', 'Grandchild one', 'Grandchild two', 'Grandchild three', 'Child two']);
        expect(cards()).toHaveLength(2);
    });

    it('keeps a level-three row that arrives before its parent was read', async () => {
        const early = under(stored('s2'), 'g9', 'Early grandchild');
        server.tasks.push(early);
        fromSocket(Store, 'added', early, early);
        await settle();
        expect(cards()).toHaveLength(2);
        await toggleOf('Parent').trigger('click');
        await settle();
        await subRow('Child two').find('button.card-subtask__disclose').trigger('click');
        await settle();
        expect(subNames('Parent')).toEqual(['Child one', 'Child two', 'Early grandchild']);
    });
});

describe('adding a subtask from the Board', () => {
    beforeEach(async () => { await openBoard(); });

    const creates = () => wrapper.findAll('.create-stub').map((el) => el.attributes('data-parent'));

    it('the card menu offers Add subtask, and opens the create row with the card\'s subtasks', async () => {
        await cardOf('Parent').find('.option-list__trigger').trigger('click');
        expect(menuItems()).toContain('subtask');
        document.body.querySelector('[role="menu"] [data-item="subtask"]').click();
        await settle();
        expect(creates()).toEqual(['t1']);
        expect(subNames('Parent')).toEqual(['Child one', 'Child two']);
    });

    it('a level-two row takes a subtask: its create row names it as the parent and keeps the column', async () => {
        await toggleOf('Parent').trigger('click');
        await settle();
        await subRow('Child two').find('button.card-subtask__add').trigger('click');
        await settle();
        expect(creates()).toEqual(['s2']);
        expect(wrapper.find('.create-stub').attributes('data-column')).toBe('To Do');
        expect(openedTasks).not.toHaveBeenCalled();
    });

    it('closes the create row when it is dismissed', async () => {
        await toggleOf('Parent').trigger('click');
        await settle();
        await subRow('Child two').find('button.card-subtask__add').trigger('click');
        await settle();
        wrapper.findComponent(CreateStub).vm.$emit('toggle');
        await settle();
        expect(creates()).toEqual([]);
    });
});

describe('the Board after the Table', () => {
    it('still loads its columns when the Table has read a row\'s subtasks into the tree first', async () => {
        await readTable(Store);
        await Store.dispatch('projectData/getPaginatedTasks', {
            pid: PID, sprintId: SPRINT, item: TODO_GROUP, fetchNew: true, firstPageOnly: true, parentId: 't1', userId: 'u1', showAllTasks: true
        });
        expect(Store.state.projectData.tasks[PID][SPRINT].tasks).toEqual([]);

        await openBoard();
        expect(cards()).toHaveLength(2);
        await toggleOf('Parent').trigger('click');
        await settle();
        expect(subNames('Parent')).toEqual(['Child one', 'Child two']);
        expect(childReads('t1')).toHaveLength(1);
    });
});

describe('dragging a card', () => {
    it('moves the task alone: the server carries its subtasks, so nothing is sent for them', async () => {
        await openBoard();
        await toggleOf('Parent').trigger('click');
        await settle();
        const card = Store.state.projectData.tasks[PID][SPRINT].tasks[0];
        const done = wrapper.findAllComponents(DraggableStub)[1];
        done.props('list').push(card);
        done.vm.$emit('change', { added: { element: card, newIndex: 0 } });
        await settle();
        expect(movedByGroup.mock.calls.map(([task]) => task._id)).toEqual(['t1']);
        expect(server.posts.map((post) => post.body?.taskId).filter(Boolean)).toEqual(['t1']);
    });
});
