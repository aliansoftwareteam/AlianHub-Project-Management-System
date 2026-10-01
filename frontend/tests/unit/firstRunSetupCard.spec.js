import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';

const { apiRequestWithoutCompnay, push, me } = vi.hoisted(() => ({
    apiRequestWithoutCompnay: vi.fn(),
    push: vi.fn(() => Promise.resolve()),
    me: { value: {} }
}));

vi.mock('@/services', () => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push, hasRoute: () => true }), useRoute: () => ({ fullPath: '/', meta: {}, name: 'Home', params: {}, query: {} }) }));
vi.mock('@/composable', () => ({ useGetterFunctions: () => ({ getUser: () => me.value }) }));
vi.mock('@/components/organisms/WorkspaceImport/WorkspaceImportDialog.vue', () => ({
    __esModule: true,
    default: defineComponent({ name: 'WorkspaceImportDialog', setup: () => () => h('div', { class: 'wim-stub' }) })
}));

import { useOnboardingChecklist, ADMIN_STEPS, MEMBER_STEPS } from '@/composable/useOnboardingChecklist';
import { resetOnboardingRecord } from '@/composable/onboardingState';
import { AI_STATE, applyAiAvailability, resetAiAvailability } from '@/composable/aiAvailability';
import { applyAccent, applyTheme } from '@/components/organisms/Shell/shellState';
import { quickCreate, closeQuickCreate } from '@/components/organisms/QuickCreateTask/quickCreateTask';
import { workspaceImport, closeWorkspaceImport } from '@/components/organisms/WorkspaceImport/workspaceImportState';
import { shortcutSheet, closeShortcutSheet } from '@/composable/shortcuts';
import SetupChecklist from '@/components/molecules/Home/SetupChecklist.vue';

const ROLE = { owner: 1, admin: 2, member: 3 };
const SAMPLE = { _id: 'p-sample', ProjectCode: 'WELCOME', lastTaskId: 9 };
const PERSONAL = { _id: 'p-mine', ProjectCode: 'ME', isPersonal: true, lastTaskId: 4 };
const OPS = { _id: 'p-ops', ProjectCode: 'OPS', lastTaskId: 0 };

const checklist = ({ role = ROLE.owner, projects = [SAMPLE], users = [{ userId: 'user-1' }], openCreateProject = vi.fn() } = {}) => {
    const store = createStore({
        modules: {
            projectData: { namespaced: true, getters: { projects: () => ({ data: projects }) } },
            settings: { namespaced: true, getters: { companyUsers: () => users, companyUserDetail: () => ({ roleType: role }) } }
        }
    });
    let api;
    mount(defineComponent({ setup() { api = useOnboardingChecklist({ openCreateProject }); return () => h('div'); } }), {
        global: { plugins: [store], provide: { $userId: { value: 'user-1' }, $companyId: { value: 'c1' } } }
    });
    return { ...api, openCreateProject };
};

const stepOf = (api, key) => api.steps.value.find((s) => s.key === key);

beforeEach(() => {
    me.value = { _id: 'user-1', homeChecklist: {} };
    resetOnboardingRecord();
    resetAiAvailability();
    closeWorkspaceImport();
    closeQuickCreate();
    closeShortcutSheet();
    localStorage.clear();
    applyAccent('');
    push.mockClear();
    apiRequestWithoutCompnay.mockReset();
    apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true } });
});

describe('the owner card', () => {
    it.each(['owner', 'admin'])('gives an %s the five steps in order when the instance has AI', (role) => {
        applyAiAvailability({ state: AI_STATE.OFF_WORKSPACE });
        expect(checklist({ role: ROLE[role] }).steps.value.map((s) => s.key)).toEqual(['project', 'task', 'invite', 'look', 'ai']);
        expect(ADMIN_STEPS).toHaveLength(5);
    });

    it.each([AI_STATE.UNKNOWN, AI_STATE.OFF_INSTANCE, AI_STATE.UNCONFIGURED])('hides the AI step when the instance state is %s', (state) => {
        applyAiAvailability({ state });
        expect(checklist().steps.value.map((s) => s.key)).toEqual(['project', 'task', 'invite', 'look']);
    });

    it('offers the import as the second action of the project step', () => {
        const api = checklist();
        expect(stepOf(api, 'project').alt).toEqual({ key: 'import', label: 'Home.import_from' });
        expect(api.onAction('import')).toBe(true);
        expect(workspaceImport.open).toBe(true);
    });
});

describe('each owner step is done from data', () => {
    it('project: the sample project and a personal list do not count, a real project does', () => {
        expect(stepOf(checklist({ projects: [SAMPLE, PERSONAL] }), 'project').done).toBe(false);
        expect(stepOf(checklist({ projects: [SAMPLE, OPS] }), 'project').done).toBe(true);
    });

    it('task: a real project that has had a task', () => {
        expect(stepOf(checklist({ projects: [SAMPLE, PERSONAL, OPS] }), 'task').done).toBe(false);
        expect(stepOf(checklist({ projects: [SAMPLE, { ...OPS, lastTaskId: 1 }] }), 'task').done).toBe(true);
    });

    it('invite: a second person in the workspace', () => {
        expect(stepOf(checklist(), 'invite').done).toBe(false);
        expect(stepOf(checklist({ users: [{ userId: 'user-1' }, { userId: 'user-2' }] }), 'invite').done).toBe(true);
    });

    it('look: a theme or accent chosen in this browser', () => {
        expect(stepOf(checklist(), 'look').done).toBe(false);
        applyTheme('dark');
        expect(stepOf(checklist(), 'look').done).toBe(true);
        localStorage.clear();
        applyAccent('blue');
        expect(stepOf(checklist(), 'look').done).toBe(true);
    });

    it('ai: on for the workspace', () => {
        applyAiAvailability({ state: AI_STATE.OFF_WORKSPACE });
        expect(stepOf(checklist(), 'ai').done).toBe(false);
        applyAiAvailability({ state: AI_STATE.ON });
        expect(stepOf(checklist(), 'ai').done).toBe(true);
    });

    it('never from a click: every action leaves the steps undone and saves nothing', () => {
        applyAiAvailability({ state: AI_STATE.OFF_WORKSPACE });
        const api = checklist();
        for (const key of ['project', 'import', 'task', 'invite', 'look', 'ai', 'agent']) api.onAction(key);
        expect(api.steps.value.filter((s) => s.done)).toEqual([]);
        expect(apiRequestWithoutCompnay).not.toHaveBeenCalled();
    });
});

