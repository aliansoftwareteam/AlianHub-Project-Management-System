import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import moment from 'moment';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const state = vi.hoisted(() => ({ list: null }));

vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn(() => Promise.resolve({ data: {} })) }));
vi.mock('@/components/molecules/Home/usePersonalList', () => ({ usePersonalList: () => state.list }));
vi.mock('@/views/TaskDetail/TaskDetail.vue', () => ({
    default: { name: 'TaskDetail', props: ['taskId', 'projectId', 'sprintId'], emits: ['toggleTaskDetail'], template: '<div class="detail" @click="$emit(\'toggleTaskDetail\')">{{ taskId }}|{{ projectId }}|{{ sprintId }}</div>' }
}));
vi.mock('@/components/organisms/CreateProject/CreateProjectSidebar.vue', () => ({
    default: { name: 'CreateProjectSidebar', emits: ['closeSidebar'], template: '<div class="create-project" @click="$emit(\'closeSidebar\')"></div>' }
}));
vi.mock('@/components/molecules/Home/HomeSidebar.vue', () => ({
    default: { name: 'HomeSidebar', props: ['assignedCount'], emits: ['create-project'], template: '<aside class="side" :data-count="assignedCount" @click="$emit(\'create-project\')"></aside>' }
}));

import PersonalList from '@/views/PersonalList/PersonalList.vue';
import { homeState } from '@/components/molecules/Home/homeState';

const source = readFileSync(resolve(__dirname, '../../src/views/PersonalList/PersonalList.vue'), 'utf8');

const statuses = [
    { key: 's1', name: 'To do', type: 'default_active', value: 'todo', bgColor: '#aaaaaa' },
    { key: 's2', name: 'Finished', type: 'done', value: 'done', bgColor: '#00aa00' }
];
const tasksOf = () => [
    { _id: 't1', TaskName: 'Water plants', statusKey: 's1', statusType: 'default_active', DueDate: moment().add(3, 'days').toISOString(), Task_Priority: 'HIGH', ProjectID: 'p1', sprintId: 'sp1' },
    { _id: 't2', TaskName: 'File taxes', statusKey: 's2', statusType: 'done', Task_Priority: 'LOW', totalLoggedTime: 5400 },
    { _id: 't3', TaskName: 'Pay rent', statusKey: 's1', statusType: 'default_active', DueDate: moment().subtract(2, 'days').toISOString(), Task_Priority: 'URGENT' }
];

function makeList(tasks = tasksOf(), over = {}) {
    const personal = reactive({ project: { _id: 'p1', taskStatusData: statuses }, sprint: { _id: 'sp1' }, loading: false, error: null });
    return {
        personal,
        isDone: (t) => ['done', 'close'].includes(t.statusType),
        ensure: vi.fn(() => Promise.resolve(personal)),
        fetchTasks: vi.fn(() => Promise.resolve(tasks)),
        createTask: vi.fn((name) => Promise.resolve({ _id: 'new', TaskName: name, statusKey: 's1', statusType: 'default_active' })),
        setStatus: vi.fn(() => Promise.resolve()),
        defaultStatus: () => statuses[0],
        doneStatus: () => statuses[1],
        ...over
    };
}

const mountPage = async (list = makeList()) => {
    state.list = list;
    const wrapper = mount(PersonalList, {
        attachTo: document.body,
        global: { stubs: { ShellIcon: true }, components: { RouterLink: { props: ['to'], template: '<a class="rl"><slot /></a>' } } }
    });
    await flushPromises();
    return wrapper;
};
const names = (wrapper) => wrapper.findAll('.personal__name').map((n) => n.text());
const addInput = (wrapper) => wrapper.get('.personal__add input[type="text"]');
const button = (wrapper, label) => wrapper.findAll('button').find((b) => b.text() === label);

beforeEach(() => {
    localStorage.clear();
    toast.success.mockClear();
    toast.error.mockClear();
    homeState.sidebarOpen = true;
    document.body.innerHTML = '';
});

