import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { ref } from 'vue';
import { FormKit, plugin as formKit, defaultConfig } from '@formkit/vue';
import en from '@/locales/en';

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ status: 200, data: {} })) }));
vi.mock('@/store/index', () => ({ default: { commit: () => {}, dispatch: () => Promise.resolve(), getters: {}, state: {} } }));
const composable = vi.hoisted(() => {
    let next = 0;
    return { useCustomComposable: () => ({ checkPermission: () => true, makeUniqueId: () => `uid${++next}`, debounce: (fn) => fn }) };
});
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);

import CustomFieldDrawer from '@/plugins/customFieldView/component/molecules/customFieldSidebar/customField.vue';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [];
config.global.mocks = {};
config.global.provide = { ...config.global.provide, $defaultUserAvatar: '' };

const DATE_TYPE = { cfType: 'date', cfTitle: 'Date', cfDescrption: 'A date', cfIcon: 'CustomFieldDate', cfIconGrey: 'CustomFieldDateGrey', cfPrimaryColor: '#6473E8' };
const store = () => createStore({
    getters: {
        'settings/AllTaskType': () => [],
        'settings/taskType': () => [],
        'settings/customFields': () => [DATE_TYPE],
        'settings/selectedCompany': () => ({ planFeature: { customFields: true } })
    }
});

const mounted = [];
afterEach(() => { while (mounted.length) mounted.pop().unmount(); });

const dateForm = async () => {
    const wrapper = mount(CustomFieldDrawer, {
        props: { componentDetails: DATE_TYPE, pageInd: 1, customFieldObject: {} },
        attachTo: document.body,
        global: {
            plugins: [i18n, store(), [formKit, defaultConfig()]],
            provide: { selectedProject: ref({ _id: 'p1' }) },
            stubs: { DropDown: true, TaskTypeIcon: true, ToolTip: true, ShellIcon: true, FieldTaskTypesPicker: true }
        }
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};
const tabs = (wrapper) => wrapper.findAll('[role="tab"]');
const selected = (wrapper) => tabs(wrapper).map((tab) => tab.attributes('aria-selected'));
const openLimits = async (wrapper) => {
    await tabs(wrapper)[3].trigger('click');
    await flushPromises();
    expect(selected(wrapper)).toEqual(['false', 'false', 'false', 'true']);
};
const submit = async (wrapper, values) => {
    const node = wrapper.findComponent(FormKit).vm.node;
    Object.entries(values).forEach(([name, value]) => node.at(name).input(value, false));
    await node.settled;
    node.submit();
    return node;
};

describe('the fields of the form', () => {
    it('have ids of their own, so each label names its own field', async () => {
        const wrapper = await dateForm();
        const title = wrapper.get('input[name="fieldTitle"]').attributes('id');
        const description = wrapper.get('textarea[name="fieldDescription"]').attributes('id');
        expect(title).toBeTruthy();
        expect(description).toBeTruthy();
        expect(title).not.toBe(description);
        expect(wrapper.get(`label[for="${description}"]`).text()).toContain(en.Description.description);
    });
});

describe('saving a date field from the Limits tab', () => {
    it('shows the General tab and focuses the description when it is missing', async () => {
        const wrapper = await dateForm();
        await openLimits(wrapper);
        await submit(wrapper, { fieldTitle: 'Due' });
        await vi.waitFor(() => expect(selected(wrapper)).toEqual(['true', 'false', 'false', 'false']));
        await vi.waitFor(() => expect(document.activeElement).toBe(wrapper.get('textarea[name="fieldDescription"]').element));
        expect(wrapper.emitted('customFieldStore')).toBeUndefined();
    });

    it('does the same for a description that is filled in but too short', async () => {
        const wrapper = await dateForm();
        await openLimits(wrapper);
        await submit(wrapper, { fieldTitle: 'Due', fieldDescription: 'Too short' });
        await vi.waitFor(() => expect(selected(wrapper)).toEqual(['true', 'false', 'false', 'false']));
        await vi.waitFor(() => expect(document.activeElement).toBe(wrapper.get('textarea[name="fieldDescription"]').element));
    });

    it('focuses the label when that is the first field in error', async () => {
        const wrapper = await dateForm();
        await openLimits(wrapper);
        await submit(wrapper, { fieldDescription: 'The date the work is due' });
        await vi.waitFor(() => expect(selected(wrapper)).toEqual(['true', 'false', 'false', 'false']));
        await vi.waitFor(() => expect(document.activeElement).toBe(wrapper.get('input[name="fieldTitle"]').element));
    });

    it('saves a valid form from where the person is', async () => {
        const wrapper = await dateForm();
        await openLimits(wrapper);
        await submit(wrapper, { fieldTitle: 'Due', fieldDescription: 'The date the work is due' });
        await vi.waitFor(() => expect(wrapper.emitted('customFieldStore')).toBeTruthy(), { timeout: 3000 });
        expect(selected(wrapper)).toEqual(['false', 'false', 'false', 'true']);
    });
});
