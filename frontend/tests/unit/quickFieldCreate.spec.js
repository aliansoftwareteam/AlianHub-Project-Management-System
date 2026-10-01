import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { defineComponent, ref } from 'vue';
import { plugin as formKit, defaultConfig } from '@formkit/vue';
import en from '@/locales/en';

const api = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => api);
vi.mock('@/store/index', () => ({ default: { commit: () => {}, dispatch: () => Promise.resolve(), getters: {}, state: {} } }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ success: () => {}, error: () => {} }) }));
vi.mock('vuedraggable', async () => {
    const vue = await import('vue');
    return {
        default: vue.defineComponent({
            name: 'draggable',
            props: { modelValue: { type: Array, default: () => [] } },
            setup: (props, { slots }) => () => vue.h('div', props.modelValue.map((element, index) => slots.item({ element, index })))
        })
    };
});
const composable = vi.hoisted(() => {
    let next = 0;
    return {
        useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true, makeUniqueId: () => `uid${++next}`, debounce: (fn) => fn }),
        useGetterFunctions: () => ({ getUser: (id) => ({ id }) })
    };
});
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);

import customFieldPlugin from '@/plugins/customFieldView/customFieldPlugin';
import CustomFieldDrawer from '@/plugins/customFieldView/component/molecules/customFieldSidebar/customField.vue';
import CustomFieldsSidebarComponent from '@/plugins/customFieldView/component/molecules/customFieldSidebar/customFieldsSidebarComponent/customFieldsSidebarComponent.vue';
import ModuleFieldEditor from '@/plugins/customFieldView/fieldTypes/ModuleFieldEditor.vue';
import FieldBuilder from '@/plugins/customFieldView/component/organisms/FieldBuilder/FieldBuilder.vue';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [];
config.global.mocks = {};
config.global.provide = { ...config.global.provide, $defaultUserAvatar: '' };

const typeOf = (cfType) => ({ cfType, cfTitle: cfType, cfDescrption: `A ${cfType} field`, cfIcon: '', cfIconGrey: '', cfPrimaryColor: '', cfBackgroundColor: '' });
const TEXT = typeOf('text');
const NUMBER = typeOf('number');
const DROPDOWN = typeOf('dropdown');
const DATE = typeOf('date');

const store = (fields = []) => createStore({
    modules: {
        settings: {
            namespaced: true,
            state: { finalCustomFields: fields },
            getters: {
                AllTaskType: () => [],
                taskType: () => [],
                customFields: () => [TEXT, NUMBER, DROPDOWN, DATE],
                finalCustomFields: (state) => state.finalCustomFields,
                selectedCompany: () => ({ planFeature: { customFields: true } }),
                companyUsers: () => []
            },
            mutations: { mutateFinalCustomFields: () => {} }
        },
        users: { namespaced: true, getters: { users: () => [] } },
        projectData: { namespaced: true, getters: { allProjects: () => ({ data: [] }), currentProjectDetails: () => ({}) } }
    }
});

const Sidebar = { props: ['visible', 'className'], template: '<section v-if="visible" class="drawer"><slot name="head-left" /><slot name="body" /></section>' };
const stubs = { Sidebar, DropDown: true, TaskTypeIcon: true, ToolTip: true, ShellIcon: true, FieldTaskTypesPicker: true, UpgradePlan: true, AiFieldPanel: true };
const global = (fields) => ({ plugins: [i18n, store(fields), [formKit, defaultConfig()], customFieldPlugin], provide: { selectedProject: ref({ _id: 'p1' }), $userId: ref('u1') }, stubs });

const mounted = [];
const keep = (wrapper) => { mounted.push(wrapper); return wrapper; };
beforeEach(() => { api.apiRequest.mockReset(); api.apiRequest.mockResolvedValue({ status: 200, data: { _id: 'new-field', data: { names: [] } } }); });
afterEach(() => { while (mounted.length) mounted.pop().unmount(); });

