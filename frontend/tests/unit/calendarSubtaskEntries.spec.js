/* The Calendar shows a dated subtask of any level as its own entry and says which task it sits
   under. The real component, calendar grid, store and `@/composable`; only HTTP is a stand-in. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { ref } from 'vue';
import en from '@/locales/en';

vi.mock('@/services', async () => ({ apiRequest: (await import('../fakeTaskServer')).apiRequest }));
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn() }));

import '@/services';
import Store from '@/store/index';
import CalendarViewComponent from '@/views/Projects/ProjectCalendarView/CalendarViewComponent.vue';
import { resetServer, server } from '../fakeTaskServer';
import { PID, PROJECT, SPRINT, seedStore, threeLevels } from '../threeLevelTasks';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n];

const dayOfThisMonth = (day) => {
    const date = new Date();
    date.setDate(day);
    date.setHours(12, 0, 0, 0);
    return date.getTime();
};
const dated = (ids) => ids.forEach((id, index) => {
    const task = server.tasks.find((candidate) => candidate._id === id);
    task.DueDate = dayOfThisMonth(12 + index);
    task.startDate = task.DueDate;
});

let wrapper;

async function openCalendar({ searched = false } = {}) {
    wrapper = mount(CalendarViewComponent, {
        props: { sprint: { id: SPRINT, _id: SPRINT, name: 'List' }, projectData: PROJECT },
        global: {
            plugins: [Store],
            mocks: { $t: (...args) => i18n.global.t(...args) },
            provide: { $companyId: ref('c1'), $userId: ref('u1'), $dateFormat: ref('DD/MM/YYYY'), searchedTask: ref(searched), toggleTaskDetail: vi.fn() },
            stubs: { SpinnerComp: true, RouterLink: true }
        }
    });
    await flushPromises();
    await flushPromises();
    return wrapper;
}

const chips = () => wrapper.findAll('.cv__chip');
const entries = () => chips().map((el) => el.text()).sort();
const chip = (name) => chips().find((el) => el.text() === name);
const trayCard = (name) => wrapper.findAll('.cv__card').find((el) => el.find('.cv__card-name').text() === name);

beforeEach(() => {
    resetServer(threeLevels());
    seedStore(Store);
    Store.state.projectData.mongoUpdatedTask = {};
});
afterEach(() => wrapper?.unmount());

describe('dated tasks of the sprint', () => {
    beforeEach(async () => {
        dated(['t1', 's2', 'g1']);
        await openCalendar();
    });

    it('gives a task, a subtask and a sub-subtask an entry each', () => {
        expect(entries()).toEqual(['Child two', 'Grandchild one', 'Parent']);
    });

    it('names the task above a subtask on hover, and every task above a sub-subtask', () => {
        expect(chip('Parent').attributes('title')).toBe('Parent');
        expect(chip('Child two').attributes('title')).toBe('Child two · subtask of Parent');
        expect(chip('Grandchild one').attributes('title')).toBe('Grandchild one · subtask of Parent › Child one');
    });

    it('keeps an undated subtask of any level in the tray, with the task it sits under', () => {
        expect(wrapper.findAll('.cv__card-name').map((el) => el.text()).sort()).toEqual(['Child one', 'Grandchild two', 'Loner']);
        expect(trayCard('Grandchild two').find('.cv__card-meta').text()).toContain('Subtask of Parent › Child one');
        expect(trayCard('Loner').find('.cv__card-meta').text()).not.toContain('Subtask of');
    });

    it('adds an entry for a sub-subtask that gets a date elsewhere', async () => {
        const changed = { ...server.tasks.find((task) => task._id === 'g2'), DueDate: dayOfThisMonth(16), startDate: dayOfThisMonth(16) };
        Store.commit('projectData/mutateMongoUpdatedTask', { snap: {}, op: 'modified', pid: PID, sprintId: SPRINT, data: changed });
        await flushPromises();
        expect(entries()).toEqual(['Child two', 'Grandchild one', 'Grandchild two', 'Parent']);
        expect(chip('Grandchild two').attributes('title')).toBe('Grandchild two · subtask of Parent › Child one');
    });
});

describe('a searched calendar', () => {
    it('keeps a matching sub-subtask: every level of the result is an entry', async () => {
        dated(['t1', 's1', 'g1']);
        const [parent, first, , grandchild] = server.tasks;
        Store.state.projectData.searchedTasks = [{ ...parent, subtaskArray: [{ ...first, subtaskArray: [{ ...grandchild }] }] }];
        await openCalendar({ searched: true });
        expect(entries()).toEqual(['Child one', 'Grandchild one', 'Parent']);
        expect(chip('Grandchild one').attributes('title')).toBe('Grandchild one · subtask of Parent › Child one');
    });
});
