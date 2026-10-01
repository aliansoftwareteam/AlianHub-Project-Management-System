import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { reactive, ref } from 'vue';

const { apiRequest, getters, toast, push, stub } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    getters: {},
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
    push: vi.fn(() => Promise.resolve()),
    stub: (name, props = []) => ({ default: { name, props, render: () => null } })
}));

/* The real checkPermission runs here over a store this spec fills, and nothing provides `selectedProject`:
   the entry shows only if it is judged on the rules of the company, as the server judges it. */
vi.mock('@/store/index', () => ({ default: { getters } }));
vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));
vi.mock('@/utils/storageQueryBuild', () => ({ storageQueryBuilder: vi.fn() }));
vi.mock('@/composable/commonFunction', () => ({ isBundledPriorityImage: vi.fn() }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vue-router', () => ({
    useRouter: () => ({ push, replace: vi.fn(() => Promise.resolve()), hasRoute: () => false }),
    useRoute: () => reactive({ params: { cid: 'c1' }, query: {} })
}));
vi.mock('@/views/Projects/helper', () => ({ useProjectsHelper: () => ({ dispatchProjects: vi.fn(() => Promise.resolve()) }) }));
vi.mock('@/views/Projects/composables/useProjectLifecycle', () => ({
    useProjectLifecycle: () => ({ archive: vi.fn(), showSpinner: ref(false), updateProject: vi.fn(), markProjectFavourite: vi.fn() })
}));
vi.mock('@/views/Projects/ProjectsListing/useProjectHealth', () => ({
    deriveHealth: () => ({ key: 'unknown', label: '', bySource: '', reasons: [] }),
    loadProjectSnapshot: vi.fn(),
    projectSnapshot: () => null,
    sprintWindow: () => null
}));
vi.mock('@/components/organisms/CreateProject/CreateProjectSidebar.vue', () => stub('CreateProjectSidebar'));
vi.mock('@/components/organisms/AiProjectCreator/AiProjectCreator.vue', () => stub('AiProjectCreator'));
vi.mock('@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue', () => stub('ConfirmationSidebar'));

import * as env from '@/config/env';
import en from '@/locales/en';
import SaveProjectTemplateDialog from '@/components/molecules/SaveProjectTemplateDialog/SaveProjectTemplateDialog.vue';
import ProjectActionsBar from '@/views/Projects/components/ProjectActionsBar.vue';
import ProjectsListPage from '@/views/Projects/ProjectsListing/ProjectsListPage.vue';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const MEMBER = 3;
const OTHER_KEYS = ['project_name_edit', 'project_assignee', 'project_close', 'project_delete'];
const role = (permission) => ({ roles: [{ key: MEMBER, permission }] });
const rulesGranting = (permission) => ({
    project: { project_create: role(permission), ...Object.fromEntries(OTHER_KEYS.map((key) => [key, role(false)])) },
    settings: { settings_security_permissions: role(false) }
});
const ALPHA = { _id: 'p1', ProjectName: 'Alpha', isGlobalPermission: true, isPrivateSpace: false, deletedStatusKey: 0, favouriteTasks: [], watchers: {} };
const SAVED = { _id: 't1', name: 'Alpha', description: '', everyone: true, counts: { folders: 2, lists: 3, tasks: 0, automations: 0 } };
const NOTHING_EXTRA = { tasks: false, assignees: false, dates: false, automations: false };

const store = () => createStore({
    getters: {
        'settings/finalCustomFields': () => [],
        'projectData/allProjects': () => ({ data: [ALPHA, { ...ALPHA, _id: 'mine', ProjectName: 'My list', isPersonal: true }] }),
        'settings/selectedCompany': () => ({}),
        'settings/companyUsers': () => [],
        'users/users': () => [],
        'settings/companyUserDetail': () => getters['settings/companyUserDetail']
    },
    mutations: { 'projectData/mutateProjects': () => {}, 'settings/mutateFinalCustomFields': () => {} }
});

const mounted = [];
const keep = (wrapper) => { mounted.push(wrapper); return wrapper; };
const openDialog = (project = ALPHA) => keep(mount(SaveProjectTemplateDialog, {
    props: { project },
    attachTo: document.body,
    global: { plugins: [store()], mocks: { $t: i18n.global.t } }
}));

