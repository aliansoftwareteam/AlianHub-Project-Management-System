import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { createStore } from 'vuex';

const access = vi.hoisted(() => ({ tagPermission: true, tagsApp: true }));
const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({
        checkPermission: (path) => (path === 'task.task_tag' ? access.tagPermission : true),
        checkApps: (app) => (app === 'tags' ? access.tagsApp : true),
        makeUniqueId: () => 'id',
        debounce: (fn) => fn
    }),
    useConvertDate: () => ({ convertDateFormat: () => '' }),
    useGetterFunctions: () => ({ getUser: () => ({}), getTeam: () => ({}), getPriorities: () => [] })
}));
const taskOperations = vi.hoisted(() => ({ updateTags: vi.fn(() => Promise.resolve()) }));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@/composable/commonFunction', () => ({ companyPrioritiesIcons: () => ({}), isBundledPriorityImage: () => true }));
vi.mock('@/composable/useTaskSelection.js', () => ({ useTaskSelection: () => ({ isSelected: () => false, selectFromEvent: vi.fn() }) }));
vi.mock('@/components/molecules/Home/useTimer', () => ({ useTimer: () => ({ timer: { active: null }, elapsedMs: { value: 0 }, isTracking: () => false }) }));
vi.mock('@/utils/assigneeOptions', () => ({ permittedAssignees: () => [], selfAssignable: () => [] }));
vi.mock('@/utils/TaskOperations', () => ({ default: taskOperations }));
vi.mock('@/views/Projects/helper', () => ({ useUpdateTasks: () => ({ updateTaskByGroup: vi.fn() }) }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn() }));
vi.mock('@/components/molecules/Provenance/provenance', () => ({ isAgentWork: () => false }));
vi.mock('vue-router', () => ({ useRoute: () => ({ name: 'Project', params: {} }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@vuepic/vue-datepicker/dist/main.css', () => ({}));
vi.mock('@vuepic/vue-datepicker', () => ({ default: defineComponent({ name: 'VueDatePicker', setup: () => () => h('div') }) }));

import BoardCard from '@/views/Projects/Kanban/BoardViewDisplayCardComponent.vue';
import { inkOf, worstContrast } from '../wcagContrast';

const tag = (uid, tagName, colour = '#1f7a4d') => ({ uid, tagName, tagColor: colour, tagBgColor: `${colour}35` });
const PROJECT_TAGS = [
    tag('tag-ux', 'UX'),
    tag('tag-api', 'api'),
    tag('tag-bug', 'Bug'),
    tag('tag-docs', 'Docs'),
    tag('tag-perf', 'Perf'),
    tag('tag-qa', 'QA'),
    tag('tag-unused', 'Unused'),
    tag('tag-navy', 'Navy', '#2f3990'),
    tag('tag-lemon', 'Lemon', '#ffff00')
];

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

const mountCard = ({ tagsArray = [], archived = false, points = null, cardFields = [], customField = {} } = {}) => mount(BoardCard, {
    props: {
        data: { _id: 't1', TaskName: 'Tag the release notes', AssigneeUserId: [], Task_Priority: 'HIGH', deletedStatusKey: 0, sprintId: 's1', tagsArray, points, customField },
        groupValue: 0,
        isSubTask: false
    },
    global: {
        plugins: [store],
        provide: {
            showArchived: ref(archived),
            toggleTaskDetail: vi.fn(),
            selectedProject: ref({ _id: 'p1', isGlobalPermission: true, viewColumn: [], tagsArray: PROJECT_TAGS }),
            searchedTask: ref(false),
            taskCollapsed: ref(true),
            boardCardFields: ref(cardFields),
            $dateFormat: ref('DD/MM/YYYY')
        },
        stubs: {
            DropDown: ButtonOnlyDropDown,
            DropDownOption: true,
            Assignee: true,
            Priority: true,
            DueDateCompo: true,
            ProvenanceBadge: true,
            BoardViewTaskCreate: true,
            ConfirmationSidebar: true,
            ConvertToSubTaskSidebar: true,
            ConvertToList: true,
            InputText: true,
            SpinnerComp: true
        }
    }
});

const mountSettled = async (options) => {
    const wrapper = mountCard(options);
    await flushPromises();
    return wrapper;
};
const tagRow = (wrapper) => wrapper.find('.card-tags');
const chipNames = (wrapper) => wrapper.findAll('.tagname').map((chip) => chip.text());
const addTagButton = (wrapper) => wrapper.find('button[aria-label="Tags.add_tag"]');

describe('board card tags', () => {
    beforeEach(() => {
        access.tagPermission = true;
        access.tagsApp = true;
    });

    it("shows the task's tags as chips without opening the tag picker", async () => {
        const wrapper = await mountSettled({ tagsArray: ['tag-ux', 'tag-api'] });
        expect(chipNames(wrapper)).toEqual(['api', 'UX']);
        expect(tagRow(wrapper).exists()).toBe(true);
    });

    it('shows the first tag added elsewhere, such as in the task panel', async () => {
        const wrapper = await mountSettled({ tagsArray: [] });
        await wrapper.setProps({ data: { ...wrapper.props('data'), tagsArray: ['tag-ux'] } });
        await flushPromises();
        expect(chipNames(wrapper)).toEqual(['UX']);
    });

    it('shows four chips and counts the rest', async () => {
        const wrapper = await mountSettled({ tagsArray: ['tag-ux', 'tag-api', 'tag-bug', 'tag-docs', 'tag-perf', 'tag-qa'] });
        expect(chipNames(wrapper)).toEqual(['api', 'Bug', 'Docs', 'Perf']);
        expect(wrapper.find('.tagcount').text()).toBe('+2');
    });

    it('offers the add-tag button beside the chips to a member who may tag', async () => {
        const button = addTagButton(await mountSettled({ tagsArray: ['tag-ux'] }));
        expect(button.exists()).toBe(true);
        expect(button.isVisible()).toBe(true);
    });

    it('shows the chips but no add-tag button to a view-only member', async () => {
        access.tagPermission = false;
        const wrapper = await mountSettled({ tagsArray: ['tag-ux'] });
        expect(chipNames(wrapper)).toEqual(['UX']);
        const button = addTagButton(wrapper);
        expect(button.exists() && button.isVisible()).toBe(false);
    });

    it('keeps every chip name readable on its tint in both themes', async () => {
        const wrapper = await mountSettled({ tagsArray: ['tag-navy', 'tag-lemon'] });
        const chips = wrapper.findAll('.card-tags .tagListContent');
        expect(chips.map((chip) => chip.text())).toEqual(['Lemon', 'Navy']);
        for (const chip of chips) {
            const style = chip.element.style;
            expect(chip.classes()).toContain('ah-status-ink');
            expect(worstContrast(inkOf(style), style.background, 'light'), chip.text()).toBeGreaterThanOrEqual(4.5);
            expect(worstContrast(style.getPropertyValue('--status-ink-dark'), style.background, 'dark'), chip.text()).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('removes a tag from this task with its chip', async () => {
        const wrapper = await mountSettled({ tagsArray: ['tag-ux', 'tag-api'] });
        await wrapper.find('.tagHover__icon-close').trigger('click');
        expect(taskOperations.updateTags).toHaveBeenCalledWith(expect.objectContaining({
            companyId: 'company-1',
            projectId: 'p1',
            sprintId: 's1',
            taskId: 't1',
            tagsArray: ['tag-ux', 'tag-api'],
            tagId: 'tag-api',
            operation: 'remove'
        }));
    });

    it.each([
        ['has no tags', { tagsArray: [] }, () => {}],
        ['is on a project with the Tags app off', { tagsArray: ['tag-ux'] }, () => { access.tagsApp = false; }],
        ['is seen by a member without tag access', { tagsArray: ['tag-ux'] }, () => { access.tagPermission = null; }],
        ['is shown in the archive', { tagsArray: ['tag-ux'], archived: true }, () => {}]
    ])('renders no tag row when the task %s', async (_, options, arrange) => {
        arrange();
        const wrapper = await mountSettled(options);
        expect(tagRow(wrapper).exists()).toBe(false);
        expect(wrapper.find('.tagname').exists()).toBe(false);
        expect(addTagButton(wrapper).exists()).toBe(false);
    });
});

describe('board card story points (task 042 slice 5)', () => {
    it('show only once Points is ticked in the card fields', async () => {
        expect((await mountSettled({ points: 5 })).find('.card-points').exists()).toBe(false);
        const shown = await mountSettled({ points: 5, cardFields: [{ id: 'points' }] });
        expect(shown.get('.card-points').text()).toBe('ViewColumns.points_total');
    });

    it('a task without points shows no chip', async () => {
        expect((await mountSettled({ cardFields: [{ id: 'points' }] })).find('.card-points').exists()).toBe(false);
    });
});

describe('board card custom fields (task 044 slice 1)', () => {
    const FIELD = {
        customer: { _id: 'f-text', fieldType: 'text', fieldTitle: 'Customer' },
        seats: { _id: 'f-num', fieldType: 'number', fieldTitle: 'Seats' },
        golive: { _id: 'f-date', fieldType: 'date', fieldTitle: 'Go live' },
        signed: { _id: 'f-check', fieldType: 'checkbox', fieldTitle: 'Signed' },
        tier: {
            _id: 'f-drop', fieldType: 'dropdown', fieldTitle: 'Tier',
            fieldOptions: [{ id: 1, label: 'Gold', color: '#ffff00' }, { id: 2, label: 'Navy', color: '#2f3990' }]
        }
    };
    const column = (field) => ({ id: `cf:${field._id}`, label: field.fieldTitle, field, visible: true });
    const entry = (fieldValue) => ({ fieldValue });
    const shown = (wrapper) => wrapper.findAll('.card-field').map((row) => [row.get('.card-field__name').text(), row.get('.card-field__value').text()]);

    it('shows the chosen fields that have a value, in the chosen order, next to points', async () => {
        const wrapper = await mountSettled({
            points: 3,
            cardFields: [column(FIELD.seats), { id: 'points' }, column(FIELD.customer), column(FIELD.golive)],
            customField: { 'f-text': entry('Acme'), 'f-num': entry('12'), 'f-date': entry('2026-10-05T12:00:00.000Z') }
        });
        expect(shown(wrapper)).toEqual([['Seats', '12'], ['Customer', 'Acme'], ['Go live', '05/10/2026']]);
        expect(wrapper.find('.card-points').exists()).toBe(true);
    });

    it('leaves out a field the view does not show', async () => {
        const wrapper = await mountSettled({ cardFields: [column(FIELD.customer)], customField: { 'f-text': entry('Acme'), 'f-num': entry('12') } });
        expect(shown(wrapper)).toEqual([['Customer', 'Acme']]);
    });

    it('gives an empty value no space, and renders nothing when every value is empty', async () => {
        const some = await mountSettled({
            cardFields: [column(FIELD.customer), column(FIELD.seats), column(FIELD.signed), column(FIELD.tier)],
            customField: { 'f-text': entry('Acme'), 'f-num': entry(''), 'f-check': entry(false), 'f-drop': entry([]) }
        });
        expect(shown(some)).toEqual([['Customer', 'Acme']]);

        const none = await mountSettled({ cardFields: [column(FIELD.customer), column(FIELD.seats)], customField: {} });
        expect(none.find('.card-fields').exists()).toBe(false);
    });

    it('is read-only: no inputs, buttons or edit targets among the values', async () => {
        const wrapper = await mountSettled({
            cardFields: [column(FIELD.customer), column(FIELD.signed), column(FIELD.tier)],
            customField: { 'f-text': entry('Acme'), 'f-check': entry(true), 'f-drop': entry([1]) }
        });
        const block = wrapper.get('.card-fields');
        expect(block.findAll('input, button, select, [contenteditable], [data-cell-edit]')).toHaveLength(0);
        expect(shown(wrapper)).toEqual([['Customer', 'Acme'], ['Signed', '✓'], ['Tier', 'Gold']]);
    });

    it('keeps a dropdown choice readable on its tint in both themes', async () => {
        const wrapper = await mountSettled({ cardFields: [column(FIELD.tier)], customField: { 'f-drop': entry([1, 2]) } });
        const chips = wrapper.findAll('.card-field__chip');
        expect(chips.map((chip) => chip.text())).toEqual(['Gold', 'Navy']);
        for (const chip of chips) {
            const style = chip.element.style;
            expect(chip.classes()).toContain('ah-status-ink');
            expect(worstContrast(inkOf(style), style.background, 'light'), chip.text()).toBeGreaterThanOrEqual(4.5);
            expect(worstContrast(style.getPropertyValue('--status-ink-dark'), style.background, 'dark'), chip.text()).toBeGreaterThanOrEqual(4.5);
        }
    });
});
