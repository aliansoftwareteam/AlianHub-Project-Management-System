import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequest, toast, replace, stub } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
    replace: vi.fn(() => Promise.resolve()),
    stub: (name) => ({ default: { name, render: () => null } })
}));

vi.mock('@/services', () => ({ apiRequest, apiRequestWithoutCompnay: vi.fn() }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace }), useRoute: () => ({ params: { cid: 'c1' }, query: {} }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => ({}) }) }));
vi.mock('@/composable/aiAvailability', () => ({ aiUsable: ref(false), canUseAi: () => false }));
vi.mock('@/components/templates/CreateProject/helper.js', () => ({ HandleProject: vi.fn() }));
vi.mock('@vuepic/vue-datepicker', () => stub('VueDatePicker'));
vi.mock('@vuepic/vue-datepicker/dist/main.css', () => ({}));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => stub('ShellIcon'));
vi.mock('@/components/atom/SpinnerComp/SpinnerComp.vue', () => stub('SpinnerComp'));
vi.mock('@/components/molecules/Assignee/Assignee.vue', () => stub('Assignee'));
vi.mock('@/components/molecules/SkillsSelect/SkillsSelect.vue', () => stub('SkillsSelect'));
vi.mock('@/components/molecules/ProjectSourceSelect/ProjectSourceSelect.vue', () => stub('ProjectSourceSelect'));
vi.mock('@/components/molecules/ProjectAppsList/ProjectAppsList.vue', () => stub('ProjectAppsList'));
vi.mock('@/components/organisms/AiProjectCreator/AiProjectCreator.vue', () => stub('AiProjectCreator'));

import * as env from '@/config/env';
import en from '@/locales/en';
import CreateProjectSidebar from '@/components/organisms/CreateProject/CreateProjectSidebar.vue';
import { PROJECT_TEMPLATES_EVENT } from '@/views/Projects/projectTemplates';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const TEMPLATES = `${env.PROJECTS_V2}/templates`;
const EVERYTHING = { tasks: true, assignees: true, dates: true, automations: true };
const NOTHING = { tasks: false, assignees: false, dates: false, automations: false };
const STATUSES = [{ key: 1, name: 'To Do', type: 'default_active' }, { key: 3, name: 'Shipped', type: 'close' }];
const LAUNCH = {
    _id: 't1', name: 'Launch plan', description: 'How we launch', everyone: true, sourcePrivate: false, include: EVERYTHING,
    counts: { folders: 3, lists: 8, tasks: 42, automations: 2 }, statuses: STATUSES, createdBy: 'u1', canManage: true
};
const BARE = {
    _id: 't2', name: 'Bare bones', description: '', everyone: true, sourcePrivate: true, include: NOTHING,
    counts: { folders: 1, lists: 1, tasks: 0, automations: 0 }, statuses: STATUSES, createdBy: 'u9', canManage: false
};
const MADE = { _id: 'p9', ProjectName: 'Autumn launch', ProjectCode: 'AL', ProjectRequiredDefaultComponent: 'ProjectKanban' };

let templates;
let answers;
const commits = [];
const store = () => createStore({
    modules: {
        settings: {
            namespaced: true,
            getters: { selectedCompany: () => ({ Cst_CompanyName: 'Acme' }), companyUserDetail: () => ({ roleType: 1 }), allCurrencyArray: () => [], finalCustomFields: () => [] },
            mutations: { mutateFinalCustomFields: () => {} }
        },
        users: { namespaced: true, getters: { users: () => [{ _id: 'u1', Employee_Name: 'Asha' }] } },
        projectData: {
            namespaced: true,
            getters: { allProjects: () => ({ data: [{ _id: 'p1', ProjectCode: 'TAKEN' }] }), projectTemplate: () => ({ data: [] }) },
            actions: { setprojectTemplate: () => Promise.resolve() },
            mutations: { mutateProjects: (state, payload) => commits.push(payload) }
        }
    }
});

const ok = (data) => Promise.resolve({ data: { status: true, data } });
const refusal = (status, statusText) => Promise.reject(Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { status: false, statusText } } }));
const made = (more = {}) => ({ project: MADE, counts: { folders: 3, lists: 8, tasks: 42, automations: 0 }, notes: [], sharedFields: [], job: null, ...more });