const formOf = async (type, customFieldObject = {}) => {
    const wrapper = keep(mount(CustomFieldDrawer, { props: { componentDetails: type, pageInd: 1, customFieldObject }, attachTo: document.body, global: global() }));
    await flushPromises();
    return wrapper;
};
const nameOf = (wrapper) => wrapper.get('input[name="fieldTitle"]');
const stored = (wrapper) => wrapper.emitted('customFieldStore') || [];
const saved = (wrapper) => vi.waitFor(() => expect(stored(wrapper).length).toBeGreaterThan(0), { timeout: 3000 });
const focused = (wrapper, selector) => vi.waitFor(() => expect(document.activeElement).toBe(wrapper.get(selector).element));

describe('the field form in the drawer', () => {
    it.each([['text', TEXT], ['number', NUMBER], ['date', DATE]])('opens a %s field with the name focused', async (label, type) => {
        const wrapper = await formOf(type);
        await focused(wrapper, 'input[name="fieldTitle"]');
    });

    it.each([['text', TEXT], ['number', NUMBER], ['date', DATE]])('saves a %s field that has a name and nothing else when Enter is pressed in the name', async (label, type) => {
        const wrapper = await formOf(type);
        await nameOf(wrapper).setValue('Cost');
        await nameOf(wrapper).trigger('keydown', { key: 'Enter' });
        await saved(wrapper);
        const [field, isEdit, another] = stored(wrapper)[0];
        expect(field).toMatchObject({ fieldTitle: 'Cost', fieldType: type.cfType, fieldDescription: '' });
        expect(isEdit).toBe(false);
        expect(another).toBe(false);
    });

    it('does not save on Enter while the name is empty', async () => {
        const wrapper = await formOf(TEXT);
        await nameOf(wrapper).trigger('keydown', { key: 'Enter' });
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(stored(wrapper)).toEqual([]);
    });

    it('marks the placeholder and the description as optional', async () => {
        const wrapper = await formOf(TEXT);
        const required = wrapper.findAll('.custom__field-required').filter((holder) => holder.find('input[name], textarea[name]').exists());
        expect(required.map((holder) => holder.find('input[name], textarea[name]').attributes('name'))).toEqual(['fieldTitle']);
    });

    it('says a save is to be followed by another field', async () => {
        const wrapper = await formOf(TEXT);
        await nameOf(wrapper).setValue('Note');
        await wrapper.get('[data-field-save-another]').trigger('click');
        await saved(wrapper);
        expect(stored(wrapper)[0][2]).toBe(true);
    });

    it('offers no second field while one is being edited', async () => {
        const wrapper = await formOf(TEXT, { _id: 'f1', fieldTitle: 'Note', fieldType: 'text', fieldDescription: '', fieldPlaceholder: '' });
        expect(wrapper.find('[data-field-save-another]').exists()).toBe(false);
    });
});

