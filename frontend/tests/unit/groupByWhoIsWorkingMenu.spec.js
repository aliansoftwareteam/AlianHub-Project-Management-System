/* Task 047, T-4: "Who is working" in the Group by menu of a project. The project page provides the selected project
   to its children and so cannot inject it itself: the options it builds have to name the project. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { createStore } from 'vuex';

const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({
        checkPermission: () => true,
        // Like the real one outside a provider: only a project that is passed in can be checked.
        checkApps: (app, project) => Boolean(project?.apps?.some((x) => x.key === app)),
        makeUniqueId: () => 'id',
        debounce: (fn) => fn
    })
}));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);
vi.mock('@/composable/aiAvailability', () => ({ aiUsable: false, canUseAi: () => false }));
vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: {} })) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ name: 'Project', params: {} }), useRouter: () => ({ push: vi.fn() }) }));

import { useGroupByOptions } from '@/views/Projects/composables/groupByOptions';
import ProjectFiltersToolbar from '@/views/Projects/components/ProjectFiltersToolbar.vue';
import { AGENT_WORK_GROUP } from '@viewSettings';

const STAGE = '6f00000000000000000000a1';
const DEFS = [{ _id: STAGE, fieldTitle: 'Stage', fieldType: 'dropdown', type: 'task', isDelete: true, global: true }];

const store = () => createStore({
    modules: {
        settings: {
            namespaced: true,
            getters: {
                finalCustomFields: () => DEFS,
                selectedCompany: () => ({ planFeature: { customFields: true } })
            }
        }
    }
});

const optionsFor = (project) => {
    let found;
    const Page = defineComponent({
        setup() {
            found = useGroupByOptions(ref(project));
            return () => h('div');
        }
    });
    mount(Page, { global: { plugins: [store()] } });
    return found;
};

describe('the Group by options of the project page', () => {
    it('offer "who is working" for a project that is handed in, whatever apps it has switched on', () => {
        const plain = optionsFor({ _id: 'p1', apps: [] });
        expect(plain.options.value.map((option) => option.id)).toEqual([0, 1, 2, 3, AGENT_WORK_GROUP]);
        expect(plain.options.value.find((option) => option.id === AGENT_WORK_GROUP)).toMatchObject({ title: 'AgentWork.group', icon: 'ai' });
    });

    it('keep the custom fields of a project with that app beside it', () => {
        const { options } = optionsFor({ _id: 'p1', apps: [{ key: 'CustomFields' }] });
        expect(options.value.map((option) => option.id)).toEqual([0, 1, 2, 3, AGENT_WORK_GROUP, `cf:${STAGE}`]);
    });

    it('show the grouping a view was saved with, and status for one that is no longer offered', () => {
        const { shown } = optionsFor({ _id: 'p1', apps: [] });
        expect(shown(AGENT_WORK_GROUP)).toBe(AGENT_WORK_GROUP);
        expect(shown(`cf:${STAGE}`)).toBe(0);
    });
});

describe('the Group by menu', () => {
    let wrapper;
    const OPTIONS = [{ id: 0, label: 'status', image: 'status.svg' }, { id: AGENT_WORK_GROUP, title: 'AgentWork.group', icon: 'ai' }];
    const OpenDropDown = { name: 'DropDown', template: '<div><slot name="button" :triggerAttrs="{}" /><slot name="options" /></div>' };
    const Option = { name: 'DropDownOption', props: ['selected'], template: '<div class="option" :data-selected="String(Boolean(selected))"><slot /></div>' };
    const ShellIcon = { name: 'ShellIcon', props: ['name'], template: '<i class="shell-icon" :data-name="name"></i>' };

    const mountToolbar = async (props = {}) => {
        document.body.innerHTML = '<div id="my-dropdown"></div><div id="app"></div>';
        wrapper = mount(ProjectFiltersToolbar, {
            props: { activeTab: 'ProjectListView', projectData: { _id: 'p1', isGlobalPermission: true }, clientWidth: 1280, groupBy: 0, groupByOptions: OPTIONS, userId: 'me', ...props },
            global: {
                stubs: {
                    DropDown: OpenDropDown, DropDownOption: Option, ShellIcon, Assignee: true, TaskFilter: true, ProvenanceFilter: true, MonthlyCalendarMilestone: true, BurndownModal: true,
                    RecentVisitsDropdown: true, EpicsPanel: true, ExportTasksDropdown: true, PagesPanel: true, PublicShareModal: true, ImportDialog: true, AutoArchiveModal: true,
                    EstimationScaleModal: true, Toggle: true
                }
            },
            attachTo: '#app'
        });
        await flushPromises();
        return wrapper;
    };
    const option = () => wrapper.findAll('.option').find((el) => el.text().includes('AgentWork.group'));
    afterEach(() => wrapper?.unmount());

    it.each(['ProjectListView', 'TableView', 'ProjectKanban'])('names the grouping in %s, with its icon, and asks for it when picked', async (activeTab) => {
        await mountToolbar({ activeTab });
        expect(option().find('.shell-icon').attributes('data-name')).toBe('ai');
        await option().trigger('click');
        expect(wrapper.emitted('update:groupBy')).toEqual([[AGENT_WORK_GROUP]]);
    });

    it('shows the grouping as the one in use', async () => {
        await mountToolbar({ groupBy: AGENT_WORK_GROUP });
        expect(wrapper.find('.pft__group-label').text()).toBe('AgentWork.group');
        expect(option().attributes('data-selected')).toBe('true');
    });
});
