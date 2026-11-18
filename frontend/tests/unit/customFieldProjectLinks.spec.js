/* The settings list changes a field's projects by naming the ones added and taken off, so a copy of the field
   loaded before someone else linked a project does not take that project off again; and every open tab reads
   the definitions again when the server says they changed. */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { defineComponent, h, ref } from 'vue';
import fs from 'node:fs';
import path from 'node:path';

const api = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => api);
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true }),
    useConvertDate: () => ({ convertDateFormat: () => '' }),
    useGetterFunctions: () => ({ getTeamsData: () => Promise.resolve([]), getUser: () => ({ Employee_Name: 'Olivia Owner' }) })
}));
vi.mock('@/composable/customFieldIcon.js', () => ({ default: () => ({ getImageData: () => '' }) }));

import SettingCustomFieldComponent from '@/plugins/customFieldView/component/molecules/settingCustomField/settingCustomFieldComponent.vue';
import { projectLinkRequest } from '@/plugins/customFieldView/fieldProjectLinks';
import { CUSTOM_FIELDS_EVENT, useFieldDefinitionsSync } from '@/plugins/customFieldView/fieldDefinitionsSync';

const PROJECTS = [{ _id: 'p1', ProjectName: 'Alpha' }, { _id: 'p2', ProjectName: 'Beta' }, { _id: 'p3', ProjectName: 'Gamma' }];
const field = (extra = {}) => ({ _id: 'f1', fieldTitle: 'Budget', fieldType: 'number', type: 'task', isDelete: true, global: false, projectId: ['p1'], createdAt: '2026-09-01T00:00:00.000Z', ...extra });

const Picker = defineComponent({
    name: 'DropDown',
    props: { multiselectable: Boolean },
    emits: ['isVisible'],
    setup: (props, { slots }) => () => h('div', { class: props.multiselectable ? 'picker picker--projects' : 'picker' }, [slots.button?.({ triggerAttrs: {} }), slots.search?.(), slots.options?.()])
});
const Option = defineComponent({ name: 'DropDownOption', setup: (_, { slots }) => () => h('div', { class: 'option' }, slots.default?.()) });

const reread = vi.fn();
const changed = vi.fn();

const openSettings = async (fields) => {
    const store = createStore({
        modules: {
            settings: {
                namespaced: true,
                getters: {
                    customFields: () => [],
                    finalCustomFields: () => fields,
                    selectedCompany: () => ({ planFeature: { customFields: true } }),
                    companyUserDetail: () => ({ userId: 'u1', roleType: 1 }),
                    rules: () => ({ toggle: {} })
                },
                mutations: { mutateFinalCustomFields: changed },
                actions: { setfinalCustomFields: reread }
            },
            projectData: { namespaced: true, getters: { allProjects: () => ({ data: PROJECTS }) } }
        }
    });
    const wrapper = mount(SettingCustomFieldComponent, {
        global: {
            plugins: [store],
            stubs: {
                CustomFieldsSidebarComponent: true, DropDown: Picker, DropDownOption: Option, SpinnerComp: true, UpgradePlan: true,
                InputText: true, Toggle: true, UserProfile: true, CheckboxComponent: true
            }
        }
    });
    await flushPromises();
    return wrapper;
};

const projectsPicker = (wrapper) => wrapper.findAllComponents(Picker).find((picker) => picker.props('multiselectable'));
const tick = async (wrapper, projectId) => {
    await projectsPicker(wrapper).findAll('.option')[PROJECTS.findIndex((project) => project._id === projectId)].trigger('click');
};
const changeProjects = async (wrapper, change) => {
    const picker = projectsPicker(wrapper);
    picker.vm.$emit('isVisible', true);
    await flushPromises();
    await change();
    picker.vm.$emit('isVisible', false);
    await flushPromises();
};
const sentBody = () => api.apiRequest.mock.calls.filter(([method]) => method === 'put').map(([, , body]) => body);

beforeEach(() => {
    api.apiRequest.mockReset();
    api.apiRequest.mockResolvedValue({ status: 200, data: {} });
    reread.mockClear();
    changed.mockClear();
});

