import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { nextTick } from 'vue';

const { apiRequest, create, route, ensure } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    create: vi.fn(),
    route: { name: 'Home', params: {}, query: {} },
    ensure: vi.fn()
}));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn(() => Promise.resolve()) }) }));
vi.mock('@/utils/TaskOperations', () => ({ default: { create } }));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn() }));
vi.mock('@/components/molecules/Home/usePersonalList', () => ({ usePersonalList: () => ({ ensure }) }));
vi.mock('@/composable/commonFunction', () => ({ taskPlanPermission: () => ({ checkTaskPerSprintPermisssion: () => Promise.resolve(true) }) }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: () => true }),
    useGetterFunctions: () => ({ getUser: (id) => ({ id, _id: id, Employee_Name: `User ${id}` }) })
}));

import { closeQuickCreate, openQuickCreate } from '@/components/organisms/QuickCreateTask/quickCreateTask';
import QuickCreateTask from '@/components/organisms/QuickCreateTask/QuickCreateTask.vue';
import TaskTemplateDialog from '@/components/molecules/TaskTemplates/TaskTemplateDialog.vue';
import { dueDayFromOffset, renderTitle } from '@/components/molecules/TaskTemplates/taskTemplates';

const STATUSES = [{ name: 'To Do', key: 1, value: 'to_do', type: 'default_active' }];
const TYPES = [{ key: 1, value: 'task', name: 'Task' }, { key: 2, value: 'bug', name: 'Bug' }];
const ALPHA = {
    _id: 'alpha', ProjectName: 'Alpha', CompanyId: 'company-1', ProjectCode: 'AL', lastTaskId: 1, apps: [{ key: 'Priority' }],
    taskStatusData: STATUSES, taskTypeCounts: TYPES, AssigneeUserId: ['user-1'], isGlobalPermission: true, statusType: 'active'
};
const TEMPLATES = [
    { _id: 'tpl-plain', name: 'Plain', scope: 'workspace', isDefault: false, canManage: false, Task_Priority: '', TaskTypeKey: null, dueOffsetDays: null, startOffsetDays: null, titlePattern: '' },
    { _id: 'tpl-default', name: 'Release', scope: 'project', isDefault: true, canManage: true, Task_Priority: 'HIGH', TaskType: 'bug', TaskTypeKey: 2, dueOffsetDays: 3, startOffsetDays: null, titlePattern: 'Release {date}' }
];

const store = () => createStore({
    modules: {
        projectData: { namespaced: true, getters: { allProjects: () => ({ data: [ALPHA] }) }, mutations: { mutateSprints: vi.fn() } },
        settings: {
            namespaced: true,
            getters: {
                companyUserDetail: () => ({ roleType: 3 }),
                rules: () => ({ task: {} }),
                projectRawRules: () => [],
                selectedCompany: () => ({ planFeature: { projectProjectApp: true } }),
                companyOwnerDetail: () => ({ userId: 'owner-1' }),
                companyPriority: () => [{ name: 'High', value: 'HIGH' }, { name: 'Medium', value: 'MEDIUM' }, { name: 'Low', value: 'LOW' }]
            }
        }
    }
});

const $ = (selector) => {
    const el = document.body.querySelector(selector);
    return el ? new DOMWrapper(el) : { exists: () => false };
};

const mounted = [];
const templatesResponse = (list = TEMPLATES) => Promise.resolve({ data: { status: true, data: list } });

beforeEach(() => {
    closeQuickCreate();
    try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* jsdom storage */ }
    apiRequest.mockReset();
    apiRequest.mockImplementation((type, url) => {
        if (url.includes('collection=sprints')) return Promise.resolve({ data: [{ _id: 'alpha-s1', name: 'Alpha list', value: 1 }] });
        if (url.includes('collection=folders')) return Promise.resolve({ data: [] });
        if (type === 'get' && url.startsWith('/api/v2/task-templates')) return templatesResponse();
        if (url.includes('/apply')) return Promise.resolve({ data: { status: true, data: { applied: [], conflicts: [], skipped: [] } } });
        return Promise.resolve({ data: {} });
    });
    create.mockReset();
    create.mockResolvedValue({ status: true, id: 'new-task-1' });
    ensure.mockReset();
    ensure.mockResolvedValue({ project: null, sprint: null });
});

