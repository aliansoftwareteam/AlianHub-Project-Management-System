/* A rollup works a number out from the subtasks under a task and from nothing else, so the form offers no other
   reach and saves none. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import fs from 'node:fs';
import path from 'node:path';
import en from '@/locales/en';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/store/index', () => ({ default: { commit: () => {}, dispatch: () => Promise.resolve(), getters: {}, state: {} } }));
const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({ checkPermission: () => true, checkApps: () => true, makeUniqueId: () => 'uid', debounce: (fn) => fn }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id }) })
}));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@formkit/vue', async () => {
    const vue = await import('vue');
    return { FormKit: vue.defineComponent({ name: 'FormKit', setup: (_, { slots }) => () => vue.h('div', slots.default ? slots.default() : []) }) };
});

import customFieldPlugin from '@/plugins/customFieldView/customFieldPlugin';
import FieldBuilder from '@/plugins/customFieldView/component/organisms/FieldBuilder/FieldBuilder.vue';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en }, missingWarn: false, fallbackWarn: false });
config.global.plugins = [i18n, customFieldPlugin];
config.global.mocks = {};
config.global.provide = { ...config.global.provide, $defaultUserAvatar: '' };

const SCHEMA = fs.readFileSync(path.resolve(__dirname, '../../../utils/mongo-handler/schema.js'), 'utf8');
const PROJECT = { _id: 'p1', ProjectName: 'Launch', apps: ['CustomFields'], taskTypeCounts: [] };
const HOURS = { _id: 'f-hours', fieldTitle: 'Hours', fieldType: 'number', fieldDescription: 'Hours', type: 'task', isDelete: true, global: true, projectId: [], fieldTaskTypes: [] };
const TOTAL = { ...HOURS, _id: 'f-total', fieldTitle: 'Total hours', fieldType: 'rollup', rollupFunction: 'sum', rollupSourceFieldId: 'f-hours', rollupScope: 'sprint' };

const newStore = () => createStore({
    modules: {
        settings: {
            namespaced: true,
            state: { finalCustomFields: [HOURS, TOTAL], companies: [{ _id: 'c1', planFeature: { customFields: true } }] },
            getters: {
                taskType: () => [],
                AllTaskType: () => [],
                customFields: () => [],
                finalCustomFields: (state) => state.finalCustomFields,
                selectedCompany: (state) => state.companies[0]
            },
            mutations: { mutateFinalCustomFields: () => {} }
        },
        projectData: {
            namespaced: true,
            state: { allProjects: { data: [PROJECT] }, currentProjectDetails: PROJECT },
            getters: { allProjects: (state) => state.allProjects, currentProjectDetails: (state) => state.currentProjectDetails }
        }
    }
});

const Sidebar = { props: ['visible'], template: '<section v-if="visible"><slot name="body" /></section>' };
const stubs = { Sidebar, CustomFieldInputComponent: true, DropDown: true, TaskTypeIcon: true, ShellIcon: true, FieldTaskTypesPicker: true };

let wrapper;
const builder = async () => {
    wrapper = mount(FieldBuilder, { global: { plugins: [newStore()], stubs } });
    await flushPromises();
};
const newRollup = async () => {
    await wrapper.findAll('.fb__type').find((button) => button.text().startsWith(en.Fields.type_rollup)).trigger('click');
    await flushPromises();
};
const save = async () => {
    await wrapper.get('.fb__save').trigger('click');
    await flushPromises();
};
const saved = () => apiRequest.mock.calls.filter(([method]) => ['post', 'put'].includes(method)).map(([, , body]) => body.updateObject);
const choices = () => wrapper.findAll('.fb__seg button').map((button) => button.text());

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockResolvedValue({ status: 200, data: { _id: 'f-new' } });
});
afterEach(() => wrapper?.unmount());

describe('the rollup form', () => {
    it('offers the field to read and the function, and no choice of where to count', async () => {
        await builder();
        await newRollup();
        expect(wrapper.find('#fb-rollup-src').exists()).toBe(true);
        expect(choices()).toEqual(expect.arrayContaining(['SUM', 'AVG', 'COUNT', 'MIN', 'MAX']));
        expect(choices()).not.toContain('List');
        expect(choices()).not.toContain('Subtasks');
        expect(wrapper.get('[data-test="fb-rollup-help"]').text()).toBe(en.Fields.rollup_help);
    });

    it('saves a new rollup with its source and function and nothing about a list', async () => {
        await builder();
        await newRollup();
        await wrapper.get('#fb-title').setValue('Hours below');
        await wrapper.get('#fb-rollup-src').setValue('f-hours');
        await save();
        expect(saved()).toHaveLength(1);
        expect(saved()[0]).toMatchObject({ fieldType: 'rollup', rollupSourceFieldId: 'f-hours', rollupFunction: 'sum' });
        expect(saved()[0]).not.toHaveProperty('rollupScope');
    });

    it('saves an old rollup that named a list without sending that on', async () => {
        await builder();
        await wrapper.findAll('button.fb__row').find((row) => row.text().includes('Total hours')).trigger('click');
        await flushPromises();
        await save();
        expect(saved()).toHaveLength(1);
        expect(saved()[0]).not.toHaveProperty('rollupScope');
    });
});

describe('what a rollup is said to be', () => {
    it('is the subtasks under a task, in the type picker too', () => {
        expect(en.Fields.hint_rollup).toMatch(/subtasks/);
        expect(en.Fields.hint_rollup).not.toMatch(/list|sprint/i);
        expect(en.Fields).not.toHaveProperty('rollup_scope');
        expect(en.Fields).not.toHaveProperty('rollup_scope_sprint');
    });

    it('has nowhere to be stored as anything else', () => {
        expect(SCHEMA).toMatch(/rollupFunction/);
        expect(SCHEMA).not.toMatch(/rollupScope/);
    });
});