describe('what a change to a field\'s projects asks for', () => {
    test('names the projects added and the projects taken off', () => {
        expect(projectLinkRequest({ global: false, projectId: ['p1', 'p2'] }, { global: false, projectId: ['p2', 'p3'] }))
            .toEqual({ updateObject: { global: false }, addProjects: ['p3'], removeProjects: ['p1'] });
    });

    test('names nothing it does not change', () => {
        expect(projectLinkRequest({ global: false, projectId: ['p1'] }, { global: false, projectId: ['p1', 'p3'] }))
            .toEqual({ updateObject: { global: false }, addProjects: ['p3'] });
        expect(projectLinkRequest({ global: false, projectId: ['p1', 'p3'] }, { global: false, projectId: ['p3'] }))
            .toEqual({ updateObject: { global: false }, removeProjects: ['p1'] });
    });

    test('lists every project a company-wide field is narrowed to', () => {
        expect(projectLinkRequest({ global: true, projectId: [] }, { global: false, projectId: ['p1', 'p2'] }))
            .toEqual({ updateObject: { global: false }, addProjects: ['p1', 'p2'] });
    });

    test('is a company-wide field with no list when every project is chosen', () => {
        expect(projectLinkRequest({ global: false, projectId: ['p1'] }, { global: true, projectId: [] }))
            .toEqual({ updateObject: { global: true, projectId: [] } });
    });

    test('reads a field that holds its one project as text', () => {
        expect(projectLinkRequest({ global: false, projectId: 'p1' }, { global: false, projectId: ['p1', 'p2'] }))
            .toEqual({ updateObject: { global: false }, addProjects: ['p2'] });
    });
});

describe('the projects picker of the custom field settings', () => {
    test('a copy loaded before another project was linked sends only the project it adds', async () => {
        const wrapper = await openSettings([field({ projectId: ['p1'] })]);

        await changeProjects(wrapper, () => tick(wrapper, 'p3'));

        expect(sentBody()).toEqual([{ type: 'updateOne', key: '$set', id: 'f1', updateObject: { global: false }, addProjects: ['p3'] }]);
    });

    test('sends the project it takes off by name', async () => {
        const wrapper = await openSettings([field({ projectId: ['p1', 'p2'] })]);

        await changeProjects(wrapper, () => tick(wrapper, 'p1'));

        expect(sentBody()).toEqual([{ type: 'updateOne', key: '$set', id: 'f1', updateObject: { global: false }, removeProjects: ['p1'] }]);
    });

    test('sends a company-wide field when the last project is ticked', async () => {
        const wrapper = await openSettings([field({ projectId: ['p1', 'p2'] })]);

        await changeProjects(wrapper, () => tick(wrapper, 'p3'));

        expect(sentBody()).toEqual([{ type: 'updateOne', key: '$set', id: 'f1', updateObject: { global: true, projectId: [] } }]);
    });

    test('sends nothing when the picker closes unchanged', async () => {
        const wrapper = await openSettings([field({ projectId: ['p1', 'p2'] })]);

        await changeProjects(wrapper, () => {});

        expect(sentBody()).toEqual([]);
    });

    test('reads the definitions again when the server refuses the change', async () => {
        api.apiRequest.mockRejectedValue(Object.assign(new Error('refused'), { response: { status: 409 } }));
        const wrapper = await openSettings([field({ projectId: ['p1'] })]);

        await changeProjects(wrapper, () => tick(wrapper, 'p3'));

        expect(changed).not.toHaveBeenCalled();
        expect(reread).toHaveBeenCalledTimes(1);
    });
});

describe('a change to the field definitions made elsewhere', () => {
    const liveSocket = () => {
        const handlers = new Map();
        return {
            on: vi.fn((event, handler) => handlers.set(event, handler)),
            off: vi.fn((event, handler) => { if (handlers.get(event) === handler) handlers.delete(event); }),
            say: (event, payload) => handlers.get(event)?.(payload)
        };
    };
    const Host = (socket) => defineComponent({ setup() { useFieldDefinitionsSync(socket); return () => h('div'); } });
    const mountHost = (socket) => mount(Host(socket), {
        global: { plugins: [createStore({ modules: { settings: { namespaced: true, actions: { setfinalCustomFields: reread } } } })] }
    });

    test('makes the tab read the definitions again', async () => {
        const live = liveSocket();
        mountHost(ref(live));

        live.say(CUSTOM_FIELDS_EVENT, { type: 'update' });
        await flushPromises();

        expect(CUSTOM_FIELDS_EVENT).toBe('customFieldsChanged');
        expect(reread).toHaveBeenCalledTimes(1);
    });

    test('is heard on the socket that connects later, and no longer on the one it replaced or after the tab closes', async () => {
        const socket = ref(null);
        const wrapper = mountHost(socket);
        const first = liveSocket();
        const second = liveSocket();

        socket.value = first;
        await flushPromises();
        socket.value = second;
        await flushPromises();
        first.say(CUSTOM_FIELDS_EVENT, { type: 'update' });
        second.say(CUSTOM_FIELDS_EVENT, { type: 'insert' });
        await flushPromises();

        expect(first.off).toHaveBeenCalledWith(CUSTOM_FIELDS_EVENT, expect.any(Function));
        expect(reread).toHaveBeenCalledTimes(1);

        wrapper.unmount();
        second.say(CUSTOM_FIELDS_EVENT, { type: 'update' });
        expect(reread).toHaveBeenCalledTimes(1);
    });

    test('is listened for by the app shell on its own socket', () => {
        const app = fs.readFileSync(path.resolve(__dirname, '../../src/App.vue'), 'utf8');

        expect(app).toMatch(/useFieldDefinitionsSync\(socket\)/);
    });
});
