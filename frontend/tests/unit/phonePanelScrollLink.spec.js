import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { stub } = vi.hoisted(() => ({ stub: (name) => ({ default: { name, render: () => null } }) }));

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: {} })), apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({
        checkPermission: () => true,
        checkApps: () => true,
        getAppState: () => 'enabled',
        makeUniqueId: () => 'id',
        checkBucketStorage: () => true
    }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id }) })
}));
vi.mock('@/composables/useClipRecorder', () => ({ useClipRecorder: () => ({ openRecorder: vi.fn() }) }));
vi.mock('@/composable/cloudPicker', () => ({ importCloudFile: vi.fn() }));
vi.mock('@/utils/TaskOperations', () => ({ default: {} }));
vi.mock('@/components/atom/Description/Description.vue', () => stub('Description'));
vi.mock('@/components/atom/Attachments/Attachments.vue', () => stub('Attachments'));
vi.mock('@/components/molecules/CheckList/CheckList.vue', () => stub('CheckList'));
vi.mock('@/components/organisms/SubTasks/SubTasks.vue', () => stub('SubTasks'));
vi.mock('@/components/organisms/LinkedTasks/LinkedTasks.vue', () => stub('LinkedTasks'));
vi.mock('@/components/molecules/Pages/LinkedDocs.vue', () => stub('LinkedDocs'));
vi.mock('@/components/molecules/Epics/EpicPicker.vue', () => stub('EpicPicker'));
vi.mock('@/components/molecules/TagList/CreateTagPopup.vue', () => stub('CreateTagPopup'));
vi.mock('@/components/atom/TagChip/TagChip.vue', () => stub('TagChip'));
vi.mock('@/components/molecules/PromptSidebar/PromptSidebar.vue', () => stub('PromptSidebar'));
vi.mock('@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue', () => stub('UpgradePlan'));
vi.mock('@/components/molecules/AppTeaserBlock/AppTeaserBlock.vue', () => stub('AppTeaserBlock'));
vi.mock('@/views/Projects/ProjectDetail/ProjectMemoryCard.vue', () => stub('ProjectMemoryCard'));
vi.mock('@/components/organisms/FixMilestone/FixMilestone.vue', () => stub('FixMilestone'));
vi.mock('@/components/organisms/HourlyMilestone/HourlyMilestone.vue', () => stub('HourlyMilestone'));
vi.mock('@/components/organisms/ProjectDetailRightSide/ProjectDetailRightSide.vue', () => stub('ProjectDetailRightSide'));

import TaskDetailTab from '@/components/molecules/TaskDetailTab/TaskDetailTab.vue';
import ProjectDetail from '@/views/Projects/ProjectDetail/ProjectDetail.vue';

const store = () => createStore({
    modules: {
        settings: {
            namespaced: true,
            getters: {
                fileExtentions: () => [],
                companyOwnerDetail: () => ({ userId: 'owner' }),
                selectedCompany: () => ({ planFeature: { projectDetailsView: true, customFields: true } }),
                customFields: () => []
            }
        },
        projectData: { namespaced: true, getters: { onlyActiveProjects: () => ({ data: [] }) } }
    }
});

const phone = (component, props) => mount(component, {
    props,
    global: {
        plugins: [store()],
        provide: {
            $clientWidth: ref(390),
            selectedProject: ref({ _id: 'p1', isGlobalPermission: true, tagsArray: [], ProjectType: 'Fixed' })
        },
        stubs: { CustomFieldRenderViewComponent: true, CustomFieldsSidebarComponent: true }
    }
});

describe('phone task and project panels', () => {
    it('the task panel opens on its content, with no "Scroll to Bottom" link at the top', () => {
        const wrapper = phone(TaskDetailTab, { task: { _id: 't1', sprintId: 's1', TaskName: 'Task', AssigneeUserId: [] } });
        expect(wrapper.find('.createProjectListSidebarContentWrapper').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('general.scroll_to_bottom');
        expect(wrapper.find('.btn-scroll-to-bottom').exists()).toBe(false);
    });

    it('the project detail panel opens on its content, with no "Scroll to Bottom" link at the top', () => {
        const wrapper = phone(ProjectDetail, { billingPeriod: '', activeTab: 'ProjectDetail' });
        expect(wrapper.find('.project__detail-component').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('general.scroll_to_bottom');
        expect(wrapper.find('.btn-scroll-to-bottom').exists()).toBe(false);
    });
});
