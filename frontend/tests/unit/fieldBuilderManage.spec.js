/* Tenth sweep, defects 3 and 11: a field can be archived, restored, deleted and given projects from the field
   manager, and the builder says what it does. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import en from '@/locales/en';

const { apiRequest, toast, may } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: { success: vi.fn(), error: vi.fn() }, may: { edit: true } }));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/store/index', () => ({ default: { commit: () => {}, dispatch: () => Promise.resolve(), getters: {}, state: {} } }));
const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({ checkPermission: () => may.edit, checkApps: () => true, makeUniqueId: () => 'uid', debounce: (fn) => fn }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id }) })
}));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@formkit/vue', async () => {
    const vue = await import('vue');
    return { FormKit: vue.defineComponent({ name: 'FormKit', setup: (_, { slots }) => () => vue.h('div', slots.default ? slots.default() : []) }) };
});

import * as env from '@/config/env';
import customFieldPlugin from '@/plugins/customFieldView/customFieldPlugin';
import FieldBuilder from '@/plugins/customFieldView/component/organisms/FieldBuilder/FieldBuilder.vue';
import { BUILTIN_TOKENS, tokenOf, tokensFrom } from '@/plugins/customFieldView/formulaTokens';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n, customFieldPlugin];
config.global.mocks = {};
config.global.provide = { ...config.global.provide, $defaultUserAvatar: '' };

const LAUNCH = { _id: 'p1', ProjectName: 'Launch', apps: ['CustomFields'], taskTypeCounts: [] };
const SITE = { _id: 'p2', ProjectName: 'Site', apps: ['CustomFields'], taskTypeCounts: [] };
const field = (more) => ({ fieldDescription: '', type: 'task', isDelete: true, global: true, projectId: [], fieldTaskTypes: [], ...more });
const COST = field({ _id: 'f-cost', fieldTitle: 'Cost', fieldType: 'number' });
const OLD = field({ _id: 'f-old', fieldTitle: 'Old budget', fieldType: 'number', isDelete: false });
const VALUE = field({ _id: 'f-value', fieldTitle: 'Value', fieldType: 'formula', formulaExpression: '{Cost} * 2' });

const SCOPE = [
    { name: 'subtask_count', source: 'task', value: 0 },
    { name: 'estimate', source: 'task' },
    ...['Cost', 'Story Points', 'Billable rate', 'Budget', 'Risk', 'Old budget', 'Effort'].map((title, at) => ({ name: title.toLowerCase().replace(/\s+/g, '_'), source: 'number', fieldId: `f-${at}`, title }))
];

let store;
const newStore = (fields) => createStore({
    modules: {
        settings: {
            namespaced: true,
            state: { finalCustomFields: fields, companies: [{ _id: 'c1', planFeature: { customFields: true } }] },
            getters: {
                taskType: () => [],
                AllTaskType: () => [],
                customFields: () => [],
                finalCustomFields: (state) => state.finalCustomFields,
                selectedCompany: (state) => state.companies[0]
            },
            mutations: {
                mutateFinalCustomFields(state, { data, op }) {
                    const at = state.finalCustomFields.findIndex((entry) => entry._id === data._id);
                    if (op === 'removed' && at !== -1) state.finalCustomFields.splice(at, 1);
                    if (op === 'modified' && at !== -1) state.finalCustomFields[at] = data;
                    if (op === 'added') state.finalCustomFields.push(data);
                }
            }
        },
        projectData: {
            namespaced: true,
            state: { allProjects: { data: [LAUNCH, SITE] }, currentProjectDetails: LAUNCH },
            getters: { allProjects: (state) => state.allProjects, onlyActiveProjects: (state) => state.allProjects.data, currentProjectDetails: (state) => state.currentProjectDetails }
        }
    }
});

const Sidebar = { props: ['visible'], template: '<section v-if="visible"><slot name="body" /></section>' };
const stubs = { Sidebar, CustomFieldInputComponent: true, DropDown: true, TaskTypeIcon: true, ShellIcon: true, FieldTaskTypesPicker: true, teleport: true };

let wrapper;
const builder = async (fields = [COST, OLD, VALUE]) => {
    store = newStore(fields.map((entry) => ({ ...entry })));
    wrapper = mount(FieldBuilder, { global: { plugins: [store], stubs }, attachTo: document.body });
    await flushPromises();
};
const line = (title) => wrapper.findAll('.fb__line').find((row) => row.text().includes(title));
const menuOf = async (title) => {
    await line(title).get('[aria-haspopup="menu"]').trigger('click');
    return line(title).findAll('[role="menuitem"]');
};
const pick = async (title, label) => {
    const items = await menuOf(title);
    await items.find((item) => item.text() === label).trigger('click');
    await flushPromises();
};
const calls = (method, url) => apiRequest.mock.calls.filter(([verb, at]) => verb === method && at === url).map(([, , body]) => body);
const usageUrl = (id) => `${env.CUSTOM_FIELDS_V2}/${id}/usage`;
const deleteUrl = (id) => `${env.CUSTOM_FIELDS_V2}/${id}/delete`;
const answers = (usage = { tasks: 0, readBy: [] }) => apiRequest.mockImplementation((method, url) => {
    if (url === env.CUSTOM_FIELD_FORMULA_SCOPE) return Promise.resolve({ status: 200, data: { data: { names: SCOPE } } });
    if (url === env.CUSTOM_FIELD_FORMULA_VALIDATE) return Promise.resolve({ status: 200, data: { status: true, data: { preview: 1 } } });
    if (String(url).endsWith('/usage')) return Promise.resolve({ status: 200, data: { status: true, data: usage } });
    if (String(url).endsWith('/delete')) return Promise.resolve({ status: 200, data: { status: true, data: { tasks: usage.tasks } } });
    return Promise.resolve({ status: 200, data: { _id: 'f-new' } });
});
const titles = () => store.state.settings.finalCustomFields.map((entry) => entry.fieldTitle);

beforeEach(() => {
    may.edit = true;
    apiRequest.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    answers();
});
afterEach(() => wrapper?.unmount());

describe('the actions of a field row', () => {
    it('are choosing its projects, archiving it and deleting it', async () => {
        await builder();
        expect((await menuOf('Cost')).map((item) => item.text())).toEqual([en.Fields.choose_projects, en.Fields.archive, en.Fields.delete]);
    });

    it('offer Restore in place of Archive on an archived field, which is marked as archived', async () => {
        await builder();
        expect(line('Old budget').text()).toContain(en.Fields.archived);
        expect(line('Cost').text()).not.toContain(en.Fields.archived);
        expect((await menuOf('Old budget')).map((item) => item.text())).toEqual([en.Fields.choose_projects, en.Fields.restore, en.Fields.delete]);
    });

    it('are not offered to someone who may not manage fields', async () => {
        may.edit = false;
        await builder();
        expect(wrapper.find('[aria-haspopup="menu"]').exists()).toBe(false);
    });

    it('leave the row itself a button that opens the editor', async () => {
        await builder();
        await line('Value').get('button.fb__row').trigger('click');
        await flushPromises();
        expect(wrapper.get('#fb-title').element.value).toBe('Value');
    });
});

describe('archiving a field', () => {
    it('switches it off and keeps it in the list, and says its values are kept', async () => {
        await builder();
        await pick('Cost', en.Fields.archive);
        expect(calls('put', env.CUSTOM_FIELD)).toEqual([{ type: 'updateOne', key: '$set', id: 'f-cost', updateObject: { isDelete: false } }]);
        expect(titles()).toContain('Cost');
        expect(line('Cost').text()).toContain(en.Fields.archived);
        expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('values are kept'), expect.anything());
    });

    it('is undone by Restore', async () => {
        await builder();
        await pick('Old budget', en.Fields.restore);
        expect(calls('put', env.CUSTOM_FIELD)).toEqual([{ type: 'updateOne', key: '$set', id: 'f-old', updateObject: { isDelete: true } }]);
        expect(line('Old budget').text()).not.toContain(en.Fields.archived);
    });

    it('leaves the row as it was when the server refuses', async () => {
        await builder();
        apiRequest.mockImplementation((method) => (method === 'put' ? Promise.reject(new Error('refused')) : Promise.resolve({ status: 200, data: { data: { names: [] } } })));
        await pick('Cost', en.Fields.archive);
        expect(line('Cost').text()).not.toContain(en.Fields.archived);
        expect(toast.error).toHaveBeenCalled();
    });
});

describe('deleting a field', () => {
    const dialog = () => wrapper.find('[role="alertdialog"]');

    it('asks first and says how many tasks hold a value', async () => {
        answers({ tasks: 3, readBy: [] });
        await builder();
        await pick('Cost', en.Fields.delete);
        expect(calls('get', usageUrl('f-cost'))).toHaveLength(1);
        expect(dialog().exists()).toBe(true);
        expect(dialog().text()).toContain('3 tasks hold a value');
        expect(dialog().text()).toContain('removed for good');
        expect(calls('post', deleteUrl('f-cost'))).toHaveLength(0);
        expect(titles()).toContain('Cost');
    });

    it('says so when no task holds a value', async () => {
        await builder();
        await pick('Cost', en.Fields.delete);
        expect(dialog().text()).toContain(en.Fields.delete_no_values);
    });

    it('deletes on the confirm and takes the field out of the list', async () => {
        answers({ tasks: 1, readBy: [] });
        await builder();
        await pick('Cost', en.Fields.delete);
        await dialog().get('[data-action="confirm"]').trigger('click');
        await flushPromises();
        expect(calls('post', deleteUrl('f-cost'))).toHaveLength(1);
        expect(titles()).not.toContain('Cost');
        expect(dialog().exists()).toBe(false);
    });

    it('does nothing on Cancel', async () => {
        await builder();
        await pick('Cost', en.Fields.delete);
        await dialog().get('[data-action="cancel"]').trigger('click');
        await flushPromises();
        expect(dialog().exists()).toBe(false);
        expect(calls('post', deleteUrl('f-cost'))).toHaveLength(0);
    });

    it('offers to archive instead, which keeps the values', async () => {
        answers({ tasks: 4, readBy: [] });
        await builder();
        await pick('Cost', en.Fields.delete);
        await dialog().get('[data-action="archive"]').trigger('click');
        await flushPromises();
        expect(calls('put', env.CUSTOM_FIELD)).toEqual([{ type: 'updateOne', key: '$set', id: 'f-cost', updateObject: { isDelete: false } }]);
        expect(calls('post', deleteUrl('f-cost'))).toHaveLength(0);
    });

    it('names the fields that read it and offers no delete while they do', async () => {
        answers({ tasks: 2, readBy: ['Value'] });
        await builder();
        await pick('Cost', en.Fields.delete);
        expect(dialog().text()).toContain('Value');
        expect(dialog().find('[data-action="confirm"]').exists()).toBe(false);
    });

    it('closes the editor of the field it deletes', async () => {
        await builder();
        await line('Value').get('button.fb__row').trigger('click');
        await pick('Value', en.Fields.delete);
        await dialog().get('[data-action="confirm"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('#fb-title').exists()).toBe(false);
    });
});

describe('the projects of a field', () => {
    const dialog = () => wrapper.find('[role="dialog"][data-field-projects]');
    const boxes = () => dialog().findAll('input[type="checkbox"]');

    it('are every project, or the ones ticked', async () => {
        await builder();
        await pick('Cost', en.Fields.choose_projects);
        expect(dialog().get('input[value="every"]').element.checked).toBe(true);
        await dialog().get('input[value="chosen"]').setValue(true);
        expect(boxes()).toHaveLength(2);
        expect(dialog().get('[data-action="confirm"]').attributes('disabled')).toBeDefined();
        await boxes()[1].setValue(true);
        await dialog().get('[data-action="confirm"]').trigger('click');
        await flushPromises();
        expect(calls('put', env.CUSTOM_FIELD)).toEqual([{ type: 'updateOne', key: '$set', id: 'f-cost', updateObject: { global: false }, addProjects: ['p2'] }]);
        expect(store.state.settings.finalCustomFields.find((entry) => entry._id === 'f-cost')).toMatchObject({ global: false, projectId: ['p2'] });
    });

    it('go back to every project without naming any', async () => {
        await builder([field({ _id: 'f-cost', fieldTitle: 'Cost', fieldType: 'number', global: false, projectId: ['p1'] })]);
        await pick('Cost', en.Fields.choose_projects);
        expect(dialog().get('input[value="chosen"]').element.checked).toBe(true);
        expect(boxes().map((box) => box.element.checked)).toEqual([true, false]);
        await dialog().get('input[value="every"]').setValue(true);
        await dialog().get('[data-action="confirm"]').trigger('click');
        await flushPromises();
        expect(calls('put', env.CUSTOM_FIELD)).toEqual([{ type: 'updateOne', key: '$set', id: 'f-cost', updateObject: { global: true, projectId: [] } }]);
    });

    it('are named on the row', async () => {
        await builder([field({ _id: 'f-cost', fieldTitle: 'Cost', fieldType: 'number', global: false, projectId: ['p1'] })]);
        expect(line('Cost').text()).toContain('Launch');
    });
});

describe('what the builder says', () => {
    const newField = async (label) => {
        await wrapper.findAll('.fb__type').find((button) => button.text().startsWith(label)).trigger('click');
        await flushPromises();
    };
    const tokens = () => wrapper.findAll('[data-formula-token]').map((button) => button.text());

    it('says a new field was added, and a changed one was updated', async () => {
        await builder();
        await newField(en.Fields.type_rollup);
        await wrapper.get('#fb-title').setValue('Subtasks below');
        await wrapper.get('.fb__save').trigger('click');
        await flushPromises();
        expect(toast.success).toHaveBeenLastCalledWith(en.Toast.Field_Added_Successfully, expect.anything());

        await line('Value').get('button.fb__row').trigger('click');
        await wrapper.get('.fb__save').trigger('click');
        await flushPromises();
        expect(toast.success).toHaveBeenLastCalledWith(en.Toast.Field_Updated_Successfully, expect.anything());
    });

    it('calls the count of a rollup the number of subtasks', async () => {
        expect(en.Fields.rollup_source_count).toBe('Number of subtasks');
        await builder();
        await newField(en.Fields.type_rollup);
        expect(wrapper.get('#fb-rollup-src').findAll('option')[0].text()).toBe('Number of subtasks');
        expect(wrapper.text()).toContain(en.Fields.rollup_rules);
        expect(wrapper.text()).not.toContain(en.Fields.formula_rules);
    });

    it('opens the rest of the fields a formula can read when "+ more" is pressed', async () => {
        await builder();
        await newField(en.Fields.type_formula);
        expect(tokens()).toHaveLength(8);
        const more = wrapper.get('[data-formula-more]');
        expect(more.element.tagName).toBe('BUTTON');
        expect(more.attributes('aria-expanded')).toBe('false');
        await more.trigger('click');
        expect(tokens()).toHaveLength(11);
        expect(wrapper.get('[data-formula-more]').attributes('aria-expanded')).toBe('true');
        await wrapper.get('[data-formula-more]').trigger('click');
        expect(tokens()).toHaveLength(8);
    });

    it('labels the formula box and shows its example in the form the buttons insert', async () => {
        await builder();
        await newField(en.Fields.type_formula);
        const box = wrapper.get('textarea.fb__expr');
        expect(wrapper.get(`label[for="${box.attributes('id')}"]`).text()).toBe(en.Fields.formula_label);
        expect(box.attributes('placeholder')).toContain('{logged_hours}');
    });

    it('no longer promises thirty days after a delete', () => {
        expect(en.Fields.type_note).not.toMatch(/30 days/);
        expect(en.Fields.type_note).toMatch(/[Aa]rchive/);
    });
});

describe('the name a formula uses for a field', () => {
    it('is the field\'s own name in both editors, and the task\'s own numbers keep theirs', async () => {
        expect(tokenOf({ fieldTitle: ' Story Points ' })).toBe('{Story Points}');
        expect(tokensFrom(SCOPE).slice(0, 6)).toEqual(['{subtask_count}', '{estimate}', '{remaining_hours}', '{logged_hours}', '{Cost}', '{Story Points}']);
        expect(BUILTIN_TOKENS).toContain('{subtask_count}');
        await builder();
        await wrapper.findAll('.fb__type').find((button) => button.text().startsWith(en.Fields.type_formula)).trigger('click');
        await flushPromises();
        expect(wrapper.findAll('[data-formula-token]').map((button) => button.text()).slice(0, 6)).toEqual(['{subtask_count}', '{estimate}', '{remaining_hours}', '{logged_hours}', '{Cost}', '{Story Points}']);
        await wrapper.findAll('[data-formula-token]')[5].trigger('click');
        expect(wrapper.get('textarea.fb__expr').element.value).toBe('{Story Points}');
    });

    it('tries a formula with a number for the old name and the new one alike', async () => {
        await builder();
        await line('Value').get('button.fb__row').trigger('click');
        await flushPromises();
        await wrapper.findAll('.fb__panel-foot button').find((button) => button.text() === en.Fields.test).trigger('click');
        await flushPromises();
        const [{ sample }] = calls('post', env.CUSTOM_FIELD_FORMULA_VALIDATE).slice(-1);
        expect(sample).toMatchObject({ Cost: expect.any(Number), cost: expect.any(Number), story_points: expect.any(Number), 'Story Points': expect.any(Number) });
    });

    it('is listed the same way by the editor in the task panel', async () => {
        const { default: FormulaComponent } = await import('@/plugins/customFieldView/component/atom/customFieldSidebar/customFieldSidebarComponent/formulaComponent.vue');
        const panel = mount(FormulaComponent, { props: { componentDetail: { cfType: 'formula' }, customFieldObject: {} }, global: { plugins: [newStore([COST, VALUE])], stubs } });
        expect(panel.get('[data-formula-tokens]').text()).toBe('{subtask_count}, {estimate}, {remaining_hours}, {logged_hours}, {Cost}, {Value}');
        panel.unmount();
    });
});
