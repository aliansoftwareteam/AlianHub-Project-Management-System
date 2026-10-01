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
import DuplicateProjectDialog from '@/components/molecules/DuplicateProjectDialog/DuplicateProjectDialog.vue';
import ProjectActionsBar from '@/views/Projects/components/ProjectActionsBar.vue';
import ProjectsListPage from '@/views/Projects/ProjectsListing/ProjectsListPage.vue';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const MEMBER = 3;
const rulesGranting = (permission) => ({ project: { project_create: { roles: [{ key: MEMBER, permission }] } } });
const ALPHA = { _id: 'p1', ProjectName: 'Alpha', isGlobalPermission: true, deletedStatusKey: 0, favouriteTasks: [], watchers: {} };
const COPY = { _id: 'p2', ProjectName: 'Alpha (copy)', ProjectCode: 'ALP2' };

const commits = [];
const store = () => createStore({
    getters: {
        'projectData/allProjects': () => ({ data: [ALPHA, { ...ALPHA, _id: 'mine', ProjectName: 'My list', isPersonal: true }] }),
        'settings/selectedCompany': () => ({}),
        'settings/companyUserDetail': () => getters['settings/companyUserDetail']
    },
    mutations: { 'projectData/mutateProjects': (state, payload) => commits.push(payload) }
});

const mounted = [];
const keep = (wrapper) => { mounted.push(wrapper); return wrapper; };
const openDialog = (project = ALPHA) => keep(mount(DuplicateProjectDialog, {
    props: { project },
    attachTo: document.body,
    global: { plugins: [store()], mocks: { $t: i18n.global.t } }
}));

const dialog = () => document.body.querySelector('[role="dialog"]');
const field = (name) => dialog().querySelector(`[data-field="${name}"]`);
const tick = async (name) => { field(name).click(); await flushPromises(); };
const type = async (value) => { const input = field('name'); input.value = value; input.dispatchEvent(new Event('input')); await flushPromises(); };
const submit = async () => { dialog().querySelector('[data-action="duplicate"]').click(); await flushPromises(); };
const posts = () => apiRequest.mock.calls.filter(([method]) => method === 'post');
const gets = () => apiRequest.mock.calls.filter(([method]) => method === 'get');
const answer = (data) => ({ data: { status: true, data: { project: COPY, counts: { folders: 2, lists: 3, tasks: 0, automations: 0 }, notes: [], job: null, ...data } } });
const refusal = (status, statusText) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { status: false, statusText } } });

beforeEach(() => {
    commits.length = 0;
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
    vi.useRealTimers();
    while (mounted.length) mounted.pop().unmount();
    document.body.innerHTML = '';
});

