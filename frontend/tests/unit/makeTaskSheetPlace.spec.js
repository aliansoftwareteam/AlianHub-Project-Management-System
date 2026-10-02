import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/utils/TaskOperations', () => ({ default: { create: vi.fn() } }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: (id) => ({ id, Employee_Name: id }) }) }));
vi.mock('@/composable/commonFunction', () => ({ taskPlanPermission: () => ({ checkTaskPerSprintPermisssion: () => Promise.resolve(true) }) }));

import MakeTaskSheet from '@/components/organisms/MainChat/MakeTaskSheet.vue';
import { rememberCreated } from '@/components/organisms/QuickCreateTask/placeInference';

const STATUSES = [{ name: 'To Do', key: 1, value: 'to_do', type: 'default_active' }];
const TYPES = [{ key: 1, value: 'task', name: 'Task' }];
const project = (id) => ({ _id: id, ProjectName: `Project ${id}`, CompanyId: 'company-1', taskStatusData: STATUSES, taskTypeCounts: TYPES });
const LISTS = {
    alpha: [{ _id: 'alpha-s1', name: 'One', value: 1 }, { _id: 'alpha-s2', name: 'Two', value: 2 }],
    beta: [{ _id: 'beta-s1', name: 'One', value: 1 }, { _id: 'beta-s2', name: 'Two', value: 2 }]
};

const mounted = [];
const mountSheet = async (props = {}) => {
    const store = createStore({
        getters: { 'projectData/onlyActiveProjects': () => ({ data: [project('alpha'), project('beta')] }), 'settings/companyOwnerDetail': () => ({}) },
        actions: { 'projectData/setSprints': (_, { projectId }) => LISTS[projectId], 'projectData/setFolders': () => [] }
    });
    const wrapper = mount(MakeTaskSheet, {
        props: { initialTitle: 'Call supplier', ...props },
        global: { plugins: [store], provide: { $companyId: { value: 'company-1' }, $userId: { value: 'user-1' } }, mocks: { $t: (k) => k }, stubs: { ShellIcon: true, Teleport: true } },
        attachTo: document.body
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};
const selects = (wrapper) => wrapper.findAll('select');

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockResolvedValue({ data: { status: true, data: [] } });
    try { localStorage.clear(); } catch (e) { /* jsdom storage */ }
});
afterEach(() => mounted.splice(0).forEach((w) => w.unmount()));

describe('the place filled in for a message turned into a task', () => {
    it('is the project and list of the last task made, when the chat names no project', async () => {
        rememberCreated('company-1', 'user-1', { projectId: 'beta', sprintId: 'beta-s2', assigneeId: '', due: '' });
        const wrapper = await mountSheet();
        const [project, list] = selects(wrapper);
        expect(project.element.value).toBe('beta');
        expect(list.element.value).toBe('beta-s2');
    });

    it('is the project the chat is linked to, with that project\'s last list', async () => {
        rememberCreated('company-1', 'user-1', { projectId: 'alpha', sprintId: 'alpha-s2', assigneeId: '', due: '' });
        const wrapper = await mountSheet({ defaultProjectId: 'alpha' });
        const [project, list] = selects(wrapper);
        expect(project.element.value).toBe('alpha');
        expect(list.element.value).toBe('alpha-s2');
    });

    it('does not use the last list of another project', async () => {
        rememberCreated('company-1', 'user-1', { projectId: 'beta', sprintId: 'beta-s2', assigneeId: '', due: '' });
        const wrapper = await mountSheet({ defaultProjectId: 'alpha' });
        const [project, list] = selects(wrapper);
        expect(project.element.value).toBe('alpha');
        expect(list.element.value).toBe('');
    });
});
