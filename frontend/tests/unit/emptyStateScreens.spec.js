import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { createStore } from 'vuex';

const { apiRequest, perms, push, people, reportRows } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    perms: {},
    push: vi.fn(() => Promise.resolve()),
    people: { list: [] },
    reportRows: { list: [] }
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: (key) => (key in perms ? perms[key] : true) }),
    useGetterFunctions: () => ({ getUser: () => ({ id: 'user-1', Employee_Name: 'Mia' }) })
}));
vi.mock('vue-router', () => ({
    useRouter: () => ({ push, hasRoute: () => true }),
    useRoute: () => ({ params: { cid: 'company-1' }, query: {} })
}));
vi.mock('@/views/Settings/Members/helperMember.js', () => ({ memberData: () => ({ getCompanyUsers: () => people.list }) }));
vi.mock('@/components/molecules/TaskTemplates/taskTemplates', () => ({
    listTemplates: vi.fn(async () => []),
    deleteTemplate: vi.fn(),
    renameTemplate: vi.fn(),
    errorText: () => ''
}));

import MyWorkCard from '@/components/molecules/Home/MyWorkCard.vue';
import TrashPage from '@/views/Trash/TrashPage.vue';
import Teams from '@/views/Settings/Teams/Teams.vue';
import TaskTemplates from '@/views/Settings/TaskTemplates/TaskTemplates.vue';
import CustomReports from '@/views/CustomReports/CustomReports.vue';
import PeopleDirectory from '@/views/People/PeopleDirectory.vue';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(HERE, '../../src', rel), 'utf8');

const store = ({ roleType = 1, teams = [] } = {}) => createStore({
    modules: {
        settings: {
            namespaced: true,
            getters: {
                companyUsers: () => [],
                teams: () => teams,
                roles: () => [],
                designations: () => [],
                projectSkills: () => [],
                selectedCompany: () => ({ planFeature: { team: true } }),
                companyUserDetail: () => ({ roleType })
            },
            mutations: { mutateTeams: () => {} }
        },
        projectData: { namespaced: true, getters: { allProjects: () => ({ data: [] }), onlyActiveProjects: () => ({ data: [] }) } },
        brandSettingTab: { namespaced: true, getters: { brandSettings: () => ({}) } }
    }
});

const mounted = [];
const open = async (component, options = {}) => {
    const wrapper = mount(component, {
        attachTo: document.body,
        props: options.props,
        global: {
            plugins: [store(options.session)],
            stubs: { ShellIcon: true, ReportsTabs: true, ApexChart: true, Assignee: true, UpgradePlan: true, TaskRow: true, RouterLink: true, ...(options.stubs || {}) }
        }
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};

const empty = (wrapper, name) => wrapper.find(`[data-test="${name}"]`);
const action = (wrapper, name) => empty(wrapper, name).find('.empty-state__btn');
const art = (wrapper, name) => empty(wrapper, name).find('svg').attributes('data-illustration');

beforeEach(() => {
    Object.keys(perms).forEach((key) => delete perms[key]);
    people.list = [];
    reportRows.list = [];
    push.mockClear();
    apiRequest.mockReset();
    apiRequest.mockImplementation(async (method, url) => {
        if (method === 'post' && String(url).endsWith('/run')) return { data: { status: true, data: { result: reportRows.list, unit: 'count' } } };
        return { data: { status: true, data: [] } };
    });
});

afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    document.body.innerHTML = '';
});

describe('My work on Home', () => {
    const work = () => ({
        loading: ref(false),
        loaded: ref(true),
        groups: ref({ today: [], overdue: [], next: [], unscheduled: [] }),
        sortBy: ref('priority'),
        done: ref([]),
        doneLoaded: ref(true),
        delegated: ref([]),
        projectOf: () => null,
        setSort: () => {},
        fetchDone: () => Promise.resolve()
    });

    it('offers to add a task when nothing is due today, and puts the cursor in the add field', async () => {
        const wrapper = await open(MyWorkCard, { props: { work: work() } });
        expect(art(wrapper, 'mywork-empty-today')).toBe('tasks');
        expect(empty(wrapper, 'mywork-empty-today').find('h2').text()).toBe('Home.empty_today_title');
        expect(action(wrapper, 'mywork-empty-today').text()).toBe('Home.empty_today_action');
        await action(wrapper, 'mywork-empty-today').trigger('click');
        expect(document.activeElement).toBe(wrapper.find('.hc-add input').element);
    });

    it('explains Done and Delegated without an action, since nothing there is created by hand', async () => {
        const wrapper = await open(MyWorkCard, { props: { work: work() } });
        const tabs = wrapper.findAll('.hc-tab');
        await tabs[1].trigger('click');
        expect(empty(wrapper, 'mywork-empty-done').text()).toContain('Home.empty_done');
        expect(empty(wrapper, 'mywork-empty-done').find('button').exists()).toBe(false);
        await tabs[2].trigger('click');
        expect(art(wrapper, 'mywork-empty-delegated')).toBe('people');
        expect(empty(wrapper, 'mywork-empty-delegated').find('button').exists()).toBe(false);
    });
});