afterEach(() => {
    mounted.splice(0).forEach((w) => w.unmount());
    closeQuickCreate();
});

describe('template helpers', () => {
    it('fills {title} and {date} in a title pattern', () => {
        expect(renderTitle('Release {date}', { date: '2026-10-01' })).toBe('Release 2026-10-01');
        expect(renderTitle('Bug: {title}', { title: 'Login fails' })).toBe('Bug: Login fails');
        expect(renderTitle('', { title: 'Kept' })).toBe('Kept');
    });

    it('turns a day offset into a local day', () => {
        expect(dueDayFromOffset(3, new Date(2026, 9, 1, 15, 0))).toBe('2026-10-04');
        expect(dueDayFromOffset(null, new Date(2026, 9, 1))).toBe('');
    });
});

describe('the template picker in the create dialog', () => {
    const mountDialog = async () => {
        const wrapper = mount(QuickCreateTask, { attachTo: document.body, global: { plugins: [store()], stubs: { ShellIcon: true } } });
        mounted.push(wrapper);
        openQuickCreate({ projectId: 'alpha' });
        await flushPromises();
        await nextTick();
        await flushPromises();
        return wrapper;
    };

    it('lists the project\'s templates and preselects its default', async () => {
        await mountDialog();
        const picker = $('[data-field="template"]');
        expect(picker.exists()).toBe(true);
        expect(picker.findAll('option').map((o) => o.attributes('value'))).toEqual(['', 'tpl-plain', 'tpl-default']);
        expect(picker.element.value).toBe('tpl-default');
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/task-templates?projectId=alpha');
    });

    it('prefills the title, priority and due date from the chosen template', async () => {
        await mountDialog();
        expect($('[data-field="title"]').element.value).toMatch(/^Release \d{4}-\d{2}-\d{2}$/);
        expect($('[data-field="priority"]').element.value).toBe('HIGH');
        expect($('[data-field="due"]').element.value).toBe(dueDayFromOffset(3, new Date()));
    });

    it('creates the task with the template\'s type, then applies the rest of the template to it', async () => {
        await mountDialog();
        await $('[data-field="title"]').setValue('Ship it');
        await $('[data-field="title"]').trigger('keydown', { key: 'Enter' });
        await flushPromises();
        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0][0].data).toMatchObject({ TaskName: 'Ship it', TaskType: 'bug', TaskTypeKey: 2, Task_Priority: 'HIGH' });
        const apply = apiRequest.mock.calls.find(([, url]) => url === '/api/v2/task-templates/tpl-default/apply');
        expect(apply).toBeTruthy();
        expect(apply[0]).toBe('post');
        expect(apply[2]).toMatchObject({ taskId: 'new-task-1', overwrite: [] });
        expect(apply[2].applyDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(typeof apply[2].tzOffsetMinutes).toBe('number');
    });

    it('creates a plain task when the template is cleared', async () => {
        await mountDialog();
        await $('[data-field="template"]').setValue('');
        await $('[data-field="title"]').setValue('No template');
        await $('[data-field="title"]').trigger('keydown', { key: 'Enter' });
        await flushPromises();
        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0][0].data.TaskTypeKey).toBe(1);
        expect(apiRequest.mock.calls.some(([, url]) => url.includes('/apply'))).toBe(false);
    });
});

