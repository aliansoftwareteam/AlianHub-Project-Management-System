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

const store = (roleType) => createStore({
    modules: {
        projectData: { namespaced: true, getters: { projects: () => ({ data: [{ _id: 'p2', ProjectCode: 'OPS', ProjectName: 'Ops' }] }) } },
        settings: { namespaced: true, getters: { companyUsers: () => [{ userId: 'user-1' }], companyUserDetail: () => ({ roleType }) } },
        users: { namespaced: true, getters: { users: () => [] } }
    }
});

const useChecklist = (roleType) => {
    let api;
    mount(defineComponent({ setup() { api = useOnboardingChecklist(); return () => h('div'); } }), { global: { plugins: [store(roleType)] } });
    return api;
};

beforeEach(() => {
    me.value = { _id: 'user-1', tourStatus: {}, homeChecklist: {} };
    resetOnboardingRecord();
    closeWorkspaceImport();
    apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true } });
});

describe('the "Bring your work in" step', () => {
    it.each(['owner', 'admin'])('is offered to an %s, right after the first project', (role) => {
        const steps = useChecklist(ROLE[role]).steps.value;
        const keys = steps.map((s) => s.key);
        expect(keys.indexOf('import')).toBe(keys.indexOf('project') + 1);
        expect(steps.find((s) => s.key === 'import')).toMatchObject({ label: 'Home.step_import', cta: 'Home.bring_work_in', done: false });
    });

    it.each(['member', 'guest'])('is never shown to a %s', (role) => {
        expect(useChecklist(ROLE[role]).steps.value.map((s) => s.key)).not.toContain('import');
        expect(MEMBER_STEPS).not.toContain('import');
        expect(WORKSPACE_STEPS).toContain('import');
        expect(ADMIN_STEPS).toContain('import');
    });

    it('opens the workspace import dialog', () => {
        const checklist = useChecklist(ROLE.owner);
        expect(workspaceImport.open).toBe(false);
        expect(checklist.onAction('import')).toBe(true);
        expect(workspaceImport.open).toBe(true);
    });

    it('is done once an import has run, on any device', () => {
        me.value = { ...me.value, homeChecklist: { importedWork: true } };
        expect(useChecklist(ROLE.admin).steps.value.find((s) => s.key === 'import').done).toBe(true);
    });
});

describe('the checklist hosts the dialog', () => {
    const steps = [{ key: 'import', label: 'Home.step_import', cta: 'Home.bring_work_in', done: false }];

    it('mounts it only while it is open', async () => {
        const wrapper = mount(SetupChecklist, { props: { steps } });
        expect(wrapper.find('.wim-stub').exists()).toBe(false);
        await wrapper.find('.hc-setup__cta').trigger('click');
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