describe('PersonalList states', () => {
    it('shows the loading line while the list is being prepared', async () => {
        const list = makeList([]);
        list.personal.project = null;
        list.personal.loading = true;
        list.ensure = vi.fn(() => new Promise(() => {}));
        const wrapper = await mountPage(list);
        expect(wrapper.get('.hc-loading').text()).toBe('Home.personal_loading');
        expect(wrapper.find('.personal__add').exists()).toBe(false);
    });

    it('shows the failure line instead of the list when it cannot be prepared', async () => {
        const list = makeList([]);
        list.personal.error = 'down';
        list.ensure = vi.fn(() => Promise.reject(new Error('down')));
        const wrapper = await mountPage(list);
        expect(wrapper.get('.ah-empty').text()).toBe('Home.personal_failed');
        expect(wrapper.find('.personal__add').exists()).toBe(false);
    });

    it('shows the empty message and no footer add row when there are no tasks', async () => {
        const wrapper = await mountPage(makeList([]));
        expect(wrapper.get('.personal__empty').text()).toBe('Home.personal_empty');
        expect(wrapper.find('.personal__new').exists()).toBe(false);
    });

    // A failed task fetch is swallowed, so the person is told the list is empty rather than that it failed.
    it.fails('tells the person when the tasks could not be fetched', async () => {
        const list = makeList([], { fetchTasks: vi.fn(() => Promise.reject(new Error('500'))) });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const wrapper = await mountPage(list);
        expect(wrapper.find('.personal__empty').exists()).toBe(false);
    });
});

describe('PersonalList table', () => {
    it('labels the toolbar, views and columns from i18n keys', async () => {
        const wrapper = await mountPage();
        expect(wrapper.get('.ah-toolbar__title').text()).toContain('Home.personal_list');
        expect(wrapper.get('.personal__only').text()).toBe('Home.only_you');
        expect(wrapper.get('nav').attributes('aria-label')).toBe('Home.views_nav');
        expect(wrapper.get('.personal__sidebar-toggle').attributes('title')).toBe('Home.show_sidebar');
        expect(wrapper.findAll('.personal__view').map((v) => v.text())).toEqual(['Home.list', 'Home.board', 'Home.calendar', 'Home.add_view']);
        expect(wrapper.findAll('.personal__head span').map((s) => s.text())).toEqual(['', 'Home.col_name', 'Home.col_due', 'Home.col_priority', 'Home.col_status', 'Home.col_time']);
        expect(wrapper.get('.personal__add input[type="text"]').attributes('placeholder')).toBe('Home.new_task_row');
        expect(wrapper.get('.personal__foot').text()).toBe('Home.personal_footer Home.personal_footer_short');
    });

    it('lists open tasks by due date first and done tasks last', async () => {
        const wrapper = await mountPage();
        expect(names(wrapper)).toEqual(['Pay rent', 'Water plants', 'File taxes']);
        expect(wrapper.findAll('.personal__row')[2].classes()).toContain('is-done');
    });

    it('shows due, priority, status and logged time for each row', async () => {
        const wrapper = await mountPage();
        const [rent, plants, taxes] = wrapper.findAll('.personal__row');
        expect(rent.find('.personal__mono--danger').exists()).toBe(true);
        expect(rent.get('.hc-row__prio').text()).toBe('Home.priority_urgent');
        expect(plants.get('.hc-row__prio').text()).toBe('Home.priority_high');
        expect(plants.get('.personal__status').text()).toBe('To do');
        expect(taxes.find('.hc-row__prio').exists()).toBe(false);
        expect(taxes.get('.personal__status').text()).toBe('Finished');
        expect(taxes.findAll('.personal__mono')[1].text()).toBe('1h 30m');
        expect(taxes.findAll('.personal__mono')[0].text()).toBe('—');
    });

    it('checks the box of done tasks only and names it after the task', async () => {
        const wrapper = await mountPage();
        const boxes = wrapper.findAll('.personal__row input[type="checkbox"]');
        expect(boxes.map((b) => b.element.checked)).toEqual([false, false, true]);
        expect(boxes.map((b) => b.attributes('aria-label'))).toEqual(['Pay rent', 'Water plants', 'File taxes']);
    });

    it('tells the sidebar how many tasks are still open', async () => {
        expect((await mountPage()).get('.side').attributes('data-count')).toBe('2');
    });

    it('hides done tasks with the filter and marks the filter as on', async () => {
        const wrapper = await mountPage();
        const filter = button(wrapper, 'Home.filter');
        await filter.trigger('click');
        expect(names(wrapper)).toEqual(['Pay rent', 'Water plants']);
        expect(filter.classes()).toContain('is-active');
        await filter.trigger('click');
        expect(names(wrapper)).toHaveLength(3);
    });

    it('leaves the group button disabled', async () => {
        expect(button(await mountPage(), 'Home.group_none').attributes('disabled')).toBeDefined();
    });

    it('links the calendar view to the planner', async () => {
        const wrapper = await mountPage();
        expect(wrapper.findComponent({ name: 'RouterLink' }).props('to')).toMatchObject({ name: 'Planner' });
    });

    it('has no bare words in its template', () => {
        const template = source.slice(0, source.indexOf('<script'));
        const bareText = [...template.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1].trim()).filter(Boolean);
        expect(bareText).toEqual([]);
        expect([...template.matchAll(/\s(?:title|placeholder|alt|aria-label)="([^"]+)"/g)]).toEqual([]);
    });
});