describe('each owner step is one click away', () => {
    it('project opens the create dialog', () => {
        const api = checklist();
        api.onAction('project');
        expect(api.openCreateProject).toHaveBeenCalledTimes(1);
    });

    it('task opens quick create in the real project, or the create dialog when there is no project at all', () => {
        checklist({ projects: [SAMPLE, OPS] }).onAction('task');
        expect(quickCreate).toMatchObject({ open: true, projectId: 'p-ops' });
        closeQuickCreate();
        const empty = checklist({ projects: [] });
        empty.onAction('task');
        expect(quickCreate.open).toBe(false);
        expect(empty.openCreateProject).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['invite', { name: 'Members' }],
        ['look', { name: 'My Profile', query: { section: 'look' } }],
        ['ai', { name: 'Setting' }],
        ['agent', { name: 'Connections' }]
    ])('%s goes to its screen', (key, target) => {
        checklist().onAction(key);
        expect(push).toHaveBeenCalledWith(expect.objectContaining({ ...target, params: { cid: 'c1' } }));
    });

    it('removing the sample data is left to the view to confirm', () => {
        expect(checklist().onAction('remove_sample')).toBe(false);
    });
});

describe('the member card', () => {
    it('has their own three steps and none of the workspace ones', () => {
        applyAiAvailability({ state: AI_STATE.ON });
        const api = checklist({ role: ROLE.member, projects: [SAMPLE, { ...OPS, lastTaskId: 3 }], users: [{ userId: 'user-1' }, { userId: 'user-2' }] });
        expect(api.steps.value.map((s) => s.key)).toEqual(['my_work', 'notifications', 'shortcuts']);
        expect(MEMBER_STEPS).toHaveLength(3);
        expect(api.steps.value.filter((s) => s.done)).toEqual([]);
    });

    it('reads each step from the user record, so it follows them to another device', () => {
        me.value = { ...me.value, homeChecklist: { openedMyWork: true, viewedNotifications: true, viewedShortcuts: true } };
        const api = checklist({ role: ROLE.member });
        expect(api.steps.value.every((s) => s.done)).toBe(true);
        expect(api.show.value).toBe(false);
    });

    it('opens My Work and the shortcut sheet without ticking anything itself', () => {
        const api = checklist({ role: ROLE.member });
        api.onAction('my_work');
        expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: 'Home', query: { filter: 'assigned' } }));
        api.onAction('shortcuts');
        expect(shortcutSheet.open).toBe(true);
        expect(apiRequestWithoutCompnay).not.toHaveBeenCalled();
        expect(api.steps.value.filter((s) => s.done)).toEqual([]);
    });
});

describe('the card', () => {
    const steps = [
        { key: 'project', label: 'Home.step_start_project', cta: 'Home.create_project', alt: { key: 'import', label: 'Home.import_from' }, done: false },
        { key: 'task', label: 'Home.step_task', cta: 'Home.add_first_task', alt: null, done: false },
        { key: 'invite', label: 'Home.step_invite', cta: 'Home.invite_team', alt: null, done: true }
    ];
    const card = (props = {}) => mount(SetupChecklist, { props: { companyName: 'Acme', steps, ...props }, global: { mocks: { $t: (key) => key }, stubs: { ShellIcon: true } } });

    it('lists every step without a click, each undone one a button', async () => {
        const wrapper = card();
        const rows = wrapper.findAll('#hc-setup-steps .hc-setup__step');
        expect(rows).toHaveLength(3);
        expect(rows[0].find('button').attributes('aria-current')).toBe('step');
        expect(rows[2].find('button').exists()).toBe(false);
        await rows[1].find('button').trigger('click');
        expect(wrapper.emitted('action')[0]).toEqual(['task']);
    });

    it('shows the second action of the next step beside the first', async () => {
        const wrapper = card();
        expect(wrapper.find('.hc-setup__cta').text()).toBe('Home.create_project');
        const alt = wrapper.find('[data-test="setup-alt"]');
        expect(alt.text()).toBe('Home.import_from');
        await alt.trigger('click');
        expect(wrapper.emitted('action')[0]).toEqual(['import']);
        expect(card({ steps: steps.slice(1) }).find('[data-test="setup-alt"]').exists()).toBe(false);
    });

    it('keeps "Remove sample data" on the card while the sample project exists', async () => {
        expect(card().find('[data-test="setup-remove-sample"]').exists()).toBe(false);
        const wrapper = card({ sample: true });
        const remove = wrapper.find('[data-test="setup-remove-sample"]');
        expect(remove.text()).toBe('Home.remove_sample');
        await remove.trigger('click');
        expect(wrapper.emitted('action')[0]).toEqual(['remove_sample']);
    });
});
