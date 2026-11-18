import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { defineComponent, h, ref } from 'vue';
import en from '@/locales/en';

const { USERS } = vi.hoisted(() => ({
    USERS: {
        'a1a1a1a1a1a1a1a1a1a1a1a1': { Employee_Name: 'Olivia Owner', Employee_profileImageURL: '' },
        'b2b2b2b2b2b2b2b2b2b2b2b2': { Employee_Name: 'Max Member', Employee_profileImageURL: '' }
    }
}));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ debounce: (fn) => fn, makeUniqueId: () => 'uid', checkPermission: () => true, checkApps: () => true }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, _id: id, Employee_Name: 'Ghost User', ...(USERS[id] || {}) }), getTeam: () => ({}) })
}));

import PeopleFieldValue from '@/plugins/customFieldView/fieldTypes/PeopleFieldValue.vue';

const [OLIVIA, MAX] = Object.keys(USERS);
const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
const store = createStore({
    getters: {
        'settings/companyUsers': () => [{ userId: OLIVIA, status: 2, isDelete: false }, { userId: MAX, status: 2, isDelete: false }],
        'settings/teams': () => [],
        'settings/rules': () => ({}),
        'settings/designations': () => []
    }
});
const field = (fieldMultiple) => ({ _id: 'd1'.repeat(12), fieldType: 'people', fieldTitle: 'Reviewer', fieldMultiple });

const WAIT_FOR_PANEL = 150;
const settle = async () => {
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, WAIT_FOR_PANEL));
    await flushPromises();
};
const panel = () => document.querySelector('#my-sidebar [role="dialog"]');
const isOpen = () => Boolean(panel()) && !panel().closest('.d-none');
const optionNamed = (name) => [...document.querySelectorAll('#my-sidebar [role="option"]')].find((option) => option.textContent.includes(name));

/* The cell hands the picked people straight back as the value, as the List and the task panel do. */
function mountField(def, start = []) {
    const Host = defineComponent({
        setup() {
            const value = ref(start);
            return () => h(PeopleFieldValue, { def, value: value.value, editable: true, label: def.fieldTitle, onChange: (next) => { value.value = next; } });
        }
    });
    return mount(Host, {
        attachTo: document.body,
        global: { plugins: [store, i18n], provide: { selectedProject: ref({ _id: 'p1' }) }, stubs: { UserProfile: true, DropDown: true, DropDownOption: true } }
    });
}

async function pick(wrapper, name) {
    await wrapper.get('[data-cell-edit]').trigger('click');
    await settle();
    expect(isOpen()).toBe(true);
    optionNamed(name).click();
    await settle();
}

beforeEach(() => {
    document.body.innerHTML = '<div id="my-sidebar"></div>';
});

describe('the people picker of a custom field', () => {
    it('closes once a person is picked for a field that holds one person', async () => {
        const wrapper = mountField(field(false));
        await pick(wrapper, 'Max Member');
        expect(wrapper.text()).toContain('Max Member');
        expect(isOpen()).toBe(false);
        wrapper.unmount();
    });

    it('closes when the one person is replaced by another', async () => {
        const wrapper = mountField(field(false), [OLIVIA]);
        await pick(wrapper, 'Max Member');
        expect(wrapper.text()).toContain('Max Member');
        expect(wrapper.text()).not.toContain('Olivia Owner');
        expect(isOpen()).toBe(false);
        wrapper.unmount();
    });

    it('closes when the one person is picked again, which takes them off', async () => {
        const wrapper = mountField(field(false), [MAX]);
        await pick(wrapper, 'Max Member');
        expect(wrapper.text()).not.toContain('Max Member');
        expect(isOpen()).toBe(false);
        wrapper.unmount();
    });

    it('stays open when a person is taken off a field that holds several people', async () => {
        const wrapper = mountField(field(true), [MAX, OLIVIA]);
        await pick(wrapper, 'Max Member');
        expect(wrapper.text()).not.toContain('Max Member');
        expect(isOpen()).toBe(true);
        wrapper.unmount();
    });

    it('stays open for a field that holds several people', async () => {
        const wrapper = mountField(field(true));
        await pick(wrapper, 'Max Member');
        expect(wrapper.text()).toContain('Max Member');
        expect(isOpen()).toBe(true);
        optionNamed('Olivia Owner').click();
        await settle();
        expect(wrapper.text()).toContain('Olivia Owner');
        expect(isOpen()).toBe(true);
        wrapper.unmount();
    });
});