describe('applying a template to an existing task', () => {
    const TASK = { _id: 'task-1', ProjectID: 'alpha', TaskName: 'Next release', Task_Priority: 'LOW' };
    const conflicts = [{ field: 'priority', current: 'LOW', template: 'HIGH' }, { field: 'type', current: 'Task', template: 'Bug' }];

    const mountApply = async () => {
        apiRequest.mockImplementation((type, url, body) => {
            if (type === 'get') return templatesResponse();
            if (url.endsWith('/apply') && body && body.preview) return Promise.resolve({ data: { status: true, data: { applied: ['description'], conflicts, skipped: [] } } });
            if (url.endsWith('/apply')) return Promise.resolve({ data: { status: true, data: { applied: ['description'], conflicts: [], skipped: [] } } });
            return Promise.resolve({ data: {} });
        });
        const wrapper = mount(TaskTemplateDialog, { attachTo: document.body, props: { open: true, mode: 'apply', task: TASK, project: ALPHA }, global: { plugins: [store()] } });
        mounted.push(wrapper);
        await flushPromises();
        return wrapper;
    };

    it('shows what the template would replace, unticked', async () => {
        const wrapper = await mountApply();
        await wrapper.find('[data-template="tpl-default"]').trigger('click');
        await flushPromises();
        const preview = apiRequest.mock.calls.find(([, url, body]) => url === '/api/v2/task-templates/tpl-default/apply' && body.preview);
        expect(preview[2]).toMatchObject({ taskId: 'task-1', preview: true });
        const boxes = wrapper.findAll('[data-overwrite]');
        expect(boxes.map((b) => b.attributes('data-overwrite'))).toEqual(['priority', 'type']);
        expect(boxes.every((b) => b.element.checked === false)).toBe(true);
    });

    it('merges without overwriting unless a field is ticked', async () => {
        const wrapper = await mountApply();
        await wrapper.find('[data-template="tpl-default"]').trigger('click');
        await flushPromises();
        await wrapper.find('[data-action="apply"]').trigger('click');
        await flushPromises();
        const applied = apiRequest.mock.calls.filter(([, url, body]) => url === '/api/v2/task-templates/tpl-default/apply' && !body.preview);
        expect(applied).toHaveLength(1);
        expect(applied[0][2]).toMatchObject({ taskId: 'task-1', overwrite: [] });
        expect(wrapper.emitted('applied')).toBeTruthy();
    });

    it('overwrites only the fields the user ticked', async () => {
        const wrapper = await mountApply();
        await wrapper.find('[data-template="tpl-default"]').trigger('click');
        await flushPromises();
        await wrapper.find('[data-overwrite="priority"]').setValue(true);
        await wrapper.find('[data-action="apply"]').trigger('click');
        await flushPromises();
        const applied = apiRequest.mock.calls.filter(([, url, body]) => url.endsWith('/apply') && !body.preview);
        expect(applied[0][2].overwrite).toEqual(['priority']);
    });

    it('is a labelled modal dialog that closes on Escape', async () => {
        const wrapper = await mountApply();
        const dialog = wrapper.find('[role="dialog"]');
        expect(dialog.attributes('aria-modal')).toBe('true');
        expect(document.getElementById(dialog.attributes('aria-labelledby'))).not.toBeNull();
        await dialog.trigger('keydown', { key: 'Escape' });
        expect(wrapper.emitted('close')).toBeTruthy();
    });
});

describe('saving a task as a template', () => {
    it('sends the name, scope and chosen parts for the task', async () => {
        const wrapper = mount(TaskTemplateDialog, {
            attachTo: document.body,
            props: { open: true, mode: 'save', task: { _id: 'task-1', ProjectID: 'alpha', TaskName: 'Release notes' }, project: ALPHA },
            global: { plugins: [store()] }
        });
        mounted.push(wrapper);
        await flushPromises();
        expect(wrapper.find('[data-field="template-name"]').element.value).toBe('Release notes');
        await wrapper.find('[data-field="template-name"]').setValue('Release');
        await wrapper.find('[data-include="subtaskAssignees"]').setValue(false);
        await wrapper.find('[data-action="save"]').trigger('click');
        await flushPromises();
        const save = apiRequest.mock.calls.find(([type, url]) => type === 'post' && url === '/api/v2/task-templates');
        expect(save[2]).toMatchObject({ taskId: 'task-1', name: 'Release', scope: 'project' });
        expect(save[2].include.subtaskAssignees).toBe(false);
        expect(save[2].include.checklist).toBe(true);
    });

    it('offers the workspace scope only to owners and admins', async () => {
        const wrapper = mount(TaskTemplateDialog, {
            attachTo: document.body,
            props: { open: true, mode: 'save', task: { _id: 'task-1', ProjectID: 'alpha', TaskName: 'x' }, project: ALPHA },
            global: { plugins: [store()] }
        });
        mounted.push(wrapper);
        await flushPromises();
        expect(wrapper.find('[data-scope="workspace"]').element.disabled).toBe(true);
    });
});
