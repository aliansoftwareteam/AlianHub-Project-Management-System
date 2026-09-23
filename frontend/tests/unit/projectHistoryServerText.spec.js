import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

const { apiRequest, toast, commit } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
    commit: vi.fn()
}));

vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/store/index', () => ({ default: { getters: {}, commit: vi.fn() } }));
vi.mock('vuex', () => ({
    createStore: () => ({ getters: {}, dispatch: vi.fn(), commit }),
    useStore: () => ({ commit, getters: { 'settings/companyOwnerDetail': { userId: 'owner-1' } } })
}));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ sanitizeInput: (value) => value }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, _id: id, Employee_Name: 'Ada', companyOwnerId: 'owner-1' }) }),
    useHistoryNotification: () => ({ addHistory: (obj) => apiRequest('post', '/api/v1/handleHistory', obj), addNotification: (obj) => apiRequest('post', '/api/v1/handleNotification', obj) })
}));
vi.mock('@/composable/projects', () => ({ useProjects: () => ({ markFavourite: vi.fn() }) }));
vi.mock('@/composable/Validation', () => ({ useValidation: () => ({ checkAllFields: () => Promise.resolve(true) }) }));

import * as env from '@/config/env';
import { useProjectNameEdit } from '@/views/Projects/composables/useProjectNameEdit';
import { useProjectLifecycle } from '@/views/Projects/composables/useProjectLifecycle';
import { useProjectAssignee } from '@/views/Projects/composables/useProjectAssignee';
import { HandleProject } from '@/components/templates/CreateProject/helper';

const project = () => ({
    _id: 'project-1',
    ProjectName: 'Apollo',
    AssigneeUserId: ['user-1'],
    LeadUserId: [],
    projectStatusData: [{ value: 'active', type: 'default_active' }, { value: 'closed', type: 'close' }]
});

const withComposable = (use) => {
    let api;
    mount(defineComponent({ setup() { api = use(); return () => h('div'); } }), {
        global: { provide: { $userId: ref('user-1'), $companyId: ref('company-1') } }
    });
    return api;
};

const postedText = () => apiRequest.mock.calls.filter(([method, url]) => method === 'post' && [env.HANDLE_HISTORY, env.HANDLE_NOTIFICATION].includes(url));

beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation(() => Promise.resolve({ status: 200, data: { status: true, statusText: '' } }));
    commit.mockReset();
});

describe('project changes leave their history and notification text to the server', () => {
    it('a rename saves the name and posts no text', async () => {
        const data = ref(project());
        const edit = withComposable(() => useProjectNameEdit(data));
        edit.projectName.value.value = 'Apollo Two';
        edit.updateProjectName();
        await flushPromises();

        expect(apiRequest).toHaveBeenCalledWith('put', `/api/v1/${env.PROJECTACTIONS}/project-1`, { updateObject: { ProjectName: 'Apollo Two' } });
        expect(postedText()).toEqual([]);
    });

    it('closing saves the status and posts no text', async () => {
        const data = ref(project());
        const lifecycle = withComposable(() => useProjectLifecycle(data));
        lifecycle.archive.value = 0;
        await lifecycle.updateProject();
        await flushPromises();

        expect(apiRequest).toHaveBeenCalledWith('put', `/api/v1/${env.PROJECTACTIONS}/project-1`, { updateObject: { status: 'closed', statusType: 'close' } });
        expect(postedText()).toEqual([]);
    });

    it('adding an assignee saves the member and posts no text', async () => {
        const data = ref(project());
        const assignee = withComposable(() => useProjectAssignee(data));
        await assignee.changeAssignee('add', { id: 'user-2', label: 'Grace' });
        await flushPromises();

        expect(apiRequest).toHaveBeenCalledWith('put', `/api/v1/${env.PROJECTACTIONS}/project-1`, { updateObject: { AssigneeUserId: 'user-2' }, key: '$addToSet' });
        expect(postedText()).toEqual([]);
    });

    it('creating a project posts the project and nothing else', async () => {
        apiRequest.mockImplementation(() => Promise.resolve({ data: { status: true, data: { _id: 'project-9', ProjectName: 'Zephyr' } } }));
        const result = await HandleProject('', { ProjectName: 'Zephyr' }, { id: 'user-1', Employee_Name: 'Ada' }, 'company-1', false);
        await flushPromises();

        expect(result).toMatchObject({ status: true, id: 'project-9' });
        expect(apiRequest.mock.calls.map(([method, url]) => [method, url])).toEqual([['post', env.CREATE_PROJECT]]);
    });
});