describe('the options of a dropdown', () => {
    const optionInputs = (wrapper) => wrapper.findAll('.option-field input');
    const enter = async (input, text) => {
        await input.setValue(text);
        await input.trigger('keydown', { key: 'Enter' });
        await flushPromises();
    };

    it('are asked for when Enter is pressed in the name of a dropdown that has none', async () => {
        const wrapper = await formOf(DROPDOWN);
        await nameOf(wrapper).setValue('Stage');
        await nameOf(wrapper).trigger('keydown', { key: 'Enter' });
        await vi.waitFor(() => expect(wrapper.findAll('[role="tab"]').map((tab) => tab.attributes('aria-selected'))).toEqual(['false', 'true', 'false']));
        await vi.waitFor(() => expect(document.activeElement).toBe(optionInputs(wrapper)[0].element));
        expect(stored(wrapper)).toEqual([]);
    });

    it('are added with Enter, and Enter on an empty one saves', async () => {
        const wrapper = await formOf(DROPDOWN);
        await nameOf(wrapper).setValue('Stage');
        await enter(optionInputs(wrapper)[0], 'Alpha');
        await vi.waitFor(() => expect(optionInputs(wrapper)).toHaveLength(2));
        await vi.waitFor(() => expect(document.activeElement).toBe(optionInputs(wrapper)[1].element));
        await enter(optionInputs(wrapper)[1], 'Beta');
        await vi.waitFor(() => expect(optionInputs(wrapper)).toHaveLength(3));
        await enter(optionInputs(wrapper)[2], 'Gamma');
        await vi.waitFor(() => expect(optionInputs(wrapper)).toHaveLength(4));
        await optionInputs(wrapper)[3].trigger('keydown', { key: 'Enter' });
        await saved(wrapper);
        expect(stored(wrapper)[0][0].fieldOptions.map((option) => option.label)).toEqual(['Alpha', 'Beta', 'Gamma']);
        expect(stored(wrapper)[0][0].fieldTitle).toBe('Stage');
    });

    it('are split one per line when several lines are pasted', async () => {
        const wrapper = await formOf(DROPDOWN);
        await optionInputs(wrapper)[0].trigger('paste', { clipboardData: { getData: () => 'Alpha\nBeta\r\n\n Gamma ' } });
        await vi.waitFor(() => expect(optionInputs(wrapper)).toHaveLength(3));
        expect(optionInputs(wrapper).map((input) => input.element.value)).toEqual(['Alpha', 'Beta', 'Gamma']);
    });
});

describe('Save and add another', () => {
    const Host = defineComponent({
        components: { CustomFieldsSidebarComponent },
        setup() {
            const open = ref(true);
            const saves = ref([]);
            const save = (field) => { saves.value.push(field); open.value = false; };
            return { open, saves, save };
        },
        template: '<CustomFieldsSidebarComponent v-model:isCustomField="open" :componentDetail="{}" :customFieldObject="{}" @customFieldStore="save" @handleClose="open = false" />'
    });
    const host = async () => {
        const wrapper = keep(mount(Host, { attachTo: document.body, global: global() }));
        await flushPromises();
        await wrapper.get('[data-field-type="number"]').trigger('click');
        await flushPromises();
        return wrapper;
    };

    it('keeps the drawer open on the same type, cleared, with the name focused', async () => {
        const wrapper = await host();
        await nameOf(wrapper).setValue('Cost');
        await wrapper.get('[data-field-save-another]').trigger('click');
        await vi.waitFor(() => expect(wrapper.vm.saves).toHaveLength(1), { timeout: 3000 });
        await flushPromises();
        expect(wrapper.vm.saves[0]).toMatchObject({ fieldTitle: 'Cost', fieldType: 'number' });
        expect(wrapper.vm.open).toBe(true);
        expect(wrapper.find('.drawer').exists()).toBe(true);
        expect(wrapper.find('[data-field-type]').exists()).toBe(false);
        expect(nameOf(wrapper).element.value).toBe('');
        await focused(wrapper, 'input[name="fieldTitle"]');

        await nameOf(wrapper).setValue('Budget');
        await nameOf(wrapper).trigger('keydown', { key: 'Enter' });
        await vi.waitFor(() => expect(wrapper.vm.saves).toHaveLength(2), { timeout: 3000 });
        await flushPromises();
        expect(wrapper.vm.saves[1]).toMatchObject({ fieldTitle: 'Budget', fieldType: 'number' });
        expect(wrapper.vm.open).toBe(false);
        expect(wrapper.find('.drawer').exists()).toBe(false);
    });

    it('closes for good when the drawer is closed after a save that did not go through', async () => {
        const Failing = defineComponent({
            components: { CustomFieldsSidebarComponent },
            setup: () => ({ open: ref(true) }),
            template: '<CustomFieldsSidebarComponent v-model:isCustomField="open" :componentDetail="{}" :customFieldObject="{}" @handleClose="open = false" />'
        });
        const wrapper = keep(mount(Failing, { attachTo: document.body, global: global() }));
        await flushPromises();
        await wrapper.get('[data-field-type="number"]').trigger('click');
        await flushPromises();
        await nameOf(wrapper).setValue('Cost');
        await wrapper.get('[data-field-save-another]').trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 400));
        wrapper.findComponent(CustomFieldsSidebarComponent).vm.$emit('handleClose');
        await flushPromises();
        expect(wrapper.vm.open).toBe(false);
        expect(wrapper.find('.drawer').exists()).toBe(false);
    });
});

