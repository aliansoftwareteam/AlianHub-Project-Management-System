/* Task 047, T-4: the Board card carries the same mark as a List row for a task a connected agent holds, and the
   toolbar offers "an agent is working on it" beside the other filters. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { createStore } from 'vuex';

const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true, makeUniqueId: () => 'id', debounce: (fn) => fn }),
    useConvertDate: () => ({ convertDateFormat: () => '' }),
    useGetterFunctions: () => ({ getUser: () => ({}), getTeam: () => ({}), getPriorities: () => [] })
}));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@/composable/commonFunction', () => ({ companyPrioritiesIcons: () => ({}), isBundledPriorityImage: () => true }));
vi.mock('@/composable/useTaskSelection.js', () => ({ useTaskSelection: () => ({ isSelected: () => false, selectFromEvent: vi.fn() }) }));
vi.mock('@/composable/aiAvailability', () => ({ aiUsable: false, canUseAi: () => false }));
vi.mock('@/components/molecules/Home/useTimer', () => ({ useTimer: () => ({ timer: { active: null }, elapsedMs: { value: 0 }, isTracking: () => false }) }));
vi.mock('@/utils/assigneeOptions', () => ({ permittedAssignees: () => [], selfAssignable: () => [] }));
vi.mock('@/utils/TaskOperations', () => ({ default: { updateTags: vi.fn(() => Promise.resolve()) } }));
vi.mock('@/views/Projects/helper', () => ({ useUpdateTasks: () => ({ updateTaskByGroup: vi.fn() }) }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn() }));
vi.mock('@/components/molecules/Provenance/provenance', () => ({ isAgentWork: () => false }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: {} })) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ name: 'Project', params: {} }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@vuepic/vue-datepicker/dist/main.css', () => ({}));
vi.mock('@vuepic/vue-datepicker', () => ({ default: defineComponent({ name: 'VueDatePicker', setup: () => () => h('div') }) }));

import BoardCard from '@/views/Projects/Kanban/BoardViewDisplayCardComponent.vue';
import ProjectFiltersToolbar from '@/views/Projects/components/ProjectFiltersToolbar.vue';
import { heldTasks, openRuns } from '@/views/Ai/agentFeed';

const SINCE = '2026-10-02T08:42:00.000Z';
const CLAIM = { taskId: 't1', projectId: 'p1', name: 'Claude, for Priya', since: SINCE };
const RUN = { _id: 'r1', agentId: 'a1', agentName: 'Reviewer', status: 'running', taskId: 't1', projectId: 'p1', startedAt: SINCE };

const store = createStore({
    getters: {
        'settings/companyUsers': () => [],
        'settings/designations': () => [],
        'settings/companyOwnerDetail': () => ({ userId: 'u1' }),
        'settings/companyDateFormat': () => ({ dateFormat: 'DD/MM/YYYY' }),
        'users/myCounts': () => ({ data: {} })
    }
});
const ButtonOnlyDropDown = { name: 'DropDown', template: '<div><slot name="button" /></div>' };

const mountCard = async (props = {}) => {
    const wrapper = mount(BoardCard, {
        props: {
            data: { _id: 't1', TaskName: 'Write the release notes', AssigneeUserId: [], Task_Priority: 'HIGH', deletedStatusKey: 0, sprintId: 's1', tagsArray: [], customField: {} },
            groupValue: 0,
            isSubTask: false,
            ...props
        },
        global: {
            plugins: [store],
            provide: {
                showArchived: ref(false),
                toggleTaskDetail: vi.fn(),
                selectedProject: ref({ _id: 'p1', isGlobalPermission: true, viewColumn: [], tagsArray: [] }),
                searchedTask: ref(false),
                taskCollapsed: ref(true),
                boardCardFields: ref([]),
                $dateFormat: ref('DD/MM/YYYY')
            },
            stubs: {
                DropDown: ButtonOnlyDropDown, DropDownOption: true, Assignee: true, Priority: true, DueDateCompo: true, ProvenanceBadge: true, BoardViewTaskCreate: true,
                ConfirmationSidebar: true, ConvertToSubTaskSidebar: true, ConvertToList: true, InputText: true, SpinnerComp: true
            }
        }
    });
    await flushPromises();
    return wrapper;
};

const mark = (wrapper) => wrapper.find('[data-test="agent-mark"]');

beforeEach(() => {
    heldTasks.value = [];
    openRuns.value = [];
});

describe('the mark on a Board card', () => {
    it('names the connected agent that holds the task, for whom, and since when', async () => {
        heldTasks.value = [CLAIM];
        const shown = mark(await mountCard());
        expect(shown.exists()).toBe(true);
        expect(shown.text()).toContain('Claude, for Priya');
        expect(shown.attributes('role')).toBe('img');
        expect(shown.attributes('aria-label')).toContain('AgentWork.mark_label');
    });

    it('leaves an in-product run to the strip the card already shows, once', async () => {
        openRuns.value = [RUN];
        const wrapper = await mountCard({ agentRun: RUN });
        expect(wrapper.find('.agent-strip__name').text()).toContain('Reviewer');
        expect(mark(wrapper).exists()).toBe(false);
    });

    it('is absent from a card the server sent no word about', async () => {
        heldTasks.value = [{ ...CLAIM, taskId: 'hidden-task' }];
        expect(mark(await mountCard()).exists()).toBe(false);
    });
});

describe('the toolbar filter', () => {
    let wrapper;
    const mountToolbar = async (props = {}) => {
        document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
        wrapper = mount(ProjectFiltersToolbar, {
            props: { activeTab: 'ProjectListView', projectData: { _id: 'p1', isGlobalPermission: true }, clientWidth: 1280, groupBy: 0, groupByOptions: [{ id: 0, label: 'status', image: 'status.svg' }], userId: 'me', ...props },
            global: {
                stubs: {
                    ShellIcon: true, Assignee: true, TaskFilter: true, ProvenanceFilter: true, MonthlyCalendarMilestone: true, BurndownModal: true, RecentVisitsDropdown: true, EpicsPanel: true,
                    ExportTasksDropdown: true, PagesPanel: true, PublicShareModal: true, ImportDialog: true, AutoArchiveModal: true, EstimationScaleModal: true, Toggle: true
                }
            },
            attachTo: '#app'
        });
        await flushPromises();
        return wrapper;
    };
    const button = () => wrapper.find('[data-test="agent-work-filter"]');
    afterEach(() => wrapper?.unmount());

    it.each(['ProjectListView', 'TableView', 'ProjectKanban'])('is a named switch in %s that asks for the filter', async (activeTab) => {
        await mountToolbar({ activeTab });
        expect(button().text()).toContain('AgentWork.filter');
        expect(button().attributes('aria-pressed')).toBe('false');
        await button().trigger('click');
        expect(wrapper.emitted('update:agentWorking')).toEqual([[true]]);
    });

    it('reads as pressed while on', async () => {
        await mountToolbar({ agentWorking: true });
        expect(button().attributes('aria-pressed')).toBe('true');
        expect(button().classes()).toContain('is-active');
    });

    it('counts among the active filters on a phone', async () => {
        await mountToolbar({ agentWorking: true, clientWidth: 390 });
        expect(wrapper.find('[data-test="filters-button"] .pft__filters-count').text()).toBe('1');
    });

    it('is not offered while the archive is shown', async () => {
        await mountToolbar({ showArchived: true });
        expect(button().exists()).toBe(false);
    });
});
