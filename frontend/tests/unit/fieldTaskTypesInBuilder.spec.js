import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { defineComponent, h, provide, ref } from 'vue';
import en from '@/locales/en';

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: {} })) }));
vi.mock('@/store/index', () => ({ default: { commit: () => {}, dispatch: () => Promise.resolve(), getters: {}, state: {} } }));
const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({
        checkPermission: () => true,
        checkApps: (app, project) => Boolean(project?.apps?.includes(app)),
        makeUniqueId: () => 'uid',
        debounce: (fn) => fn
    }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id }) })
}));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
const formKit = vi.hoisted(() => ({
    stub: (vue) => vue.defineComponent({ name: 'FormKit', setup: (_, { slots }) => () => vue.h('div', slots.default ? slots.default() : []) })
}));
vi.mock('@formkit/vue', async () => ({ FormKit: formKit.stub(await import('vue')) }));
vi.mock('@/plugins/customFieldView/lazyFormKit', async () => {
    const library = { FormKit: formKit.stub(await import('vue')) };
    return { ...library, ensureFormKit: () => Promise.resolve(library), bindFormKitApp: () => {} };
});

import customFieldPlugin from '@/plugins/customFieldView/customFieldPlugin';
import FieldBuilder from '@/plugins/customFieldView/component/organisms/FieldBuilder/FieldBuilder.vue';
import CustomFieldsSidebarComponent from '@/plugins/customFieldView/component/molecules/customFieldSidebar/customFieldsSidebarComponent/customFieldsSidebarComponent.vue';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n, customFieldPlugin];
config.global.mocks = {};
config.global.provide = { ...config.global.provide, $defaultUserAvatar: '' };

const type = (key, name) => ({ key, name, value: name.toLowerCase().replace(' ', '_'), taskCount: 0, isDeleted: false, taskImage: `setting/task_type/${key}.png` });
const SANDBOX = { _id: 'p-sandbox', ProjectName: 'QA Sandbox', apps: ['CustomFields'], taskTypeCounts: [type(1, 'Task'), type(3, 'Sub Task'), type(2, 'Bug')] };
const DESIGN = { _id: 'p-design', ProjectName: 'Design', apps: ['CustomFields'], taskTypeCounts: [type(1, 'Task'), type(4, 'Story')] };
const TEXT_TYPE = { cfType: 'text', cfTitle: 'Text', cfDescrption: 'One line of text', cfIcon: 'CustomFieldText', cfIconGrey: 'CustomFieldTextGrey', cfPrimaryColor: '#6473E8', cfBackgroundColor: '#E0E2FF' };
const field = (more) => ({ fieldType: 'text', fieldDescription: 'A stored field', fieldPlaceholder: 'Type', type: 'task', isDelete: true, fieldTaskTypes: [], createdAt: '2026-09-01T00:00:00.000Z', ...more });
const DUE = field({ _id: 'f-due', fieldTitle: 'Due', global: true, projectId: [] });
const BROWSER = field({ _id: 'f-browser', fieldTitle: 'Browser', global: false, projectId: ['p-design'] });

/* The company in the bug report: no task type catalogue and no templates, only projects that carry their own types. */
const storeLikeTheApp = ({ projects = [SANDBOX, DESIGN], currentProject = SANDBOX, fields = [DUE, BROWSER] } = {}) => createStore({
    modules: {
        settings: {
            namespaced: true,
            state: {
                taskType: [], taskTypeArray: [], customFields: [TEXT_TYPE], finalCustomFields: fields,
                companies: [{ _id: 'c1', planFeature: { customFields: true } }], selectedCompanyId: 'c1'
            },
            getters: {
                taskType: (state) => JSON.parse(JSON.stringify(state.taskType)),
                AllTaskType: (state) => state.taskTypeArray,
                customFields: (state) => state.customFields,
                finalCustomFields: (state) => state.finalCustomFields,
                selectedCompany: (state) => state.companies.filter((company) => company._id === state.selectedCompanyId)[0] || {}
            },
            mutations: { mutateFinalCustomFields: () => {} }
        },
        projectData: {
            namespaced: true,
            state: { allProjects: { data: projects }, currentProjectDetails: currentProject },
            getters: { allProjects: (state) => state.allProjects, currentProjectDetails: (state) => state.currentProjectDetails }
        }
    }
});

