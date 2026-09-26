import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { createStore } from 'vuex';

const composable = vi.hoisted(() => {
    const users = { u1: { _id: 'u1', id: 'u1', Employee_Name: 'Ada Lovelace', Employee_profileImageURL: '' } };
    return {
        useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true, makeUniqueId: () => 'id', debounce: (fn) => fn }),
        useConvertDate: () => ({ convertDateFormat: (value) => (value ? '30 Sep 2026' : '') }),
        useGetterFunctions: () => ({
            getUser: (id) => users[id] || {},
            getTeam: () => ({}),
            getPriorities: () => [{ name: 'High', value: 'HIGH', statusImage: 'high.png' }]
        })
    };
});
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@/composable/commonFunction', () => ({ companyPrioritiesIcons: () => ({ statusImage: 'high.png' }), isBundledPriorityImage: () => true }));
vi.mock('@/composable/useTaskSelection.js', () => ({ useTaskSelection: () => ({ isSelected: () => false, selectFromEvent: vi.fn() }) }));
vi.mock('@/components/molecules/Home/useTimer', () => ({ useTimer: () => ({ timer: { active: null }, elapsedMs: { value: 0 }, isTracking: () => false }) }));
vi.mock('@/utils/assigneeOptions', () => ({ permittedAssignees: () => ['u1'], selfAssignable: () => ['u1'] }));
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));
vi.mock('@/views/Projects/helper', () => ({ useUpdateTasks: () => ({ updateTaskByGroup: vi.fn() }) }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn() }));
vi.mock('@/components/molecules/Provenance/provenance', () => ({ isAgentWork: () => false }));
vi.mock('vue-router', () => ({ useRoute: () => ({ name: 'Project', params: {} }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@vuepic/vue-datepicker/dist/main.css', () => ({}));

const openMenu = vi.fn();
vi.mock('@vuepic/vue-datepicker', () => ({
    default: defineComponent({
        name: 'VueDatePicker',
        setup(_, { slots, expose }) {
            expose({ openMenu, closeMenu: vi.fn() });
            // The library opens its menu when anything in the trigger slot is clicked.
            return () => h('div', { onClick: openMenu }, slots.trigger ? slots.trigger() : []);
        }
    })
}));

import BoardCard from '@/views/Projects/Kanban/BoardViewDisplayCardComponent.vue';
import CreateTagPopup from '@/components/molecules/TagList/CreateTagPopup.vue';
import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';

const TASK_NAME = 'Write the launch post';
const UNREAD_COMMENTS = 3;
const store = createStore({
    getters: {
        'settings/companyUsers': () => [{ userId: 'u1', isDelete: false }],
        'settings/designations': () => [],
        'settings/companyOwnerDetail': () => ({ userId: 'u1' }),
        'settings/companyDateFormat': () => ({ dateFormat: 'DD/MM/YYYY' }),
        'users/myCounts': () => ({ data: { task_p1_s1_t1_comments: UNREAD_COMMENTS } })
    }
});
const PickerSidebar = { name: 'Sidebar', props: ['visible'], template: '<div class="picker" :data-open="String(!!visible)"></div>' };
// Like the real DropDown, the menu opens when anything in its button slot is clicked.
const MenuDropDown = { name: 'DropDown', data: () => ({ open: false }), template: '<div class="menu" :data-open="String(open)" @click.stop.prevent="open = !open"><slot name="button" /></div>' };

const mountCard = ({ archived = false } = {}) => mount(BoardCard, {
    props: {
        data: { _id: 't1', TaskName: TASK_NAME, AssigneeUserId: ['u1'], DueDate: '2026-09-30', Task_Priority: 'HIGH', deletedStatusKey: 0, sprintId: 's1', tagsArray: [] },
        groupValue: 0,
        isSubTask: false
    },
    global: {
        plugins: [store],
        mocks: { $t: (key, params) => [key, ...Object.values(params || {})].join('|') },
        provide: {
            showArchived: ref(archived),
            toggleTaskDetail: vi.fn(),
            selectedProject: ref({ _id: 'p1', isGlobalPermission: true, viewColumn: [{ key: 'commentCounts', show: true }], tagsArray: [] }),
            searchedTask: ref(false),
            taskCollapsed: ref(true),
            $defaultTaskStatusImg: ref('default.png')
        },
        stubs: {
            Sidebar: PickerSidebar,
            UserProfile: true,
            WasabiImage: true,
            DropDown: true,
            DropDownOption: true,
            TagChip: true,
            CreateTagPopup: true,
            ProvenanceBadge: true,
            BoardViewTaskCreate: true,
            ConfirmationSidebar: true,
            ConvertToSubTaskSidebar: true,
            ConvertToList: true
        }
    }
});

const quickEdits = {
    assignee: {
        trigger: (wrapper) => wrapper.find('.card-assignee').find('button, [role="button"]'),
        opened: (wrapper) => wrapper.find('.card-assignee .picker').attributes('data-open') === 'true',
        value: 'Ada Lovelace'
    },
    'due date': {
        trigger: (wrapper) => wrapper.find('.date-picker').find('button, [role="button"]'),
        opened: () => openMenu.mock.calls.length > 0,
        value: '30 Sep 2026'
    },
    priority: {
        trigger: (wrapper) => wrapper.find('.priority__compo').find('button, [role="button"]'),
        opened: (wrapper) => wrapper.find('.priority__compo .picker').attributes('data-open') === 'true',
        value: 'High'
    }
};

const activations = {
    click: (el) => el.trigger('click'),
    Enter: (el) => el.trigger('keydown', { key: 'Enter' }),
    Space: (el) => el.trigger('keydown', { key: ' ' })
};

// jsdom does not synthesise the click a browser fires when Enter or Space reaches a <button>.
const pressOnButton = (key) => async (el) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    el.element.dispatchEvent(event);
    if (!event.defaultPrevented && el.element.tagName === 'BUTTON') el.element.click();
    await nextTick();
};
const nativeActivations = {
    click: (el) => el.trigger('click'),
    Enter: pressOnButton('Enter'),
    Space: pressOnButton(' ')
};

describe('board card controls', () => {
    it('names the select checkbox after its task', () => {
        const checkbox = mountCard().find('.kanban-card-multi-select input[type="checkbox"]');
        expect(checkbox.attributes('aria-label')).toContain(TASK_NAME);
    });

    describe.each(Object.entries(quickEdits))('the %s quick edit', (_, control) => {
        it('is a real button named with its current value', () => {
            const trigger = control.trigger(mountCard());
            expect(trigger.exists()).toBe(true);
            expect(trigger.element.tagName).toBe('BUTTON');
            expect(trigger.attributes('type')).toBe('button');
            expect(trigger.attributes('aria-label')).toContain(control.value);
        });

        it.each(Object.keys(activations))('opens its editor on %s', async (how) => {
            openMenu.mockClear();
            const wrapper = mountCard();
            expect(control.opened(wrapper)).toBe(false);
            await activations[how](control.trigger(wrapper));
            expect(control.opened(wrapper)).toBe(true);
        });
    });

    describe('the unread-comments shortcut', () => {
        const trigger = (wrapper) => wrapper.find('.board-task-comment-count');

        it('is a real button named with its count', () => {
            const button = trigger(mountCard());
            expect(button.element.tagName).toBe('BUTTON');
            expect(button.attributes('type')).toBe('button');
            expect(button.attributes('aria-label')).toBe(`Projects.unread_comments_open|${UNREAD_COMMENTS}`);
        });

        it.each(Object.keys(nativeActivations))('opens the task on its activity tab on %s', async (how) => {
            await nativeActivations[how](trigger(mountCard()));
            expect(openTask).toHaveBeenCalledTimes(1);
            expect(openTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 't1', tab: 'activity' }));
        });
    });

    it('offers no quick-edit buttons on an archived card', () => {
        const wrapper = mountCard({ archived: true });
        expect(wrapper.find('.card-assignee button').exists()).toBe(false);
        expect(wrapper.find('.priority__compo button').exists()).toBe(false);
        expect(wrapper.find('.date-picker button').exists()).toBe(false);
    });
});

describe('the tag picker trigger the board card renders', () => {
    const mountTagPopup = (buttonLabel) => mount(CreateTagPopup, {
        props: {
            task: { _id: 't1', TaskName: TASK_NAME, sprintId: 's1', tagsArray: [] },
            project: { _id: 'p1', isGlobalPermission: true, tagsArray: [] },
            isTaskList: false,
            buttonLabel
        },
        global: {
            stubs: { DropDown: MenuDropDown, TagChip: true, ConfirmationSidebar: true }
        }
    });
    const trigger = (wrapper) => wrapper.find('.menu').find('button, div');
    const opened = (wrapper) => wrapper.find('.menu').attributes('data-open') === 'true';

    it('is a real button named by the card', () => {
        const button = trigger(mountTagPopup('Add tag'));
        expect(button.element.tagName).toBe('BUTTON');
        expect(button.attributes('type')).toBe('button');
        expect(button.attributes('aria-label')).toBe('Add tag');
    });

    it.each(Object.keys(nativeActivations))('opens the tag menu on %s', async (how) => {
        const wrapper = mountTagPopup('Add tag');
        expect(opened(wrapper)).toBe(false);
        await nativeActivations[how](trigger(wrapper));
        expect(opened(wrapper)).toBe(true);
    });

    it('keeps its old markup where no label is passed', () => {
        expect(trigger(mountTagPopup(undefined)).element.tagName).toBe('DIV');
    });
});
