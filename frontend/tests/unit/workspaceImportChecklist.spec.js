import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequestWithoutCompnay, me } = vi.hoisted(() => ({ apiRequestWithoutCompnay: vi.fn(), me: { value: {} } }));

vi.mock('@/services', () => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(() => Promise.resolve()), hasRoute: () => true }), useRoute: () => ({ fullPath: '/', meta: {}, name: 'Home', params: {} }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => me.value }) }));
vi.mock('@/components/organisms/WorkspaceImport/WorkspaceImportDialog.vue', () => ({
    __esModule: true,
    default: defineComponent({ name: 'WorkspaceImportDialog', emits: ['close', 'imported'], setup: (_, { emit }) => () => h('div', { class: 'wim-stub' }, [h('button', { class: 'wim-stub__done', onClick: () => emit('imported', { source: 'clickup' }) })]) })
}));

import { useOnboardingChecklist, MEMBER_STEPS, WORKSPACE_STEPS, ADMIN_STEPS } from '@/composable/useOnboardingChecklist';
import { resetOnboardingRecord } from '@/composable/onboardingState';
import { workspaceImport, closeWorkspaceImport } from '@/components/organisms/WorkspaceImport/workspaceImportState';
import SetupChecklist from '@/components/molecules/Home/SetupChecklist.vue';
import { USER_ONBOARDING } from '@/config/env';

const ROLE = { guest: 0, owner: 1, admin: 2, member: 3 };

const store = (roleType, projects) => createStore({
    modules: {
        projectData: { namespaced: true, getters: { projects: () => ({ data: projects }) } },
        settings: { namespaced: true, getters: { companyUsers: () => [{ userId: 'user-1' }], companyUserDetail: () => ({ roleType }) } },
        users: { namespaced: true, getters: { users: () => [] } }
    }
});

const useChecklist = (roleType, projects = [{ _id: 'p2', ProjectCode: 'OPS', ProjectName: 'Ops' }]) => {
    let api;
    mount(defineComponent({ setup() { api = useOnboardingChecklist(); return () => h('div'); } }), { global: { plugins: [store(roleType, projects)] } });
    return api;
};

beforeEach(() => {
    me.value = { _id: 'user-1', tourStatus: {}, homeChecklist: {} };
    resetOnboardingRecord();
    closeWorkspaceImport();
    apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true } });
});

describe('the import on the project step', () => {
    it.each(['owner', 'admin'])('is offered to an %s as the second action of the project step', (role) => {
        const steps = useChecklist(ROLE[role]).steps.value;
        expect(steps.find((s) => s.key === 'project')).toMatchObject({ alt: { key: 'import', label: 'Home.import_from' } });
    });

    it.each(['member', 'guest'])('is never shown to a %s', (role) => {
        expect(useChecklist(ROLE[role]).steps.value.filter((s) => s.alt?.key === 'import')).toEqual([]);
        expect(MEMBER_STEPS).not.toContain('project');
        expect(WORKSPACE_STEPS).toContain('project');
        expect(ADMIN_STEPS).toContain('project');
    });

    it('opens the workspace import dialog', () => {
        const checklist = useChecklist(ROLE.owner);
        expect(workspaceImport.open).toBe(false);
        expect(checklist.onAction('import')).toBe(true);
        expect(workspaceImport.open).toBe(true);
    });

    it('ticks the project step once an import has run, on any device', () => {
        me.value = { ...me.value, homeChecklist: { importedWork: true } };
        expect(useChecklist(ROLE.admin, []).steps.value.find((s) => s.key === 'project').done).toBe(true);
        expect(useChecklist(ROLE.admin, []).steps.value.find((s) => s.key === 'task').done).toBe(false);
    });
});

describe('the checklist hosts the dialog', () => {
    const steps = [{ key: 'project', label: 'Home.step_start_project', cta: 'Home.create_project', alt: { key: 'import', label: 'Home.import_from' }, done: false }];

    it('mounts it only while it is open', async () => {
        const wrapper = mount(SetupChecklist, { props: { steps } });
        expect(wrapper.find('.wim-stub').exists()).toBe(false);
        await wrapper.find('.hc-setup__alt').trigger('click');
        expect(wrapper.emitted('action')[0]).toEqual(['import']);
        workspaceImport.open = true;
        await flushPromises();
        expect(wrapper.find('.wim-stub').exists()).toBe(true);
    });

    it('records the step when an import finishes', async () => {
        workspaceImport.open = true;
        const wrapper = mount(SetupChecklist, { props: { steps } });
        await flushPromises();
        await wrapper.find('.wim-stub__done').trigger('click');
        expect(apiRequestWithoutCompnay).toHaveBeenCalledWith('put', USER_ONBOARDING, { importedWork: true });
    });
});