const mounted = [];
const sidebar = async (socket) => {
    const wrapper = mount(CreateProjectSidebar, {
        props: { isActiveCreateSidebar: true },
        global: { plugins: [store()], mocks: { $t: i18n.global.t }, stubs: { teleport: true }, ...(socket ? { provide: { $socket: ref(socket) } } : {}) }
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};

const row = (wrapper, id) => wrapper.find(`[data-saved-template="${id}"]`);
const pick = async (wrapper, id) => { await row(wrapper, id).trigger('click'); await flushPromises(); };
const fill = async (wrapper, selector, value) => { await wrapper.find(selector).setValue(value); await flushPromises(); };
const create = async (wrapper) => { await wrapper.find('[data-template-form]').trigger('submit'); await flushPromises(); };
const calls = (method, url) => apiRequest.mock.calls.filter(([m, u]) => m === method && (!url || u === url));

beforeEach(() => {
    templates = [LAUNCH, BARE];
    answers = {};
    commits.length = 0;
    apiRequest.mockReset();
    replace.mockClear();
    Object.values(toast).forEach((spy) => spy.mockClear());
    apiRequest.mockImplementation((method, url) => {
        const answer = answers[`${method} ${url}`];
        if (answer) return answer();
        if (method === 'get' && url === TEMPLATES) return ok(templates);
        if (method === 'post' && url === env.GLOBAL_PROJECT_TEMPLATE) return Promise.resolve({ data: { status: true, statusText: [] } });
        return Promise.resolve({ data: { status: true, data: [] } });
    });
});
afterEach(() => {
    vi.useRealTimers();
    while (mounted.length) mounted.pop().unmount();
});

describe('the templates saved from projects, in a new project', () => {
    it('are listed with their name, description, what they hold and who made them', async () => {
        const wrapper = await sidebar();
        expect(wrapper.find('[data-saved-templates]').text()).toContain('Saved from projects');
        expect(row(wrapper, 't1').text()).toContain('Launch plan');
        expect(row(wrapper, 't1').text()).toContain('How we launch');
        expect(row(wrapper, 't1').text()).toContain('3 folders, 8 lists, 42 tasks');
        expect(row(wrapper, 't1').text()).toContain('by Asha');
        expect(row(wrapper, 't2').text()).toContain('1 folder, 1 list, 0 tasks');
        expect(row(wrapper, 't2').text()).not.toContain('by ');
    });

    it('are left out, heading and all, when the workspace has none or the list cannot be read', async () => {
        templates = [];
        expect((await sidebar()).find('[data-saved-templates]').exists()).toBe(false);
        answers[`get ${TEMPLATES}`] = () => refusal(403, 'You do not have permission to perform this action.');
        const wrapper = await sidebar();
        expect(wrapper.find('[data-saved-templates]').exists()).toBe(false);
        expect(wrapper.findAll('.ah-cp__tpl.is-on')).toHaveLength(1);
    });

    it('are narrowed by the search with the other templates', async () => {
        const wrapper = await sidebar();
        await fill(wrapper, '.ah-cp__search', 'bare');
        expect(row(wrapper, 't1').exists()).toBe(false);
        expect(row(wrapper, 't2').exists()).toBe(true);
    });

    it('show their statuses and what they hold when picked, with a form of only what a template needs', async () => {
        const wrapper = await sidebar();
        await pick(wrapper, 't1');
        expect(row(wrapper, 't1').classes()).toContain('is-on');
        expect(wrapper.findAll('.ah-cp__status').map((chip) => chip.text())).toEqual(['To Do', 'Shipped']);
        expect(wrapper.find('.ah-cp__sample').text()).toContain('3 folders, 8 lists, 42 tasks');
        expect(wrapper.find('[data-template-form]').exists()).toBe(true);
        expect(wrapper.findComponent({ name: 'ProjectSourceSelect' }).exists()).toBe(false);
        expect(['tasks', 'assignees', 'dates', 'automations'].map((key) => wrapper.find(`[data-include="${key}"]`).element.checked)).toEqual([true, true, true, true]);
        expect(wrapper.find('[data-field="start"]').exists()).toBe(true);
    });

    it('offer only the choices a template holds', async () => {
        const wrapper = await sidebar();
        await pick(wrapper, 't2');
        expect(wrapper.findAll('[data-include]')).toHaveLength(0);
        expect(wrapper.find('[data-field="start"]').exists()).toBe(false);
        expect(wrapper.find('#cp-visibility').element.value).toBe('true');
        await pick(wrapper, 't1');
        expect(wrapper.find('#cp-visibility').element.value).toBe('false');
    });
});

describe('a project made from a saved template', () => {
    it('sends the name, the key, the privacy, the start and the choices, adds the project and opens it', async () => {
        answers[`post ${TEMPLATES}/t1/use`] = () => ok(made());
        const wrapper = await sidebar();
        await pick(wrapper, 't1');
        await fill(wrapper, '#cp-name', 'Autumn launch');
        await fill(wrapper, '[data-field="start"]', '2026-06-01');
        await wrapper.find('[data-include="assignees"]').setValue(false);
        await create(wrapper);
        expect(calls('post', `${TEMPLATES}/t1/use`)).toEqual([['post', `${TEMPLATES}/t1/use`, {
            name: 'Autumn launch', code: 'AL', isPrivate: false, startDate: new Date('2026-06-01T00:00:00').toISOString(),
            include: { tasks: true, assignees: false, dates: true, automations: true }
        }]]);
        expect(commits).toEqual([[{ snap: null, privateSnap: false, op: 'added', data: { ...MADE, id: 'p9' } }]]);
        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(replace).toHaveBeenCalledWith({ name: 'Project', params: { cid: 'c1', id: 'p9' }, query: { tab: 'ProjectKanban' } });
        expect(wrapper.emitted('closeSidebar')).toHaveLength(1);
    });

    it('sends no start when the dates are not wanted, and no people without the tasks', async () => {
        answers[`post ${TEMPLATES}/t1/use`] = () => ok(made());
        const wrapper = await sidebar();
        await pick(wrapper, 't1');
        await fill(wrapper, '#cp-name', 'Autumn launch');
        await wrapper.find('[data-include="dates"]').setValue(false);
        await wrapper.find('[data-include="tasks"]').setValue(false);
        expect(wrapper.find('[data-include="assignees"]').element.disabled).toBe(true);
        await create(wrapper);
        expect(calls('post', `${TEMPLATES}/t1/use`)[0][2]).toEqual({
            name: 'Autumn launch', code: 'AL', isPrivate: false, include: { tasks: false, assignees: false, dates: false, automations: true }
        });
    });

    it('is not sent with a name too short or a key that is taken', async () => {
        const wrapper = await sidebar();
        await pick(wrapper, 't1');
        await fill(wrapper, '#cp-name', 'Ab');
        await create(wrapper);
        await fill(wrapper, '#cp-name', 'Autumn launch');
        await fill(wrapper, '#cp-key', 'taken');
        await create(wrapper);
        expect(calls('post', `${TEMPLATES}/t1/use`)).toHaveLength(0);
        expect(wrapper.find('[data-template-form]').text()).toContain('That key is used by another project.');
    });

    it('shows the reason the server gives and stays', async () => {
        answers[`post ${TEMPLATES}/t1/use`] = () => refusal(400, 'That project key is already taken.');
        const wrapper = await sidebar();
        await pick(wrapper, 't1');
        await fill(wrapper, '#cp-name', 'Autumn launch');
        await create(wrapper);
        expect(wrapper.find('[data-template-form] [role="alert"]').text()).toContain('That project key is already taken.');
        expect(wrapper.emitted('closeSidebar')).toBeUndefined();
        expect(commits).toHaveLength(0);
    });

    it('says what the template named that is no longer there, and that its automations are off', async () => {
        answers[`post ${TEMPLATES}/t1/use`] = () => ok(made({
            notes: [{ code: 'automations_disabled', count: 2 }, { code: 'people_skipped', count: 3 }, { code: 'statuses_skipped', count: 4 }, { code: 'fields_skipped', count: 5 }]
        }));
        const wrapper = await sidebar();
        await pick(wrapper, 't1');
        await fill(wrapper, '#cp-name', 'Autumn launch');
        await create(wrapper);
        const said = toast.info.mock.calls.map(([text]) => text);
        expect(said).toHaveLength(4);
        [2, 3, 4, 5].forEach((count, at) => expect(said[at]).toContain(String(count)));
    });

    it('shows the progress of a long one as a duplicate does, then opens it', async () => {
        vi.useFakeTimers();
        const job = (more) => ok({ status: 'processing', total: 900, processed: 0, created: 0, ...more });
        answers[`post ${TEMPLATES}/t1/use`] = () => ok(made({ job: { id: 'j1', status: 'processing', total: 900 } }));
        answers[`get ${env.PROJECTS_V2}/p9/duplicate`] = () => (calls('get', `${env.PROJECTS_V2}/p9/duplicate`).length < 2 ? job({ processed: 300, created: 300 }) : job({ status: 'done', processed: 900, created: 900 }));
        const wrapper = await sidebar();
        await pick(wrapper, 't1');
        await fill(wrapper, '#cp-name', 'Autumn launch');
        await create(wrapper);
        expect(replace).not.toHaveBeenCalled();
        expect(wrapper.find('[role="progressbar"]').attributes('aria-valuemax')).toBe('900');

        await vi.advanceTimersByTimeAsync(1600);
        expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('300');
        await vi.advanceTimersByTimeAsync(1600);
        expect(replace).toHaveBeenCalledTimes(1);
        expect(wrapper.emitted('closeSidebar')).toHaveLength(1);
    });
});

describe('managing the saved templates', () => {
    it('is offered only on the ones the person may change', async () => {
        const wrapper = await sidebar();
        expect(wrapper.find('[data-template-edit="t1"]').exists()).toBe(true);
        expect(wrapper.find('[data-template-delete="t1"]').exists()).toBe(true);
        expect(wrapper.find('[data-template-edit="t2"]').exists()).toBe(false);
        expect(wrapper.find('[data-template-delete="t2"]').exists()).toBe(false);
    });

    it('renames one and rewrites its description, sending only what changed, then reads the list again', async () => {
        answers[`patch ${TEMPLATES}/t1`] = () => ok({ ...LAUNCH, name: 'Launch plan v2' });
        const wrapper = await sidebar();
        await wrapper.find('[data-template-edit="t1"]').trigger('click');
        expect(wrapper.find('[data-template-name]').element.value).toBe('Launch plan');
        expect(wrapper.find('[data-template-description]').element.value).toBe('How we launch');
        expect(wrapper.find('[data-template-everyone]').element.checked).toBe(true);
        await fill(wrapper, '[data-template-name]', ' Launch plan v2 ');
        await wrapper.find('[data-template-edit-form]').trigger('submit');
        await flushPromises();
        expect(calls('patch')).toEqual([['patch', `${TEMPLATES}/t1`, { name: 'Launch plan v2' }]]);
        expect(calls('get', TEMPLATES)).toHaveLength(2);
        expect(wrapper.find('[data-template-edit-form]').exists()).toBe(false);
    });

    it('changes who it is offered to', async () => {
        answers[`patch ${TEMPLATES}/t1`] = () => ok({ ...LAUNCH, everyone: false });
        const wrapper = await sidebar();
        await wrapper.find('[data-template-edit="t1"]').trigger('click');
        await wrapper.find('[data-template-everyone]').setValue(false);
        await wrapper.find('[data-template-edit-form]').trigger('submit');
        await flushPromises();
        expect(calls('patch')[0][2]).toEqual({ everyone: false });
    });

    it('sends nothing when nothing changed or the name is emptied', async () => {
        const wrapper = await sidebar();
        await wrapper.find('[data-template-edit="t1"]').trigger('click');
        await wrapper.find('[data-template-edit-form]').trigger('submit');
        await wrapper.find('[data-template-edit="t1"]').trigger('click');
        await fill(wrapper, '[data-template-name]', '   ');
        await wrapper.find('[data-template-edit-form]').trigger('submit');
        await flushPromises();
        expect(calls('patch')).toHaveLength(0);
    });

    it('deletes one after a second click, and goes back to Blank when it was the one picked', async () => {
        answers[`delete ${TEMPLATES}/t1`] = () => { templates = [BARE]; return ok(undefined); };
        const wrapper = await sidebar();
        await pick(wrapper, 't1');
        await wrapper.find('[data-template-delete="t1"]').trigger('click');
        expect(calls('delete')).toHaveLength(0);
        await wrapper.find('[data-template-confirm-delete]').trigger('click');
        await flushPromises();
        expect(calls('delete')).toEqual([['delete', `${TEMPLATES}/t1`]]);
        expect(row(wrapper, 't1').exists()).toBe(false);
        expect(wrapper.find('[data-template-form]').exists()).toBe(false);
        expect(wrapper.find('.ah-cp__tpl.is-on').text()).toContain('Blank');
    });

    it('shows the reason a change is refused', async () => {
        answers[`delete ${TEMPLATES}/t1`] = () => refusal(403, 'You do not have permission to perform this action.');
        const wrapper = await sidebar();
        await wrapper.find('[data-template-delete="t1"]').trigger('click');
        await wrapper.find('[data-template-confirm-delete]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-saved-templates] [role="alert"]').text()).toContain('You do not have permission');
        expect(row(wrapper, 't1').exists()).toBe(true);
    });
});

describe('the list while it is open', () => {
    it('is read again when the workspace says the templates changed, and stops listening when closed', async () => {
        const socket = { on: vi.fn(), off: vi.fn() };
        const wrapper = await sidebar(socket);
        const [, handler] = socket.on.mock.calls.find(([event]) => event === PROJECT_TEMPLATES_EVENT);
        templates = [BARE];
        handler({ type: 'delete' });
        await flushPromises();
        expect(row(wrapper, 't1').exists()).toBe(false);
        expect(row(wrapper, 't2').exists()).toBe(true);
        wrapper.unmount();
        mounted.length = 0;
        expect(socket.off).toHaveBeenCalledWith(PROJECT_TEMPLATES_EVENT, handler);
    });
});