describe('the duplicate dialog', () => {
    it('opens with the name of the copy filled in and nothing extra ticked', () => {
        openDialog();
        expect(dialog().getAttribute('aria-modal')).toBe('true');
        expect(field('name').value).toBe('Alpha (copy)');
        expect(['tasks', 'assignees', 'dates'].map((name) => field(name).checked)).toEqual([false, false, false]);
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

    it('sends the name and the three choices, then opens the copy', async () => {
        apiRequest.mockResolvedValue(answer());
        const wrapper = openDialog();
        await type('  Alpha two ');
        await tick('tasks');
        await tick('assignees');
        await tick('dates');
        await submit();
        expect(posts()).toEqual([['post', `${env.PROJECTS_V2}/p1/duplicate`, { name: 'Alpha two', include: { tasks: true, assignees: true, dates: true } }]]);
        expect(commits).toEqual([[{ snap: null, privateSnap: false, op: 'added', data: { ...COPY, id: 'p2' } }]]);
        expect(push).toHaveBeenCalledWith({ name: 'Project', params: { cid: 'c1', id: 'p2' } });
        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('does not send an empty name', async () => {
        openDialog();
        await type('   ');
        await submit();
        expect(posts()).toHaveLength(0);
        expect(dialog().querySelector('[role="alert"]').textContent).toContain('Give the copy a name.');
    });

    it('shows the reason the server gives and stays open', async () => {
        apiRequest.mockRejectedValue(refusal(403, 'Your plan does not allow another project.'));
        const wrapper = openDialog();
        await submit();
        expect(dialog().querySelector('[role="alert"]').textContent).toContain('Your plan does not allow another project.');
        expect(wrapper.emitted('close')).toBeUndefined();
        expect(commits).toHaveLength(0);
        expect(push).not.toHaveBeenCalled();
    });

    it('falls back to its own words when the server gives none', async () => {
        apiRequest.mockRejectedValue(new Error('Network Error'));
        openDialog();
        await submit();
        expect(dialog().querySelector('[role="alert"]').textContent).toContain('The project could not be duplicated.');
    });

    it('sends once however often the button is pressed', async () => {
        let release;
        apiRequest.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        openDialog();
        dialog().querySelector('[data-action="duplicate"]').click();
        dialog().querySelector('[data-action="duplicate"]').click();
        await flushPromises();
        expect(dialog().querySelector('[data-action="duplicate"]').disabled).toBe(true);
        expect(posts()).toHaveLength(1);
        release(answer());
        await flushPromises();
    });

    it('says when automations came across switched off', async () => {
        apiRequest.mockResolvedValue(answer({ notes: [{ code: 'automations_disabled', count: 2 }] }));
        openDialog();
        await submit();
        expect(toast.info).toHaveBeenCalledTimes(1);
        expect(toast.info.mock.calls[0][0]).toContain('2');
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

describe('a long copy', () => {
    const job = (more) => ({ data: { status: true, data: { status: 'processing', total: 900, processed: 0, created: 0, ...more } } });

    it('shows the progress of the tasks, then opens the copy', async () => {
        vi.useFakeTimers();
        apiRequest.mockImplementation((method) => {
            if (method === 'post') return Promise.resolve(answer({ job: { id: 'j1', status: 'processing', total: 900 } }));
            return Promise.resolve(gets().length < 2 ? job({ processed: 300, created: 300 }) : job({ status: 'done', processed: 900, created: 900 }));
        });
        const wrapper = openDialog();
        await tick('tasks');
        await submit();
        expect(push).not.toHaveBeenCalled();
        expect(dialog().querySelector('[role="progressbar"]').getAttribute('aria-valuemax')).toBe('900');

        await vi.advanceTimersByTimeAsync(1600);
        expect(gets()[0]).toEqual(['get', `${env.PROJECTS_V2}/p2/duplicate`]);
        expect(dialog().querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('300');
        expect(dialog().textContent).toContain('300 of 900');

        await vi.advanceTimersByTimeAsync(1600);
        expect(push).toHaveBeenCalledWith({ name: 'Project', params: { cid: 'c1', id: 'p2' } });
        expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('opens the copy and says how far it got when the tasks fail', async () => {
        vi.useFakeTimers();
        apiRequest.mockImplementation((method) => (method === 'post'
            ? Promise.resolve(answer({ job: { id: 'j1', status: 'processing', total: 900 } }))
            : Promise.resolve(job({ status: 'failed', processed: 400, created: 400 }))));
        openDialog();
        await submit();
        await vi.advanceTimersByTimeAsync(1600);
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(toast.error.mock.calls[0][0]).toContain('400');
        expect(push).toHaveBeenCalledWith({ name: 'Project', params: { cid: 'c1', id: 'p2' } });
    });

    it('stops asking once it is closed', async () => {
        vi.useFakeTimers();
        apiRequest.mockImplementation((method) => Promise.resolve(method === 'post' ? answer({ job: { id: 'j1', status: 'processing', total: 900 } }) : job()));
        const wrapper = openDialog();
        await submit();
        await vi.advanceTimersByTimeAsync(1600);
        const asked = gets().length;
        wrapper.unmount();
        mounted.length = 0;
        await vi.advanceTimersByTimeAsync(5000);
        expect(gets()).toHaveLength(asked);
    });
});

describe('where Duplicate project is offered', () => {
    const DropDown = { name: 'DropDown', template: '<div><slot name="button" :triggerAttrs="{}" /><slot name="options" /></div>' };
    const DropDownOption = { name: 'DropDownOption', emits: ['click'], template: '<div class="dd-option" @click="$emit(\'click\')"><slot /></div>' };
    const bar = (projectData = ALPHA) => keep(mount(ProjectActionsBar, {
        props: { projectData, clientWidth: 1280 },
        attachTo: document.body,
        global: { plugins: [store()], mocks: { $t: i18n.global.t }, stubs: { DropDown, DropDownOption, Assignee: true, WasabiImage: true } }
    }));
    const page = () => keep(mount(ProjectsListPage, { attachTo: document.body, global: { plugins: [store()], mocks: { $t: i18n.global.t }, stubs: { 'router-link': true } } }));
    const rowEntry = async (wrapper, at) => {
        await wrapper.findAll('.pl2__dots')[at].trigger('click');
        return wrapper.find('[data-test="duplicate-project"]');
    };

    it('in the project menu, to someone who may create a project', async () => {
        const wrapper = bar();
        const entry = wrapper.find('[data-test="duplicate-project"]');
        expect(entry.text()).toBe('Duplicate project');
        expect(dialog()).toBeNull();
        await entry.trigger('click');
        expect(field('name').value).toBe('Alpha (copy)');
    });

    it('in the project menu of a project with its own rules, still by the rules of the company', () => {
        expect(bar({ ...ALPHA, isGlobalPermission: false }).find('[data-test="duplicate-project"]').exists()).toBe(true);
    });

    it('not to someone who may not create a project', async () => {
        getters['settings/rules'] = rulesGranting(false);
        getters['settings/projectRules'] = rulesGranting(true);
        expect(bar().find('[data-test="duplicate-project"]').exists()).toBe(false);
        expect((await rowEntry(page(), 0)).exists()).toBe(false);
    });

    it('not for a personal list', async () => {
        expect(bar({ ...ALPHA, isPersonal: true }).find('[data-test="duplicate-project"]').exists()).toBe(false);
        expect((await rowEntry(page(), 1)).exists()).toBe(false);
    });

    it('in the row menu of the project list', async () => {
        const wrapper = page();
        const entry = await rowEntry(wrapper, 0);
        expect(entry.text()).toBe('Duplicate project');
        await entry.trigger('click');
        expect(field('name').value).toBe('Alpha (copy)');
        expect(wrapper.find('.pl2__pop--row').exists()).toBe(false);
    });
});