describe('the form of the newer field types', () => {
    const editor = async (field = {}) => {
        const wrapper = keep(mount(ModuleFieldEditor, { props: { fieldType: 'people', field }, attachTo: document.body, global: global() }));
        await flushPromises();
        return wrapper;
    };

    it('opens with the name focused', async () => {
        const wrapper = await editor();
        await focused(wrapper, '[data-field-title]');
    });

    it('saves on Enter in the name, and not while the name is empty', async () => {
        const wrapper = await editor();
        await wrapper.get('[data-field-title]').trigger('keydown', { key: 'Enter' });
        expect(wrapper.emitted('save')).toBeUndefined();
        await wrapper.get('[data-field-title]').setValue('Reviewer');
        await wrapper.get('[data-field-title]').trigger('keydown', { key: 'Enter' });
        expect(wrapper.emitted('save')[0][0]).toMatchObject({ fieldTitle: 'Reviewer', fieldType: 'people' });
        expect(wrapper.emitted('save')[0][2]).toBe(false);
    });

    it('offers a second field for a new field only', async () => {
        const wrapper = await editor();
        await wrapper.get('[data-field-title]').setValue('Reviewer');
        await wrapper.get('[data-field-save-another]').trigger('click');
        expect(wrapper.emitted('save')[0][2]).toBe(true);
        expect((await editor({ _id: 'f1', fieldTitle: 'Reviewer' })).find('[data-field-save-another]').exists()).toBe(false);
    });
});

describe('the field builder in Settings', () => {
    const builder = async () => {
        const wrapper = keep(mount(FieldBuilder, { attachTo: document.body, global: global() }));
        await flushPromises();
        return wrapper;
    };
    const start = async (wrapper, type) => {
        await wrapper.get(`[data-field-type-option="${type}"]`).trigger('click');
        await flushPromises();
    };
    const saves = () => api.apiRequest.mock.calls.filter(([method, , body]) => method === 'post' && body?.type === 'save');

    it('opens a new field with the name focused', async () => {
        const wrapper = await builder();
        await start(wrapper, 'rollup');
        await focused(wrapper, '#fb-title');
    });

    it('saves on Enter in the name and closes the form', async () => {
        const wrapper = await builder();
        await start(wrapper, 'people');
        await wrapper.get('#fb-title').setValue('Reviewer');
        await wrapper.get('#fb-title').trigger('keydown', { key: 'Enter' });
        await flushPromises();
        expect(saves()).toHaveLength(1);
        expect(saves()[0][2].updateObject).toMatchObject({ fieldTitle: 'Reviewer', fieldType: 'people' });
        expect(wrapper.find('#fb-title').exists()).toBe(false);
    });

    it('keeps the form open on the same type after Save and add another', async () => {
        const wrapper = await builder();
        await start(wrapper, 'rollup');
        await wrapper.get('#fb-title').setValue('Subtask cost');
        await wrapper.get('[data-field-save-another]').trigger('click');
        await flushPromises();
        expect(saves()).toHaveLength(1);
        expect(wrapper.get('#fb-title').element.value).toBe('');
        expect(wrapper.get('.fb__panel-kind').text()).toBe(en.Fields.type_rollup);
        await focused(wrapper, '#fb-title');
    });
});
