import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { nextTick, reactive, ref } from 'vue';

const store = vi.hoisted(() => ({ getters: null, commit: () => {} }));

vi.mock('@/services', () => ({
    apiRequest: vi.fn(() => Promise.resolve({ data: {} })),
    apiRequestWithoutCompnay: vi.fn(() => Promise.resolve({ data: {} })),
}));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: (key) => key }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({
        checkPermission: () => true, makeUniqueId: () => 'id', checkBucketStorage: () => true, checkApps: () => true, getAppState: () => 'enabled',
    }),
    useGetterFunctions: () => ({ getUser: () => ({ id: 'u1', Employee_Name: 'Owner' }) }),
}));
vi.mock('@/composable/aiAvailability', () => ({ canUseAi: () => false }));
vi.mock('@/composables/useClipRecorder', () => ({ useClipRecorder: () => ({ openRecorder: vi.fn() }) }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => store }));

import TaskDetailTab from '@/components/molecules/TaskDetailTab/TaskDetailTab.vue';

const activeProjects = { data: [{ _id: 'p1', id: 'p1', ProjectName: 'Launch' }] };

const openTask = () => shallowMount(TaskDetailTab, {
    props: { task: { _id: 't1', ProjectID: 'p1', sprintId: 's1', checklistArray: [] } },
    global: {
        provide: { $userId: ref('u1'), $companyId: ref('c1'), selectedProject: ref({ _id: 'p1', ProjectName: 'Launch' }), $clientWidth: ref(1200) },
        mocks: { $t: (key) => key },
        stubs: { CustomFieldRenderViewComponent: true, CustomFieldsSidebarComponent: true },
    },
});

describe('the task panel opened by its address', () => {
    let logged;
    beforeEach(() => {
        logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        store.getters = reactive({
            'settings/fileExtentions': [],
            'settings/companyOwnerDetail': { _id: 'u1' },
            'settings/selectedCompany': {},
            'settings/customFields': [],
            'projectData/onlyActiveProjects': [],
        });
    });
    afterEach(() => {
        logged.mockRestore();
    });

    it('opens before the project list has loaded, and reads the list once it arrives', async () => {
        let wrapper;
        expect(() => { wrapper = openTask(); }).not.toThrow();
        expect(logged).not.toHaveBeenCalled();
        expect(wrapper.vm.allProjectsArrayFilter).toEqual([]);

        store.getters['projectData/onlyActiveProjects'] = activeProjects;
        await nextTick();

        expect(wrapper.vm.allProjectsArrayFilter.map((project) => project.ProjectName)).toEqual(['Launch']);
        wrapper.unmount();
    });

    it('reads the project list that is already loaded', () => {
        store.getters['projectData/onlyActiveProjects'] = activeProjects;
        const wrapper = openTask();

        expect(wrapper.vm.allProjectsArrayFilter.map((project) => project._id)).toEqual(['p1']);
        wrapper.unmount();
    });
});