describe('PersonalList status changes', () => {
    it('completes a task from its checkbox and moves it down', async () => {
        const list = makeList();
        const wrapper = await mountPage(list);
        await wrapper.findAll('.personal__row input[type="checkbox"]')[0].setValue(true);
        await flushPromises();
        const rent = wrapper.findAll('.personal__row').find((r) => r.text().includes('Pay rent'));
        expect(rent.classes()).toContain('is-done');
        expect(rent.get('.personal__status').text()).toBe('Finished');
        expect(wrapper.get('.side').attributes('data-count')).toBe('1');
    });

    it('re-opens a done task', async () => {
        const wrapper = await mountPage();
        await wrapper.findAll('.personal__row input[type="checkbox"]')[2].setValue(false);
        await flushPromises();
        const taxes = wrapper.findAll('.personal__row').find((r) => r.text().includes('File taxes'));
        expect(taxes.classes()).not.toContain('is-done');
        expect(taxes.get('.personal__status').text()).toBe('To do');
    });

    it('puts the task back and says so when the change fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const list = makeList(tasksOf(), { setStatus: vi.fn(() => Promise.reject(new Error('no'))) });
        const wrapper = await mountPage(list);
        await wrapper.findAll('.personal__row input[type="checkbox"]')[0].setValue(true);
        await flushPromises();
        const rent = wrapper.findAll('.personal__row').find((r) => r.text().includes('Pay rent'));
        expect(rent.classes()).not.toContain('is-done');
        expect(rent.get('.personal__status').text()).toBe('To do');
        expect(toast.error).toHaveBeenCalledWith('Home.task_update_failed', expect.anything());
    });
});

