import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';

const apiRequest = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({ getters: {}, dispatch: null }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/views/MilestoneReport/MilestoneReport.css', () => ({}));
vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal()), useI18n: () => ({ t: (key) => key }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true }),
    useGetterFunctions: () => ({ getTeamsData: () => Promise.resolve([]) }),
}));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => store }));

import MilestoneReport from '@/views/MilestoneReport/MilestoneReport.vue';

const project = { _id: 'p1', ProjectCurrency: { name: 'Dollar', symbol: '$', code: 'USD' } };

const openReport = async ({ projectsLoaded }) => {
    store.getters = {
        'settings/selectedCompany': { planFeature: { milstoneReport: true } },
        'settings/companyUserDetail': { userId: 'u1', roleType: 1 },
        'settings/projectMilestoneStatus': [],
        'settings/rules': { toggle: { showAllProjects: true } },
        'projectData/allProjects': projectsLoaded ? { data: [project] } : {},
    };
    store.dispatch = vi.fn(() => {
        store.getters['projectData/allProjects'] = { data: [project] };
        return Promise.resolve();
    });
    const wrapper = shallowMount(MilestoneReport, {
        global: { provide: { $clientWidth: 1200, $companyId: 'c1' }, mocks: { $t: (key) => key }, stubs: { 'router-link': true } },
    });
    await flushPromises();
    return wrapper;
};

describe('the milestone report opening', () => {
    let logged;
    beforeEach(() => {
        logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        logged.mockRestore();
        apiRequest.mockReset();
    });

    it.each([
        ['before the projects are loaded', false],
        ['with the projects already loaded', true],
    ])('logs nothing when no project has a milestone, %s', async (_, projectsLoaded) => {
        apiRequest.mockResolvedValue({ status: 200, data: [] });
        const wrapper = await openReport({ projectsLoaded });

        expect(apiRequest).toHaveBeenCalledTimes(1);
        expect(logged).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    it('logs the failure itself when the report request fails', async () => {
        const failure = new Error('report unavailable');
        apiRequest.mockRejectedValue(failure);
        const wrapper = await openReport({ projectsLoaded: false });

        expect(logged).toHaveBeenCalledWith(failure);
        wrapper.unmount();
    });
});