const dialog = () => document.body.querySelector('[role="dialog"]');
const field = (name) => dialog().querySelector(`[data-field="${name}"]`);
const tick = async (name) => { field(name).click(); await flushPromises(); };
const type = async (name, value) => { const input = field(name); input.value = value; input.dispatchEvent(new Event('input')); await flushPromises(); };
const submit = async () => { dialog().querySelector('[data-action="save"]').click(); await flushPromises(); };
const posts = () => apiRequest.mock.calls.filter(([method]) => method === 'post');
const answer = (data) => ({ data: { status: true, data: { template: SAVED, notes: [], ...data } } });
const refusal = (status, statusText) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { status: false, statusText } } });

beforeEach(() => {
    apiRequest.mockReset();
    push.mockClear();
    Object.values(toast).forEach((spy) => spy.mockClear());
    Object.assign(getters, {
        'settings/companyUserDetail': { roleType: MEMBER },
        'settings/rules': rulesGranting(true),
        'settings/projectRules': rulesGranting(false)
    });
});
afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    document.body.innerHTML = '';
});

describe('the save-as-template dialog', () => {
    it('opens with the name of the project, nothing extra ticked, and offered to everyone for a public project', () => {
        openDialog();
        expect(dialog().getAttribute('aria-modal')).toBe('true');
        expect(field('name').value).toBe('Alpha');
        expect(field('description').value).toBe('');
        expect(['tasks', 'assignees', 'dates', 'automations'].map((name) => field(name).checked)).toEqual([false, false, false, false]);
        expect(field('everyone').checked).toBe(true);
    });

    it('opens kept to the person saving, owners and admins for a private project', () => {
        openDialog({ ...ALPHA, isPrivateSpace: true });
        expect(field('everyone').checked).toBe(false);
    });

    it('offers the assignees only with the tasks they are on', async () => {
        openDialog();
        expect(field('assignees').disabled).toBe(true);
        await tick('tasks');
        expect(field('assignees').disabled).toBe(false);
        await tick('assignees');
        await tick('tasks');
        expect(field('assignees').checked).toBe(false);
    });

    it('sends the name, the description and the choices, says it is saved and closes without leaving the page', async () => {
        apiRequest.mockResolvedValue(answer({ template: { ...SAVED, name: 'Launch plan' } }));
        const wrapper = openDialog();
        await type('name', '  Launch plan ');
        await type('description', ' How we launch ');
        await tick('tasks');
        await tick('assignees');
        await tick('dates');
        await tick('automations');
        await tick('everyone');
        await submit();
        expect(posts()).toEqual([['post', `${env.PROJECTS_V2}/p1/template`, {
            name: 'Launch plan', description: 'How we launch', everyone: false,
            include: { tasks: true, assignees: true, dates: true, automations: true }
        }]]);
        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(toast.success.mock.calls[0][0]).toContain('Launch plan');
        expect(wrapper.emitted('close')).toHaveLength(1);
        expect(push).not.toHaveBeenCalled();
    });

    it('sends nothing extra unless it is ticked', async () => {
        apiRequest.mockResolvedValue(answer());
        openDialog();
        await submit();
        expect(posts()[0][2]).toEqual({ name: 'Alpha', description: '', everyone: true, include: NOTHING_EXTRA });
    });

    it('does not send an empty name', async () => {
        openDialog();
        await type('name', '   ');
        await submit();
        expect(posts()).toHaveLength(0);
        expect(dialog().querySelector('[role="alert"]').textContent).toContain('Give the template a name.');
    });

    it('shows the reason the server gives and stays open', async () => {
        apiRequest.mockRejectedValue(refusal(400, 'A template holds at most 2,000 tasks and this project has 2,400. Save it without its tasks.'));
        const wrapper = openDialog();
        await submit();
        expect(dialog().querySelector('[role="alert"]').textContent).toContain('at most 2,000 tasks');
        expect(wrapper.emitted('close')).toBeUndefined();
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('falls back to its own words when the server gives none', async () => {
        apiRequest.mockRejectedValue(new Error('Network Error'));
        openDialog();
        await submit();
        expect(dialog().querySelector('[role="alert"]').textContent).toContain('The template could not be saved.');
    });

    it('says what was left out of the template', async () => {
        apiRequest.mockResolvedValue(answer({ notes: [{ code: 'private_lists_left', count: 2 }, { code: 'automations_skipped', count: 3 }, { code: 'tasks_left_out', count: 4 }] }));
        openDialog();
        await submit();
        const said = toast.info.mock.calls.map(([text]) => text).join(' | ');
        expect(toast.info).toHaveBeenCalledTimes(3);
        expect(said).toContain('2');
        expect(said).toContain('3');
        expect(said).toContain('4');
    });

    it('sends once however often the button is pressed, and stays until the answer is in', async () => {
        let release;
        apiRequest.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        const wrapper = openDialog();
        dialog().querySelector('[data-action="save"]').click();
        dialog().querySelector('[data-action="save"]').click();
        await flushPromises();
        expect(dialog().querySelector('[data-action="save"]').disabled).toBe(true);
        expect(dialog().querySelector('[data-action="cancel"]').disabled).toBe(true);
        dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(wrapper.emitted('close')).toBeUndefined();
        expect(posts()).toHaveLength(1);
        release(answer());
        await flushPromises();
        expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('closes on Cancel and on Escape without sending', async () => {
        const wrapper = openDialog();
        dialog().querySelector('[data-action="cancel"]').click();
        dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await flushPromises();
        expect(wrapper.emitted('close')).toHaveLength(2);
        expect(posts()).toHaveLength(0);
    });
});

describe('where Save as template is offered', () => {
    const DropDown = { name: 'DropDown', template: '<div><slot name="button" :triggerAttrs="{}" /><slot name="options" /></div>' };
    const DropDownOption = { name: 'DropDownOption', emits: ['click'], template: '<div class="dd-option" @click="$emit(\'click\')"><slot /></div>' };
    const bar = (projectData = ALPHA) => keep(mount(ProjectActionsBar, {
        props: { projectData, clientWidth: 1280 },
        attachTo: document.body,
        global: { plugins: [store()], mocks: { $t: i18n.global.t }, stubs: { DropDown, DropDownOption, Assignee: true, WasabiImage: true } }
    }));
    const page = () => {
        apiRequest.mockResolvedValue({ data: { status: true, data: [] } });
        return keep(mount(ProjectsListPage, { attachTo: document.body, global: { plugins: [store()], mocks: { $t: i18n.global.t }, stubs: { 'router-link': true } } }));
    };
    const rowEntry = async (wrapper, at) => {
        await wrapper.findAll('.pl2__dots')[at].trigger('click');
        return wrapper.find('[data-test="save-project-template"]');
    };

    it('in the project menu, next to Duplicate project, to someone who may create a project', async () => {
        const wrapper = bar();
        const entries = wrapper.findAll('.dd-option').map((option) => option.text());
        expect(entries.indexOf('Save as template')).toBe(entries.indexOf('Duplicate project') + 1);
        expect(dialog()).toBeNull();
        await wrapper.find('[data-test="save-project-template"]').trigger('click');
        expect(field('name').value).toBe('Alpha');
    });

    it('in the project menu of a project with its own rules, still by the rules of the company', () => {
        expect(bar({ ...ALPHA, isGlobalPermission: false }).find('[data-test="save-project-template"]').exists()).toBe(true);
    });

    it('not to someone who may not create a project', async () => {
        getters['settings/rules'] = rulesGranting(false);
        getters['settings/projectRules'] = rulesGranting(true);
        expect(bar().find('[data-test="save-project-template"]').exists()).toBe(false);
        expect((await rowEntry(page(), 0)).exists()).toBe(false);
    });

    it('not for a personal list', () => {
        expect(bar({ ...ALPHA, isPersonal: true }).find('[data-test="save-project-template"]').exists()).toBe(false);
    });

    it('in the row menu of the project list', async () => {
        const wrapper = page();
        const entry = await rowEntry(wrapper, 0);
        expect(entry.text()).toBe('Save as template');
        await entry.trigger('click');
        expect(field('name').value).toBe('Alpha');
        expect(wrapper.find('.pl2__pop--row').exists()).toBe(false);
    });
});