describe('PersonalList adding a task', () => {
    it('adds a task on submit, shows it and clears the field', async () => {
        const wrapper = await mountPage();
        await addInput(wrapper).setValue('  Book dentist ');
        await wrapper.get('.personal__add').trigger('submit');
        await flushPromises();
        expect(names(wrapper)).toContain('Book dentist');
        expect(addInput(wrapper).element.value).toBe('');
    });

    // focus() runs while the field is still disabled for the save, so focus is lost and quick entry needs a click.
    it.fails('keeps focus in the add field after a task is saved', async () => {
        const wrapper = await mountPage();
        await addInput(wrapper).setValue('Book dentist');
        await wrapper.get('.personal__add').trigger('submit');
        await flushPromises();
        expect(document.activeElement).toBe(addInput(wrapper).element);
    });

    it('does nothing for a name shorter than three characters', async () => {
        const list = makeList();
        const wrapper = await mountPage(list);
        await addInput(wrapper).setValue('ab');
        await wrapper.get('.personal__add').trigger('submit');
        await flushPromises();
        expect(names(wrapper)).toHaveLength(3);
        expect(addInput(wrapper).element.value).toBe('ab');
    });

    it('keeps the typed name and says so when saving fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const list = makeList(tasksOf(), { createTask: vi.fn(() => Promise.reject(new Error('no'))) });
        const wrapper = await mountPage(list);
        await addInput(wrapper).setValue('Book dentist');
        await wrapper.get('.personal__add').trigger('submit');
        await flushPromises();
        expect(addInput(wrapper).element.value).toBe('Book dentist');
        expect(names(wrapper)).toHaveLength(3);
        expect(toast.error).toHaveBeenCalledWith('Home.task_update_failed', expect.anything());
    });

    it('disables the field while the task is being saved', async () => {
        let release;
        const list = makeList(tasksOf(), { createTask: vi.fn(() => new Promise((r) => { release = r; })) });
        const wrapper = await mountPage(list);
        await addInput(wrapper).setValue('Book dentist');
        await wrapper.get('.personal__add').trigger('submit');
        expect(addInput(wrapper).attributes('disabled')).toBeDefined();
        release({ _id: 'n', TaskName: 'Book dentist', statusKey: 's1', statusType: 'default_active' });
        await flushPromises();
        expect(addInput(wrapper).attributes('disabled')).toBeUndefined();
    });

    it('limits the name to 250 characters', async () => {
        expect((await mountPage()).get('.personal__add input').attributes('maxlength')).toBe('250');
    });

    it('focuses the add field from the Add task button', async () => {
        const wrapper = await mountPage();
        await button(wrapper, 'Home.add_task').trigger('click');
        expect(document.activeElement).toBe(addInput(wrapper).element);
    });

    it('focuses the add field from the footer row', async () => {
        const wrapper = await mountPage();
        await wrapper.get('.personal__new').trigger('click');
        expect(document.activeElement).toBe(addInput(wrapper).element);
        expect(wrapper.get('.personal__new').text()).toContain('Home.new_task_row');
    });

    it('marks the add row while the field has focus', async () => {
        const wrapper = await mountPage();
        await addInput(wrapper).trigger('focus');
        expect(wrapper.get('.personal__add').classes()).toContain('is-focused');
        await addInput(wrapper).trigger('blur');
        expect(wrapper.get('.personal__add').classes()).not.toContain('is-focused');
    });

    it('turns Tab in the field into a due date pick, shows the label, and keeps it for the task', async () => {
        const wrapper = await mountPage();
        const date = wrapper.get('input[type="date"]');
        date.element.showPicker = vi.fn();
        const event = await addInput(wrapper).trigger('keydown', { key: 'Tab' });
        expect(event).toBeUndefined();
        expect(date.element.value).toBe(moment().format('YYYY-MM-DD'));
        date.element.value = moment().add(1, 'day').format('YYYY-MM-DD');
        await date.trigger('change');
        expect(wrapper.get('.personal__add .hc-row__meta').text()).toBe('Home.tomorrow');
        expect(document.activeElement).toBe(addInput(wrapper).element);
        await addInput(wrapper).setValue('Book dentist');
        await wrapper.get('.personal__add').trigger('submit');
        await flushPromises();
        expect(wrapper.find('.personal__add .hc-row__meta').exists()).toBe(false);
    });

    it('explains the Tab shortcut with a hint', async () => {
        expect((await mountPage()).get('.hc-add__hint').text()).toBe('Home.add_hint');
    });
});