describe('Trash', () => {
    it('says what lands there and offers nothing to do', async () => {
        const wrapper = await open(TrashPage);
        expect(empty(wrapper, 'trash-empty').find('h2').text()).toBe('Trash.empty_title');
        expect(empty(wrapper, 'trash-empty').find('svg').attributes('aria-hidden')).toBe('true');
        expect(empty(wrapper, 'trash-empty').find('button').exists()).toBe(false);
    });
});

describe('Teams in Settings', () => {
    it('explains teams with the people illustration and points at the + Team control', async () => {
        const wrapper = await open(Teams);
        expect(art(wrapper, 'teams-empty')).toBe('people');
        expect(empty(wrapper, 'teams-empty').text()).toContain('Settings.teams_empty_title');
        expect(empty(wrapper, 'teams-empty').text()).toContain('Settings.teams_empty');
        expect(empty(wrapper, 'teams-empty').find('button').exists()).toBe(false);
    });
});

describe('Task templates in Settings', () => {
    it('shows the empty state once the list has loaded empty', async () => {
        const wrapper = await open(TaskTemplates);
        expect(art(wrapper, 'task-templates-empty')).toBe('tasks');
        expect(empty(wrapper, 'task-templates-empty').find('h3').text()).toBe('TaskTemplates.settings_empty');
    });
});

describe('Custom reports', () => {
    it('offers Clear filters only when a filter is what emptied the report', async () => {
        const wrapper = await open(CustomReports);
        expect(art(wrapper, 'report-empty')).toBe('search');
        expect(action(wrapper, 'report-empty').exists()).toBe(false);

        wrapper.vm.$.setupState.cfg.filters.projectId = 'p1';
        await flushPromises();
        expect(action(wrapper, 'report-empty').text()).toBe('Reports.clear_filters');

        const runs = () => apiRequest.mock.calls.filter(([method, url]) => method === 'post' && String(url).endsWith('/run')).length;
        const before = runs();
        await action(wrapper, 'report-empty').trigger('click');
        await flushPromises();
        expect(wrapper.vm.$.setupState.cfg.filters).toEqual({});
        expect(runs()).toBe(before + 1);
        expect(action(wrapper, 'report-empty').exists()).toBe(false);
    });
});

describe('People', () => {
    const PERSON = { userId: 'user-1', Employee_Name: 'Asha Rao', status: 2, roleType: 1, isDelete: false };

    it('offers the invite to someone who may invite, and takes them to Members', async () => {
        const wrapper = await open(PeopleDirectory);
        expect(art(wrapper, 'people-empty')).toBe('people');
        expect(action(wrapper, 'people-empty').text()).toBe('Members.invite');
        await action(wrapper, 'people-empty').trigger('click');
        expect(push).toHaveBeenCalledWith({ name: 'Members', params: { cid: 'company-1' } });
    });

    it('hides the invite from someone who may not', async () => {
        perms['settings.settings_invite_member'] = false;
        const wrapper = await open(PeopleDirectory);
        expect(empty(wrapper, 'people-empty').exists()).toBe(true);
        expect(action(wrapper, 'people-empty').exists()).toBe(false);
    });

    it('offers to clear a search that matches nobody', async () => {
        people.list = [PERSON];
        const wrapper = await open(PeopleDirectory);
        expect(empty(wrapper, 'people-empty').exists()).toBe(false);
        await wrapper.find('.pd__search-input').setValue('nobody has this skill');
        expect(art(wrapper, 'people-no-match')).toBe('search');
        expect(action(wrapper, 'people-no-match').text()).toBe('Members.clear_search');
        await action(wrapper, 'people-no-match').trigger('click');
        expect(empty(wrapper, 'people-no-match').exists()).toBe(false);
        expect(wrapper.find('.pd__search-input').element.value).toBe('');
    });
});

describe('screens whose empty state is checked in their source', () => {
    it('the My timesheet week offers Log time', () => {
        const block = /<EmptyState[^>]*data-test="time-empty"[^>]*\/>/s.exec(read('views/Timesheet/UserTimeSheet/UserTimesheet.vue'))[0];
        expect(block).toContain('illustration="time"');
        expect(block).toContain(':action-label="$t(\'Time.log_time\')"');
        expect(block).toContain('@action="openLog()"');
    });

    it('the project List draws the no-results picture for a filtered list and keeps its own action', () => {
        const block = /<EmptyState\s+v-else-if="project\?\.deletedStatusKey !== 2"[^>]*\/>/s.exec(read('views/Projects/ListView/ListView.vue'))[0];
        expect(block).toContain(':illustration="emptyTitleKey === \'EmptyState.no_match_title\' ? \'search\' : \'tasks\'"');
        expect(block).toContain(':actionLabel="emptyActionLabel"');
        expect(block).toContain('@action="onEmptyAction"');
    });
});
