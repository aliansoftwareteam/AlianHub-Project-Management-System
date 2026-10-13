import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount } from '@vue/test-utils';

const { apiRequest, getters, commit, access } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    getters: {},
    commit: vi.fn(),
    access: { details: true },
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vuex', async (importOriginal) => ({ ...(await importOriginal()), useStore: () => ({ getters, commit }) }));
vi.mock('@/composable', () => ({
    useConvertDate: () => ({ convertDateFormat: (value) => String(value) }),
    useCustomComposable: () => ({ checkPermission: (key) => (key === 'project.project_details' ? access.details : true), checkApps: () => false, getAppState: () => 'hidden' }),
    useGetterFunctions: () => ({ getUser: () => ({}) }),
}));

import ProjectDetailRightSide from '@/components/organisms/ProjectDetailRightSide/ProjectDetailRightSide.vue';
import ProjectWorkingDays from '@/components/molecules/WorkingDaysPicker/ProjectWorkingDays.vue';

const COMPANY = { _id: 'company-1', workingDays: [1, 2, 3, 4, 5, 6] };
const PROJECT = { _id: 'project-1', ProjectName: 'Launch', status: 'open', isGlobalPermission: true, ProjectCurrency: { symbol: '$' }, AssigneeUserId: [], skills: [] };

const open = (project = PROJECT) => {
    getters['settings/selectedCompany'] = COMPANY;
    getters['settings/customFields'] = [];
    getters['settings/teams'] = [];
    getters['users/users'] = [];
    return shallowMount(ProjectDetailRightSide, {
        props: { projectData: project },
        global: { stubs: { CustomFieldProjectDetailView: true, CustomFieldsSidebarComponent: true } },
    });
};

describe('Project details panel working days', () => {
    beforeEach(() => {
        apiRequest.mockReset();
        commit.mockReset();
        access.details = true;
    });

    it('hands the control the project, the company and the edit right', () => {
        const control = open().findComponent(ProjectWorkingDays);
        expect(control.props()).toMatchObject({ project: PROJECT, company: COMPANY, editable: true });
    });

    it('locks the control for someone who may only read the project details', () => {
        access.details = false;
        expect(open().findComponent(ProjectWorkingDays).props('editable')).toBe(false);
    });

    it('saves an override on the project and updates the store', async () => {
        apiRequest.mockResolvedValue({ status: 200 });
        const wrapper = open();
        wrapper.findComponent(ProjectWorkingDays).vm.$emit('update', [0, 1, 2, 3, 4]);
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('put', '/api/v1/project/project-1', { updateObject: { workingDays: [0, 1, 2, 3, 4] } });
        expect(commit).toHaveBeenCalledWith('projectData/projectLocalUpdate', { itemData: { ...PROJECT, workingDays: [0, 1, 2, 3, 4] } });
    });

    it('sends null to go back to the company\'s week', async () => {
        apiRequest.mockResolvedValue({ status: 200 });
        const wrapper = open({ ...PROJECT, workingDays: [0, 1, 2, 3, 4] });
        wrapper.findComponent(ProjectWorkingDays).vm.$emit('update', null);
        await flushPromises();
        expect(apiRequest.mock.calls[0][2]).toEqual({ updateObject: { workingDays: null } });
    });

    it('leaves the store alone when the save is refused', async () => {
        apiRequest.mockRejectedValue(new Error('refused'));
        const wrapper = open();
        wrapper.findComponent(ProjectWorkingDays).vm.$emit('update', [6]);
        await flushPromises();
        expect(commit).not.toHaveBeenCalled();
    });
});
