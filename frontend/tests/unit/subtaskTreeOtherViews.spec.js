/* The Board and the Table read a task's subtasks from the tree the List fills: the real store and
   loader with an unmocked `@/composable`, and only the HTTP layer a stand-in. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, defineComponent, h, ref } from 'vue';

vi.mock('@/services', async () => ({ apiRequest: (await import('../fakeTaskServer')).apiRequest }));
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));

import '@/services';
import Store from '@/store/index';
import { loadedChildren } from '@/store/ProjectData/taskTree';
import { useSubtaskTree } from '@/views/Projects/composables/subtaskTree';
import { childReads, resetServer, server } from '../fakeTaskServer';
import { PID, PROJECT, SPRINT, TODO_GROUP, fromSocket, readGroup, readTable, seedStore, threeLevels, under } from '../threeLevelTasks';

const ids = (rows) => (rows || []).map((task) => task._id);
const bucket = () => Store.state.projectData.tasks[PID]?.[SPRINT];
const tableRows = () => Store.state.projectData.tableTasks[PID]?.[SPRINT]?.tasks || [];
const stored = (id) => server.tasks.find((task) => task._id === id);

let wrapper;
let tree;

function useTree({ rows, searched = false, showArchived = false }) {
    const Host = defineComponent({
        setup() {
            tree = useSubtaskTree({ project: ref(PROJECT), sprintId: ref(SPRINT), rows, searched: ref(searched), showArchived: ref(showArchived) });
            return () => h('div');
        }
    });
    wrapper = mount(Host, { global: { plugins: [Store], provide: { $userId: ref('u1') } } });
}

const open = async (task) => {
    tree.toggle(task, TODO_GROUP);
    await flushPromises();
};

beforeEach(() => {
    resetServer(threeLevels());
    seedStore(Store);
});
afterEach(() => wrapper?.unmount());

describe('the Board reads a card\'s subtasks from the List\'s tree', () => {
    const cards = computed(() => bucket()?.tasks || []);
    const card = (id) => cards.value.find((task) => task._id === id);

    beforeEach(async () => {
        await readGroup(Store);
        useTree({ rows: cards });
    });

    it('starts closed and asks for nothing', () => {
        expect(ids(cards.value)).toEqual(['t1', 't2']);
        expect(tree.isExpanded('t1')).toBe(false);
        expect(childReads('t1')).toHaveLength(0);
    });

    it('opening a card reads its subtasks by parent into the tree, and shows those rows', async () => {
        await open(card('t1'));
        expect(tree.isExpanded('t1')).toBe(true);
        expect(childReads('t1')).toHaveLength(1);
        expect(ids(tree.childrenOf(card('t1')))).toEqual(['s1', 's2']);
        expect(tree.childrenOf(card('t1'))).toEqual(card('t1').subtaskArray);
    });

    it('opening a subtask reads the third level under it, never to the top', async () => {
        await open(card('t1'));
        await open(tree.childrenOf(card('t1'))[0]);
        expect(childReads('s1')).toHaveLength(1);
        expect(ids(tree.childrenOf(tree.childrenOf(card('t1'))[0]))).toEqual(['g1', 'g2']);
        expect(ids(cards.value)).toEqual(['t1', 't2']);
    });

    it('reads each level once', async () => {
        await open(card('t1'));
        await open(card('t1'));
        expect(tree.isExpanded('t1')).toBe(false);
        await open(card('t1'));
        expect(childReads('t1')).toHaveLength(1);
    });

    it('counts direct children on every level', async () => {
        await flushPromises();
        expect(tree.progressFor(card('t1'))).toEqual({ done: 0, total: 2 });
        await open(card('t1'));
        await flushPromises();
        expect(tree.progressFor(tree.childrenOf(card('t1'))[0])).toEqual({ done: 1, total: 2 });
        expect(tree.progressFor(card('t2'))).toBe(null);
    });

    it('keeps a level-three row that arrives before its parent, and shows it once the parent is there', async () => {
        const early = under(stored('s1'), 'g3', 'Grandchild three', { groupByStatusIndex: 3 });
        server.tasks.push(early);
        fromSocket(Store, 'added', early, early);
        expect(ids(cards.value)).toEqual(['t1', 't2']);
        expect(ids(loadedChildren(bucket(), 's1'))).toEqual(['g3']);

        await open(card('t1'));
        const child = tree.childrenOf(card('t1'))[0];
        expect(ids(tree.childrenOf(child))).toEqual(['g3']);
        await open(child);
        expect(ids(tree.childrenOf(tree.childrenOf(card('t1'))[0])).sort()).toEqual(['g1', 'g2', 'g3']);
    });

    it('leaves out a subtask that was archived', async () => {
        await open(card('t1'));
        fromSocket(Store, 'modified', { ...stored('s2'), deletedStatusKey: 2 }, { deletedStatusKey: 2 });
        expect(ids(tree.childrenOf(card('t1')))).toEqual(['s1']);
    });
});

describe('the Table reads a row\'s subtasks from the same tree', () => {
    const rows = computed(() => tableRows());
    const tableRow = (id) => rows.value.find((task) => task._id === id);

    beforeEach(async () => {
        await readTable(Store);
        useTree({ rows });
    });

    it('pages top-level tasks only: a subtask is a row under its parent, not a row of its own', () => {
        expect(ids(rows.value)).toEqual(['t1', 't2']);
    });

    it('opening a row reads its subtasks by parent, although the List was never opened', async () => {
        expect(bucket()).toBe(undefined);
        await open(tableRow('t1'));
        expect(childReads('t1')).toHaveLength(1);
        expect(ids(tree.childrenOf(tableRow('t1')))).toEqual(['s1', 's2']);
        expect(ids(loadedChildren(bucket(), 't1'))).toEqual(['s1', 's2']);
    });

    it('opens the third level from the second', async () => {
        await open(tableRow('t1'));
        await open(tree.childrenOf(tableRow('t1'))[0]);
        expect(ids(tree.childrenOf(tree.childrenOf(tableRow('t1'))[0]))).toEqual(['g1', 'g2']);
    });

    it('shows the very rows the List then puts under the task', async () => {
        await open(tableRow('t1'));
        await readGroup(Store);
        const inList = bucket().tasks.find((task) => task._id === 't1');
        expect(ids(inList.subtaskArray)).toEqual(['s1', 's2']);
        expect(tree.childrenOf(tableRow('t1'))).toEqual(inList.subtaskArray);
        expect(childReads('t1')).toHaveLength(1);
    });

    it('a change to a subtask reaches the row the Table shows', async () => {
        await open(tableRow('t1'));
        fromSocket(Store, 'modified', { ...stored('s1'), TaskName: 'Child renamed' }, { TaskName: 'Child renamed' });
        expect(tree.childrenOf(tableRow('t1')).map((task) => task.TaskName)).toEqual(['Child renamed', 'Child two']);
    });

    it('counts direct children from the same aggregate', async () => {
        await flushPromises();
        expect(tree.progressFor(tableRow('t1'))).toEqual({ done: 0, total: 2 });
    });
});

describe('a searched view shows the subtasks that matched, on every level', () => {
    it('reads the matches from the searched rows without asking', async () => {
        const [parent, first, , grandchild] = threeLevels();
        const searched = [{ ...parent, subtaskArray: [{ ...first, subtaskArray: [grandchild] }] }];
        useTree({ rows: ref(searched), searched: true });
        await flushPromises();
        expect(tree.isExpanded('t1')).toBe(true);
        expect(tree.isExpanded('s1')).toBe(true);
        expect(ids(tree.childrenOf(searched[0]))).toEqual(['s1']);
        expect(ids(tree.childrenOf(searched[0].subtaskArray[0]))).toEqual(['g1']);
        expect(childReads('t1')).toHaveLength(0);
    });
});
