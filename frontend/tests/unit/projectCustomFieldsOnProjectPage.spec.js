/* The project page provides the selected project to its children, so it cannot inject it itself.
   Its own use of the custom-field definitions (the Group by options) has to name the project. */
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { createStore } from 'vuex';

const composable = vi.hoisted(() => ({
    useCustomComposable: () => ({
        checkPermission: () => true,
        // Like the real one outside a provider: only a project that is passed in can be checked.
        checkApps: (app, project) => Boolean(project?.apps?.some((x) => x.key === app))
    })
}));
vi.mock('@/composable', () => composable);
vi.mock('@/composable/index', () => composable);
vi.mock('@/composable/index.js', () => composable);

import { useProjectCustomFields } from '@/views/Projects/composables/projectCustomFields';
import { customGroupOptions } from '@/views/Projects/composables/customFieldQuery';

const DEFS = [
    { _id: 'f-stage', fieldTitle: 'Stage', fieldType: 'dropdown', type: 'task', isDelete: true, global: true },
    { _id: 'f-note', fieldTitle: 'Note', fieldType: 'text', type: 'task', isDelete: true, global: true }
];

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

const defsFor = (project) => {
    let defs;
    const Page = defineComponent({
        setup() {
            ({ defs } = useProjectCustomFields(ref(project)));
            return () => h('div');
        }
    });
    mount(Page, { global: { plugins: [store()] } });
    return defs.value;
};

describe('custom fields on the project page', () => {
    it('are found for a project with the Custom Fields app, without an injected project', () => {
        const defs = defsFor({ _id: 'p1', apps: [{ key: 'CustomFields' }] });
        expect(defs.map((def) => def._id)).toEqual(['f-stage', 'f-note']);
        expect(customGroupOptions(defs).map((option) => option.title)).toEqual(['Stage']);
    });

    it('stay hidden for a project without the app', () => {
        expect(defsFor({ _id: 'p1', apps: [] })).toEqual([]);
    });
});