const Sidebar = { props: ['visible'], template: '<section v-if="visible" class="drawer"><h2 class="drawer__title"><slot name="head-left" /></h2><slot name="body" /></section>' };
const stubs = { Sidebar, CustomFieldInputComponent: true, DropDown: true, TaskTypeIcon: true, ShellIcon: true };

const mounted = [];
const keep = (wrapper) => { mounted.push(wrapper); return wrapper; };
afterEach(() => { while (mounted.length) mounted.pop().unmount(); });

const offered = (wrapper) => wrapper.findAll('.ftt__name').map((name) => name.text());

describe('the field builder in Settings', () => {
    const builder = async (store = storeLikeTheApp()) => {
        const wrapper = keep(mount(FieldBuilder, { global: { plugins: [store], stubs } }));
        await flushPromises();
        return wrapper;
    };
    const pickType = async (wrapper, label) => {
        await wrapper.findAll('.fb__type').find((button) => button.text().startsWith(label)).trigger('click');
        await flushPromises();
    };
    const openField = async (wrapper, title) => {
        await wrapper.findAll('button.fb__row').find((row) => row.text().includes(title)).trigger('click');
        await flushPromises();
    };

    it('offers a new text field the task types of every project, though the company catalogue is empty', async () => {
        const wrapper = await builder();
        await pickType(wrapper, en.Fields.type_text);
        expect(wrapper.find('.drawer__title').exists()).toBe(true);
        expect(offered(wrapper)).toEqual(['Task', 'Sub Task', 'Bug', 'Story']);
        expect(wrapper.text()).not.toContain(en.Fields.task_types_empty);
    });

    it('offers a new formula field the same types', async () => {
        const wrapper = await builder();
        await pickType(wrapper, en.Fields.type_formula);
        expect(offered(wrapper)).toEqual(['Task', 'Sub Task', 'Bug', 'Story']);
    });

    it('offers a project field only the types of its own project', async () => {
        const wrapper = await builder();
        await openField(wrapper, 'Browser');
        expect(offered(wrapper)).toEqual(['Task', 'Story']);
    });

    it('says there are no task types only when no project has any', async () => {
        const wrapper = await builder(storeLikeTheApp({ projects: [], currentProject: {} }));
        await pickType(wrapper, en.Fields.type_formula);
        expect(offered(wrapper)).toEqual([]);
        expect(wrapper.text()).toContain(en.Fields.task_types_empty);
    });

    it('titles the form for a new field and for an existing one', async () => {
        const wrapper = await builder();
        await pickType(wrapper, en.Fields.type_text);
        expect(wrapper.get('.drawer__title').text()).toBe(en.CustomField.create_custom_field);

        await openField(wrapper, 'Due');
        expect(wrapper.get('.drawer__title').text()).toBe(en.CustomField.edit_custom_field);
        expect(en.CustomField.edit_custom_field).toBe('Edit Custom Field');
    });
});

describe('the field form opened from a task', () => {
    /* The task panel provides its project and the form sits below it, which is the only way the form learns the project. */
    const taskPanel = (project, customFieldObject = {}, store = storeLikeTheApp()) => keep(mount(defineComponent({
        setup() {
            provide('selectedProject', ref(project));
            return () => h(CustomFieldsSidebarComponent, { componentDetail: TEXT_TYPE, customFieldObject, isCustomField: true });
        }
    }), { global: { plugins: [store], stubs } }));

    it('offers a new field the types of the task\'s project, not those of the project open behind it', async () => {
        const wrapper = taskPanel(DESIGN);
        await flushPromises();
        expect(offered(wrapper)).toEqual(['Task', 'Story']);
    });

    it('reads the types from the project it is handed when the project list has not loaded', async () => {
        const wrapper = taskPanel(SANDBOX, {}, storeLikeTheApp({ projects: [], currentProject: {} }));
        await flushPromises();
        expect(offered(wrapper)).toEqual(['Task', 'Sub Task', 'Bug']);
    });

    it('offers a company-wide field every project\'s types when it is edited from a task', async () => {
        const wrapper = taskPanel(DESIGN, DUE);
        await flushPromises();
        expect(offered(wrapper)).toEqual(['Task', 'Sub Task', 'Bug', 'Story']);
        expect(wrapper.get('.drawer__title').text()).toBe(en.CustomField.edit_custom_field);
    });
});