describe('PersonalList board', () => {
    const toBoard = async (wrapper) => button(wrapper, 'Home.board').trigger('click');

    it('shows a column per status with its tasks and counts', async () => {
        const wrapper = await mountPage();
        await toBoard(wrapper);
        const cols = wrapper.findAll('.personal__col');
        expect(cols.map((c) => c.get('.personal__col-head').text())).toEqual(['To do2', 'Finished1']);
        expect(cols[0].findAll('.personal__card-title').map((t) => t.text())).toEqual(['Pay rent', 'Water plants']);
        expect(wrapper.find('.personal__table').exists()).toBe(false);
        expect(button(wrapper, 'Home.board').classes()).toContain('is-active');
    });

    it('says a column is empty', async () => {
        const wrapper = await mountPage(makeList([tasksOf()[0]]));
        await toBoard(wrapper);
        expect(wrapper.findAll('.personal__col')[1].get('.personal__col-empty').text()).toBe('Home.board_empty');
    });

    it('moves a card to the column it is dropped on', async () => {
        const wrapper = await mountPage();
        await toBoard(wrapper);
        const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
        await wrapper.findAll('.personal__card')[0].trigger('dragstart', { dataTransfer });
        const target = wrapper.findAll('.personal__col')[1];
        await target.trigger('dragover');
        expect(target.classes()).toContain('is-over');
        await target.trigger('drop');
        await flushPromises();
        expect(target.classes()).not.toContain('is-over');
        expect(wrapper.findAll('.personal__col')[1].findAll('.personal__card-title').map((t) => t.text())).toContain('Pay rent');
        expect(wrapper.findAll('.personal__col')[0].get('.personal__col-count').text()).toBe('1');
    });

    it('opens a card in the task detail', async () => {
        const wrapper = await mountPage();
        await toBoard(wrapper);
        await wrapper.findAll('.personal__card')[1].trigger('click');
        expect(wrapper.get('.detail').text()).toBe('t1|p1|sp1');
    });

    // The page reads this key on load but never writes it, so the choice is lost on reload.
    it.fails('opens on the board after reload once the board was chosen', async () => {
        const wrapper = await mountPage();
        await toBoard(wrapper);
        wrapper.unmount();
        const again = await mountPage();
        expect(again.find('.personal__board').exists()).toBe(true);
    });

    it('opens on the board when that is what was remembered', async () => {
        localStorage.setItem('ah.personal.view', 'board');
        expect((await mountPage()).find('.personal__board').exists()).toBe(true);
    });
});

describe('PersonalList panels', () => {
    it('opens a task from its name and reloads the list when the detail closes', async () => {
        const list = makeList();
        const wrapper = await mountPage(list);
        await wrapper.findAll('.personal__name')[1].trigger('click');
        expect(wrapper.get('.detail').text()).toBe('t1|p1|sp1');
        list.fetchTasks.mockResolvedValue([{ ...tasksOf()[0], TaskName: 'Water the garden' }]);
        await wrapper.get('.detail').trigger('click');
        await flushPromises();
        expect(wrapper.find('.detail').exists()).toBe(false);
        expect(names(wrapper)).toEqual(['Water the garden']);
    });

    it('toggles the home sidebar from the toolbar button', async () => {
        const wrapper = await mountPage();
        await wrapper.get('.personal__sidebar-toggle').trigger('click');
        expect(homeState.sidebarOpen).toBe(false);
        await wrapper.get('.personal__sidebar-toggle').trigger('click');
        expect(homeState.sidebarOpen).toBe(true);
    });

    it('opens and closes the create project panel from the sidebar', async () => {
        const wrapper = await mountPage();
        expect(wrapper.find('.create-project').exists()).toBe(false);
        await wrapper.get('.side').trigger('click');
        expect(wrapper.find('.create-project').exists()).toBe(true);
        await wrapper.get('.create-project').trigger('click');
        expect(wrapper.find('.create-project').exists()).toBe(false);
    });
});
