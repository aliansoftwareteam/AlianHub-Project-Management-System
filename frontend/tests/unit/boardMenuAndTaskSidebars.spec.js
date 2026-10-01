/* QA pass on task 046: the Board card opens the themed menu the List row has, shows the List's
   short dates, and the Merge and Convert sidebars follow the theme and carry a real name. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { createStore } from 'vuex';
import fs from 'fs';
import path from 'path';

const { perms } = vi.hoisted(() => ({ perms: { value: {} } }));
const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({
        checkPermission: (permission) => (permission in perms.value ? perms.value[permission] : true),
        checkApps: () => true,
        makeUniqueId: () => 'id',
        debounce: (fn) => fn
    }),
    useConvertDate: () => ({ convertDateFormat: (value) => (value ? '10/10/2026' : '') }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: `User ${id}` }), getTeam: () => ({}), getPriorities: () => [] })
}));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: [] })) }));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@/composable/commonFunction', () => ({
    companyPrioritiesIcons: () => ({}),
    isBundledPriorityImage: () => true,
    taskPlanPermission: () => ({ checkTaskPerSprintPermisssion: () => Promise.resolve(true) }),
    sprintPlanPermission: () => ({ checkPerProjectSprintPermission: () => Promise.resolve(true) })
}));
vi.mock('@/composable/Validation', () => ({ useValidation: () => ({ checkErrors: vi.fn(), checkAllFields: vi.fn(() => Promise.resolve(true)) }) }));
vi.mock('@/composable/useTaskSelection.js', () => ({ useTaskSelection: () => ({ isSelected: () => false, selectFromEvent: vi.fn() }) }));
vi.mock('@/components/molecules/Home/useTimer', () => ({ useTimer: () => ({ timer: { active: null }, elapsedMs: { value: 0 }, isTracking: () => false }) }));
vi.mock('@/utils/assigneeOptions', () => ({ permittedAssignees: () => [], selfAssignable: () => [], sprintOf: () => null }));
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));
vi.mock('@/views/Projects/helper', () => ({ useUpdateTasks: () => ({ updateTaskByGroup: vi.fn() }) }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn() }));
vi.mock('@/components/molecules/Provenance/provenance', () => ({ isAgentWork: () => false }));
vi.mock('vue-router', () => ({ useRoute: () => ({ name: 'Project', params: {} }), useRouter: () => ({ push: vi.fn(), resolve: () => ({ href: '/t1' }) }) }));
vi.mock('@vuepic/vue-datepicker/dist/main.css', () => ({}));
vi.mock('@vuepic/vue-datepicker', () => ({
    default: defineComponent({ name: 'VueDatePicker', setup: (_, { slots }) => () => h('div', slots.trigger ? slots.trigger() : []) })
}));

import BoardCard from '@/views/Projects/Kanban/BoardViewDisplayCardComponent.vue';
import ConvertToSubTaskSidebar from '@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue';
import ConvertToList from '@/components/molecules/ConvertToList/ConvertToList.vue';
import { taskMenuItems, taskMenuRights } from '@/views/Projects/composables/taskMenu';
import { placeMenu } from '@/views/Projects/composables/menuPlacement';
import en from '@/locales/en.js';

const SRC = path.resolve(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const ruleBody = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
    return match ? match[2] : '';
};
const english = (key) => key.split('.').reduce((node, part) => node?.[part], en);

const LIVE_TASK_MENU = ['rename', 'subtask', 'copy-link', 'copy-key', 'new-tab', 'open', 'save-template',
    'convert-subtask', 'convert-list', 'move', 'duplicate', 'merge', 'archive', 'delete'];

const task = (overrides = {}) => ({
    _id: 't1', TaskName: 'Write the brief', TaskKey: 'QAS-16', ProjectID: 'p1', sprintId: 's1',
    sprintArray: { id: 's1', name: 'Sprint 1' }, statusKey: 1, isParentTask: true, subTasks: 0,
    AssigneeUserId: [], watchers: [], tagsArray: [], deletedStatusKey: 0, Task_Priority: 'HIGH',
    ...overrides
});
const project = (overrides = {}) => ({
    _id: 'p1', ProjectCode: 'QAS', ProjectName: 'QA Sandbox', isGlobalPermission: true, viewColumn: [], tagsArray: [],
    taskStatusData: [], taskTypeCounts: [], projectIcon: { type: 'color', data: 'teal' },
    sprintsObj: { s1: { id: 's1', name: 'Sprint 1' } }, sprintsfolders: {},
    ...overrides
});
const check = (permission) => (permission in perms.value ? perms.value[permission] : true);

const store = () => createStore({
    getters: {
        'settings/companyUsers': () => [],
        'settings/designations': () => [],
        'settings/companyOwnerDetail': () => ({ userId: 'owner' }),
        'settings/companyDateFormat': () => ({ dateFormat: 'DD/MM/YYYY' }),
        'settings/companyPriority': () => [],
        'users/myCounts': () => ({ data: {} }),
        'projectData/onlyActiveProjects': () => ({ data: [] }),
        'projectData/sprints': () => ({ p1: [] }),
        'projectData/folders': () => ({ p1: [] })
    }
});

function mountBoard({ data = task() } = {}) {
    const boardMenu = { rights: ref(taskMenuRights(check)), rename: vi.fn(), duplicate: vi.fn() };
    const wrapper = mount(BoardCard, {
        props: { data, groupValue: 0, isSubTask: false },
        attachTo: document.body,
        global: {
            plugins: [store()],
            provide: {
                showArchived: ref(false),
                toggleTaskDetail: vi.fn(),
                selectedProject: ref(project()),
                searchedTask: ref(false),
                taskCollapsed: ref(true),
                boardTaskMenu: boardMenu,
                $dateFormat: ref('DD/MM/YYYY')
            },
            stubs: {
                TaskMenuSidebars: true, Assignee: true, Priority: true, ProvenanceBadge: true, BoardViewTaskCreate: true,
                ConfirmationSidebar: true, TagChip: true, CreateTagPopup: true
            }
        }
    });
    return { wrapper, boardMenu };
}

const menu = () => document.body.querySelector('[role="menu"]');
const menuItems = () => [...document.body.querySelectorAll('[role="menu"] [role="menuitem"]')];
const press = (key) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

beforeEach(() => {
    perms.value = {};
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('the Board card menu', () => {
    it('is the themed popup of the List row, with all fourteen actions of an open task', async () => {
        const { wrapper } = mountBoard();
        expect(taskMenuItems(task(), taskMenuRights(check)).map((item) => item.id)).toEqual(LIVE_TASK_MENU);
        expect(menu()).toBe(null);
        await wrapper.find('.option-list__trigger').trigger('click');

        expect(menu().classList.contains('ah-pop')).toBe(true);
        expect(menuItems().map((item) => item.dataset.item)).toEqual(LIVE_TASK_MENU);
        expect(menuItems().every((item) => item.classList.contains('ah-pop__item'))).toBe(true);
        expect(menu().querySelectorAll('.ah-pop__sep[role="separator"]')).toHaveLength(2);
        expect(document.body.querySelector('.drop-down-menu, .drop-down-item, .bg-white')).toBe(null);
        wrapper.unmount();
    });

    it('names the menu and tells its button when it is open', async () => {
        const { wrapper } = mountBoard();
        const trigger = wrapper.find('.option-list__trigger');
        expect(trigger.attributes('aria-haspopup')).toBe('menu');
        expect(trigger.attributes('aria-expanded')).toBe('false');
        await trigger.trigger('click');
        expect(trigger.attributes('aria-expanded')).toBe('true');
        expect(menu().getAttribute('aria-label')).toBe('Projects.task_actions');
        wrapper.unmount();
    });

    it('reaches the last action from the keyboard and wraps round to the first', async () => {
        const { wrapper } = mountBoard();
        await wrapper.find('.option-list__trigger').trigger('click');
        await nextTick();
        expect(document.activeElement.dataset.item).toBe('rename');
        press('End');
        expect(document.activeElement.dataset.item).toBe('delete');
        press('ArrowDown');
        expect(document.activeElement.dataset.item).toBe('rename');
        press('ArrowUp');
        expect(document.activeElement.dataset.item).toBe('delete');
        wrapper.unmount();
    });

    it('closes on Escape and hands focus back to its button', async () => {
        const { wrapper } = mountBoard();
        await wrapper.find('.option-list__trigger').trigger('click');
        await nextTick();
        press('Escape');
        await nextTick();
        expect(menu()).toBe(null);
        expect(document.activeElement).toBe(wrapper.find('.option-list__trigger').element);
        wrapper.unmount();
    });

    it('opens upward when the card sits at the bottom of the window', async () => {
        const { wrapper } = mountBoard();
        const trigger = wrapper.find('.option-list__trigger');
        vi.spyOn(trigger.element, 'getBoundingClientRect').mockReturnValue({ top: 700, bottom: 724, left: 376, right: 400, width: 24, height: 24 });
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(413);
        vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
        await trigger.trigger('click');
        await nextTick();
        expect(menu().style.top).toBe('');
        expect(menu().style.bottom).toBe(`${window.innerHeight - 700 + 4}px`);
        wrapper.unmount();
    });

    it('runs the action that is picked and closes', async () => {
        const { wrapper } = mountBoard();
        await wrapper.find('.option-list__trigger').trigger('click');
        menu().querySelector('[data-item="merge"]').click();
        await nextTick();
        expect(menu()).toBe(null);
        expect(wrapper.findComponent({ name: 'TaskMenuSidebars' }).props('mode')).toBe('merge');
        wrapper.unmount();
    });

    it('takes its button away while the task is renamed, so nothing covers the input', async () => {
        const { wrapper } = mountBoard();
        await wrapper.find('.option-list__trigger').trigger('click');
        menu().querySelector('[data-item="rename"]').click();
        await nextTick();
        await nextTick();
        expect(wrapper.find('input.card-rename').exists()).toBe(true);
        expect(wrapper.find('.option-list').isVisible()).toBe(false);
        await wrapper.find('input.card-rename').trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('.option-list').isVisible()).toBe(true);
        wrapper.unmount();
    });
});

describe('where the task menu opens', () => {
    const viewport = { width: 1440, height: 900 };
    const size = { width: 200, height: 468 };

    it('below its button when the whole menu fits there', () => {
        expect(placeMenu({ top: 100, bottom: 124, right: 600 }, size, viewport)).toEqual({ top: '128px', right: '840px' });
    });

    it('above its button near the bottom edge', () => {
        expect(placeMenu({ top: 800, bottom: 824, right: 600 }, size, viewport)).toEqual({ bottom: '104px', right: '840px' });
    });

    it('against the bottom edge when neither side has room, so every item stays on screen', () => {
        expect(placeMenu({ top: 440, bottom: 464, right: 600 }, size, viewport)).toEqual({ top: '424px', right: '840px' });
    });

    it('from the top edge in a window shorter than the menu', () => {
        expect(placeMenu({ top: 100, bottom: 124, right: 300 }, size, { width: 700, height: 390 })).toEqual({ top: '8px', right: '400px' });
    });

    it('inside the left edge on a narrow screen', () => {
        expect(placeMenu({ top: 100, bottom: 124, right: 150 }, size, { width: 390, height: 900 })).toEqual({ top: '128px', left: '8px' });
    });

    it('scrolls within the window rather than at a fixed height', () => {
        const popup = withoutComments(read('views/Projects/components/taskMenu/TaskMenuPopup.vue'));
        const body = ruleBody(popup, '.task-menu');
        expect(body).toMatch(/max-height:\s*calc\(100dvh - 16px\)/);
        expect(body).toMatch(/overflow-y:\s*auto/);
        expect(body).not.toMatch(/max-height:\s*\d+px/);
    });
});

describe('the Board card due date', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 9, 1, 10, 0, 0));
    });

    it.each([
        ['a date further out as month and day', '2026-10-10T12:00:00', 'Oct 10'],
        ['a date this week as its weekday', '2026-10-07T12:00:00', 'Wed'],
        ['today by name', '2026-10-01T18:00:00', 'Home.today']
    ])('shows %s, as the List does', (_, DueDate, shown) => {
        const { wrapper } = mountBoard({ data: task({ DueDate }) });
        expect(wrapper.find('.date-picker').text()).toBe(shown);
        expect(wrapper.find('.date-picker button').attributes('aria-label')).toContain(shown);
        wrapper.unmount();
    });

    it('shows the same short date to someone who cannot change it', () => {
        perms.value = { 'task.task_due_date': false };
        const { wrapper } = mountBoard({ data: task({ DueDate: '2026-10-10T12:00:00' }) });
        expect(wrapper.find('.date-picker button').exists()).toBe(false);
        expect(wrapper.find('.date-picker').text()).toBe('Oct 10');
        wrapper.unmount();
    });

    it('keeps the full date in the tooltip', () => {
        const { wrapper } = mountBoard({ data: task({ DueDate: '2026-10-10T12:00:00' }) });
        expect(wrapper.find('.date-picker [title]').attributes('title')).toBe('10/10/2026');
        wrapper.unmount();
    });
});

describe('the subtask form under a Board card', () => {
    const form = read('views/Projects/Kanban/BoardViewTaskCreate.vue');
    const template = form.slice(0, form.indexOf('<script'));

    it('has one Save button, laid out in the row and not floated over the next one', () => {
        const saves = template.match(/<button[^>]*saveTask\(\)[^>]*>/g) || [];
        expect(saves).toHaveLength(1);
        expect(saves[0]).not.toMatch(/position-ab/);
        expect(template).not.toMatch(/ifsub__save/);
    });
});

describe('the project header with an agent at work', () => {
    const css = withoutComments(read('views/Projects/components/project-header.css'));
    const desktop = css.slice(0, css.indexOf('@media'));

    it('wraps its actions onto a second row instead of squeezing the title under them', () => {
        expect(ruleBody(desktop, '.ph2__bar')).toMatch(/flex-wrap:\s*wrap/);
        const actions = ruleBody(desktop, '.ph2__actions');
        expect(actions).toMatch(/flex-wrap:\s*wrap/);
        expect(actions).toMatch(/min-width:\s*0/);
        expect(actions).not.toMatch(/flex:\s*none/);
    });

    it('never lets the title block shrink below its content', () => {
        expect(ruleBody(css, '.ph2__title-slot')).toMatch(/flex:\s*none/);
    });

    it('drops the pill\'s time and spend first where the header also has + Task', () => {
        expect(css).toMatch(/@media \(max-width: 1599px\)\s*\{\s*\.ph2__actions:has\(> \.ah-btn--primary\) \.ph2__agents-meta\s*\{\s*display:\s*none/);
    });
});

describe('the Merge, Convert and Move sidebars', () => {
    const SidebarStub = {
        name: 'Sidebar',
        props: ['title', 'className'],
        template: '<div class="sb" :data-title="title" :class="className"><slot name="head-left" /><slot name="head-right" /><slot name="body" /></div>'
    };
    const mountSidebar = (mode) => mount(ConvertToSubTaskSidebar, {
        props: { closeSideBar: true, task: task(), ...mode },
        global: {
            plugins: [store()],
            provide: { selectedProject: ref(project()), toggleTaskDetail: vi.fn() },
            stubs: { Sidebar: SidebarStub, SideBarSprintFolderData: true, SpinnerComp: true, DuplicateCompo: true, WasabiImage: true, ConfirmationsInTask: true }
        }
    });

    it.each([
        ['Merge', { isMergeTask: true }, 'DuplicateTask.mearge_task_into'],
        ['Convert to subtask', { isOpenSubTask: true }, 'ProjectDetails.convert_subtask'],
        ['Move', { isMoveTask: true }, 'DuplicateTask.move_task'],
        ['Duplicate', { isDuplicate: true }, 'Projects.duplicate_task']
    ])('%s is named after what it does', async (_, mode, key) => {
        const wrapper = mountSidebar(mode);
        await flushPromises();
        expect(wrapper.find('.sb').attributes('data-title')).toBe(key);
        expect(typeof english(key)).toBe('string');
        expect(english(key)).not.toBe('Title');
        wrapper.unmount();
    });

    it('Convert to list is named too', async () => {
        const wrapper = mount(ConvertToList, {
            props: { openSidebar: true, task: task() },
            global: {
                plugins: [store()],
                provide: { selectedProject: ref(project({ sprintsfolders: { f1: { folderId: 'f1', name: 'Folder', sprintsObj: {} } } })) },
                stubs: { Sidebar: SidebarStub, SideBarSprintFolderData: true, ConfirmationSidebar: true }
            }
        });
        await flushPromises();
        expect(wrapper.find('.sb').attributes('data-title')).toBe('ProjectDetails.convert_list');
        expect(wrapper.find('.sb').classes()).toContain('converted__sidebar');
        wrapper.unmount();
    });

    it('names its search field and keeps it inside the card', async () => {
        const wrapper = mountSidebar({ isMergeTask: true });
        await flushPromises();
        expect(wrapper.find('input.input__Search').attributes('aria-label')).toBe('PlaceHolder.search');
        const css = withoutComments(read('components/molecules/ConvertToSubTaskSidebar/style.css'));
        expect(ruleBody(css, '.input__Search')).toMatch(/box-sizing:\s*border-box/);
        wrapper.unmount();
    });

    it('greys out an action that has no destination yet with a real disabled button', async () => {
        const wrapper = mountSidebar({ isMergeTask: true });
        await flushPromises();
        const actions = wrapper.findAll('.sb button').filter((button) => button.text().startsWith('ProjectDetails.'));
        expect(actions.map((button) => button.text())).toEqual(['ProjectDetails.merge', 'ProjectDetails.MERGE_AND_OPEN']);
        expect(actions.every((button) => button.attributes('disabled') !== undefined)).toBe(true);
        wrapper.unmount();
    });

    it('paints the panel, its head and its body from the theme', () => {
        const css = withoutComments(read('components/molecules/ConvertToSubTaskSidebar/theme.css'));
        expect(ruleBody(css, '.converted__sidebar .sidebar-content')).toMatch(/background:\s*var\(--surface\)/);
        expect(ruleBody(css, '.sidebar.converted__sidebar .sidebar-body')).toMatch(/background:\s*var\(--canvas\)/);
        expect(ruleBody(css, '.converted__sidebar .sbf__name')).toBe('');
        for (const file of ['ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue', 'ConvertToList/ConvertToList.vue']) {
            expect(read(`components/molecules/${file}`), file).toMatch(/<style src="[^"]*theme\.css"><\/style>/);
        }
    });
});

describe('the files this pass touched', () => {
    const FILES = [
        'views/Projects/Kanban/BoardViewDisplayCardComponent.vue',
        'views/Projects/Kanban/BoardViewTaskCreate.vue',
        'views/Projects/Kanban/new-style.css',
        'views/Projects/components/taskMenu/TaskMenuPopup.vue',
        'views/Projects/components/project-header.css',
        'components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue',
        'components/molecules/ConvertToSubTaskSidebar/style.css',
        'components/molecules/ConvertToSubTaskSidebar/theme.css',
        'components/molecules/ConvertToList/ConvertToList.vue',
        'components/molecules/ConvertToList/style.css',
        'components/organisms/SideBarSprintFolderData/SideBarSprintFolderData.vue',
        'components/organisms/SideBarSprintFolderData/style.css'
    ];

    it.each(FILES)('%s has no hex colour and no bg-white', (file) => {
        const source = read(file);
        expect(source.match(/#[0-9a-fA-F]{3,8}\b/g) || []).toEqual([]);
        expect(source).not.toMatch(/\bbg-white\b/);
    });

    it('the Board card and its form use no legacy colour class', () => {
        for (const file of FILES.slice(0, 2)) {
            const template = read(file).split('<script')[0];
            expect(template.match(/class="[^"]*\b(red|blue|gray81|black|btn-primary)\b[^"]*"/g) || [], file).toEqual([]);
        }
    });
});
