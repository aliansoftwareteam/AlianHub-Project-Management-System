import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { updateStatus, stub, slotStub, exposed, perms, apps, toast, projectPayload } = vi.hoisted(() => ({
    updateStatus: vi.fn(() => Promise.resolve()),
    stub: (name) => ({ default: { name, render: () => null } }),
    slotStub: (name, slot, methods = []) => ({
        default: {
            name,
            setup(_, { slots, expose }) {
                expose(Object.fromEntries(methods.map((method) => [method, (...args) => exposed[`${name}.${method}`](...args)])));
                return () => (slots[slot] ? slots[slot]() : null);
            }
        }
    }),
    exposed: {},
    perms: {},
    apps: {},
    toast: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} },
    projectPayload: {
    _id: 'proj-1',
    isGlobalPermission: false,
    taskStatusData: [
        { key: 'st-open', name: 'Open', type: 'open', value: 'open', bgColor: '#eee', textColor: '#000' },
        { key: 'st-done', name: 'Done', type: 'close', value: 'done', bgColor: '#cfc', textColor: '#000' }
    ],
    taskTypeCounts: [],
    sprintsObj: [],
    sprintsfolders: [],
    tasks: [{ _id: 'task-1', TaskName: 'Write spec', TaskKey: 'AH-1', statusKey: 'st-open', statusType: 'open', AssigneeUserId: [] }],
    subtasks: []
    }
}));

const { openRuns } = vi.hoisted(() => ({ openRuns: { rows: [] } }));
const { sessions, flags } = vi.hoisted(() => ({ sessions: { rows: [] }, flags: { agentSessions: false } }));
vi.mock('@/config/publicConfig', () => ({ publicConfig: flags }));

vi.mock('@/services', () => ({
    apiRequest: vi.fn((method, url) => {
        if (String(url).includes('/taskData')) return Promise.resolve({ status: 200, data: [projectPayload] });
        if (String(url).includes('/agents/runs?status=open')) return Promise.resolve({ status: 200, data: { status: true, data: openRuns.rows } });
        if (String(url).includes('/agents/runs/') && String(url).endsWith('/stop')) return Promise.resolve({ status: 200, data: { status: true, data: {} } });
        if (String(url).includes('/agent-sessions?taskId=')) return Promise.resolve({ status: 200, data: { status: true, data: sessions.rows } });
        return Promise.resolve({ status: 200, data: { status: false, data: [] } });
    })
}));
vi.mock('@/utils/TaskOperations', () => ({ default: { updateStatus } }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({
    useCustomComposable: () => ({ checkPermission: (key) => (key in perms ? perms[key] : true), checkApps: (app) => apps[app] !== false }),
    useGetterFunctions: () => ({ getUser: () => ({}), getPriority: (key) => (key === 'high' ? { name: 'High' } : {}) })
}));
vi.mock('@/views/Projects/helper', () => ({ useUpdateTasks: () => ({ updateTaskByGroup: vi.fn() }) }));
vi.mock('vue-router', () => ({
    useRouter: () => ({ push: vi.fn(), resolve: (to) => ({ href: `#/${to.params.cid}/project/${to.params.id}/s/${to.params.sprintId}/${to.params.taskId}` }) }),
    useRoute: () => ({ params: {}, query: {}, name: 'ProjectSprint' })
}));
vi.mock('@/components/organisms/TaskDetailOverlay/useTaskOverlay', () => ({ openTask: vi.fn(), setTaskMeta: vi.fn() }));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => stub('ShellIcon'));
vi.mock('@/components/atom/Skelaton/Skelaton.vue', () => stub('Skelaton'));
vi.mock('@/components/molecules/TaskDetailTitle/TaskDetailTitle.vue', () => stub('TaskDetailTitle'));
vi.mock('@/components/molecules/TaskDetailAction/TaskDetailAction.vue', () => stub('TaskDetailAction'));
vi.mock('@/components/molecules/TaskDetailTab/TaskDetailTab.vue', () => slotStub('TaskDetailTab', 'after-description', ['addChecklist', 'attachFile']));
vi.mock('@/components/organisms/TaskDetailRightSide/TaskDetailRightSide.vue', () => slotStub('TaskDetailRightSide', 'status'));
vi.mock('@/components/organisms/LinkedTasks/LinkedTasks.vue', () => slotStub('LinkedTasks', 'none', ['startAdding']));
vi.mock('@/views/Projects/Comments/Comments.vue', () => stub('Comments'));
vi.mock('@/components/templates/ActivityLog/ActivityLog.vue', () => stub('ActivityLog'));
vi.mock('@/components/molecules/Pages/PagesPanel.vue', () => stub('PagesPanel'));
vi.mock('@/components/atom/TagChip/TagChip.vue', () => stub('TagChip'));
vi.mock('@/components/molecules/TagList/CreateTagPopup.vue', () => stub('CreateTagPopup'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskSummaryBlock.vue', () => stub('TaskSummaryBlock'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskSubtaskList.vue', () => slotStub('TaskSubtaskList', 'none', ['startCreate']));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskTimerChip.vue', () => stub('TaskTimerChip'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskAgentStrip.vue', () => stub('TaskAgentStrip'));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskTrackerHandoff.vue', () => slotStub('TaskTrackerHandoff', 'none', ['start']));

import TaskDetailPanel from '@/components/organisms/TaskDetailOverlay/TaskDetailPanel.vue';
import { undoToast, runUndo, dismissUndoToast } from '@/composable/useUndoToast';
import en from '@/locales/en.js';
import { inkOf, worstContrast } from './wcagContrast';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

function mountPanel({ roleType = 1, userId = 'u1', socket = null, nav = null, width = 1280 } = {}) {
    const store = createStore({
        getters: {
            'settings/companyUserDetail': () => ({ roleType }),
            'settings/companyOwnerDetail': () => ({}),
            'projectData/gettaskDetailData': () => null,
            'settings/companyUsers': () => [],
            'settings/projectRules': () => ({ 'task.task_status': true }),
            'settings/selectedCompany': () => ({})
        },
        actions: { 'projectData/getTaskDetailSnapShot': () => Promise.resolve() },
        mutations: { 'projectData/setTaskDetailData': () => {}, 'projectData/setTaskdetailPayloadId': () => {} }
    });
    return mount(TaskDetailPanel, {
        props: { companyId: 'company-1', projectId: 'proj-1', sprintId: 'sprint-1', taskId: 'task-1', nav },
        global: { plugins: [store], mocks: { $t: t }, provide: { $userId: ref(userId), $clientWidth: ref(width), ...(socket ? { $socket: ref(socket) } : {}) } }
    });
}

describe('TaskDetailPanel', () => {
    it('moves the task to the close status from the complete button', async () => {
        const wrapper = mountPanel();
        await flushPromises();
        const done = wrapper.get('button.ah-detail__complete');
        expect(done.element.disabled).toBe(false);
        await done.trigger('click');
        expect(updateStatus).toHaveBeenCalledTimes(1);
        const call = updateStatus.mock.calls[0][0];
        expect(call.newStatus).toMatchObject({ statusKey: 'st-done', statusType: 'close' });
        expect(call.task._id).toBe('task-1');
    });

    it('puts no checkbox beside the title, so the type icon is not read as a second one', async () => {
        const wrapper = mountPanel();
        await flushPromises();
        expect(wrapper.find('.ah-detail__title-row input[type="checkbox"]').exists()).toBe(false);
    });

    it('shows no agent strip when the task has no open run', async () => {
        openRuns.rows = [];
        const wrapper = mountPanel();
        await flushPromises();
        expect(wrapper.findComponent({ name: 'TaskAgentStrip' }).exists()).toBe(false);
    });

    it('feeds the agent strip from the open run on the task and stops it through the API', async () => {
        const { apiRequest } = await import('@/services');
        openRuns.rows = [{ _id: 'run-1', agentName: 'Reviewer', status: 'running', startedAt: '2026-09-04T10:00:00.000Z' }];
        const wrapper = mountPanel();
        await flushPromises();
        const strip = wrapper.findComponent({ name: 'TaskAgentStrip' });
        expect(strip.exists()).toBe(true);
        const run = strip.vm.$attrs.run;
        expect(run).toMatchObject({ agentName: 'Reviewer', status: 'running', startedAt: '2026-09-04T10:00:00.000Z' });
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/agents/runs?status=open&taskId=task-1&limit=5');
        openRuns.rows = [];
        await run.onStop();
        await flushPromises();
        expect(apiRequest).toHaveBeenCalledWith('post', '/api/v2/agents/runs/run-1/stop', {});
        expect(wrapper.findComponent({ name: 'TaskAgentStrip' }).exists()).toBe(false);
    });

    it('offers stop to the member who started the run but not to another member', async () => {
        openRuns.rows = [{ _id: 'run-3', agentName: 'Reviewer', status: 'running', startedBy: 'u1', startedAt: '2026-09-04T10:00:00.000Z' }];
        const starter = mountPanel({ roleType: 3, userId: 'u1' });
        await flushPromises();
        expect(typeof starter.findComponent({ name: 'TaskAgentStrip' }).vm.$attrs.run.onStop).toBe('function');

        const other = mountPanel({ roleType: 3, userId: 'u2' });
        await flushPromises();
        expect(other.findComponent({ name: 'TaskAgentStrip' }).vm.$attrs.run.onStop).toBeNull();
    });

    it('maps a run waiting for approval to the review state', async () => {
        openRuns.rows = [{ _id: 'run-2', agentName: 'Intake', status: 'waiting_approval', startedAt: '2026-09-04T10:00:00.000Z' }];
        const wrapper = mountPanel();
        await flushPromises();
        const run = wrapper.findComponent({ name: 'TaskAgentStrip' }).vm.$attrs.run;
        expect(run.status).toBe('review');
        expect(run.onStop).toBeNull();
    });

    describe('an outside agent session', () => {
        const fakeSocket = () => {
            const handlers = {};
            return { id: 'sock-1', handlers, on: vi.fn((event, fn) => { handlers[event] = fn; }), off: vi.fn(), emit: vi.fn() };
        };
        const activeSession = { id: 's1', taskId: 'task-1', clientName: 'Coder', state: 'active', createdAt: '2026-09-21T10:00:00.000Z', firstActivityAt: '2026-09-21T10:00:03.000Z', activities: [{ type: 'thought', text: 'Reading the brief', at: '2026-09-21T10:00:03.000Z' }] };

        it('asks for no session while the flag is off', async () => {
            const { apiRequest } = await import('@/services');
            flags.agentSessions = false;
            openRuns.rows = [];
            mountPanel();
            await flushPromises();
            expect(apiRequest.mock.calls.some(([, url]) => String(url).includes('/agent-sessions'))).toBe(false);
        });

        it('feeds the strip from the open session on the task', async () => {
            flags.agentSessions = true;
            openRuns.rows = [];
            sessions.rows = [activeSession];
            const wrapper = mountPanel();
            await flushPromises();
            const run = wrapper.findComponent({ name: 'TaskAgentStrip' }).vm.$attrs.run;
            expect(run).toMatchObject({ agentName: 'Coder', status: 'running', startedAt: '2026-09-21T10:00:03.000Z', session: { state: 'active' } });
            flags.agentSessions = false;
            sessions.rows = [];
        });

        it('shows an activity pushed over the socket without waiting for the poll', async () => {
            flags.agentSessions = true;
            openRuns.rows = [];
            sessions.rows = [];
            const socket = fakeSocket();
            const wrapper = mountPanel({ socket });
            await flushPromises();
            expect(wrapper.findComponent({ name: 'TaskAgentStrip' }).exists()).toBe(false);
            socket.handlers.taskDetail_agentSession({ ...activeSession, activities: [...activeSession.activities, { type: 'action', text: 'Pushed a branch', at: '2026-09-21T10:00:05.000Z' }] });
            await flushPromises();
            const run = wrapper.findComponent({ name: 'TaskAgentStrip' }).vm.$attrs.run;
            expect(run.session.activities.map((a) => a.type)).toEqual(['thought', 'action']);
            socket.handlers.taskDetail_agentSession({ ...activeSession, taskId: 'task-2', state: 'failed' });
            await flushPromises();
            expect(wrapper.findComponent({ name: 'TaskAgentStrip' }).vm.$attrs.run.session.state).toBe('active');
            wrapper.unmount();
            expect(socket.off).toHaveBeenCalledWith('taskDetail_agentSession', expect.any(Function));
            flags.agentSessions = false;
        });
    });

    describe('navigation and quick actions', () => {
        const navAt = (index, total) => ({
            index,
            total,
            prev: index > 0 ? { taskId: `t${index - 1}` } : null,
            next: index < total - 1 ? { taskId: `t${index + 1}` } : null
        });
        const reset = () => {
            for (const key of Object.keys(perms)) delete perms[key];
            for (const key of Object.keys(exposed)) delete exposed[key];
            projectPayload.sprintsObj = [];
            projectPayload.sprintsfolders = [];
            projectPayload.tasks[0] = { _id: 'task-1', TaskName: 'Write spec', TaskKey: 'AH-1', statusKey: 'st-open', statusType: 'open', AssigneeUserId: [], isParentTask: true };
        };

        it('moves to the previous and next task of the view and names both buttons', async () => {
            reset();
            const wrapper = mountPanel({ nav: navAt(1, 3) });
            await flushPromises();
            const prev = wrapper.get('[data-nav-dir="prev"]');
            const next = wrapper.get('[data-nav-dir="next"]');
            expect(prev.attributes('aria-label')).toBe('Previous task');
            expect(next.attributes('aria-label')).toBe('Next task');
            expect(wrapper.get('.ah-detail__nav-pos').text()).toBe('2 / 3');
            await next.trigger('click');
            await prev.trigger('click');
            expect(wrapper.emitted('step')).toEqual([[1], [-1]]);
        });

        it('disables the arrow that would run past either end', async () => {
            reset();
            const first = mountPanel({ nav: navAt(0, 2) });
            await flushPromises();
            expect(first.get('[data-nav-dir="prev"]').element.disabled).toBe(true);
            expect(first.get('[data-nav-dir="next"]').element.disabled).toBe(false);
            const last = mountPanel({ nav: navAt(1, 2) });
            await flushPromises();
            expect(last.get('[data-nav-dir="next"]').element.disabled).toBe(true);
            await last.get('[data-nav-dir="next"]').trigger('click');
            expect(last.emitted('step')).toBeUndefined();
        });

        it('shows no arrows when the task was opened from outside a list', async () => {
            reset();
            const wrapper = mountPanel({ nav: null });
            await flushPromises();
            expect(wrapper.find('[data-nav-dir]').exists()).toBe(false);
        });

        it('copies the task key, then the link, from the header', async () => {
            reset();
            const writeText = vi.fn(() => Promise.resolve());
            Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
            toast.success = vi.fn();
            const wrapper = mountPanel();
            await flushPromises();
            const key = wrapper.get('button.ah-detail__key');
            expect(key.text()).toBe('AH-1');
            expect(key.attributes('aria-label')).toBe('Copy task ID AH-1');
            await key.trigger('click');
            await flushPromises();
            expect(writeText).toHaveBeenLastCalledWith('AH-1');
            expect(toast.success).toHaveBeenCalledTimes(1);

            const link = wrapper.get('button.ah-detail__copy-link');
            expect(link.attributes('aria-label')).toBe('Copy task link');
            await link.trigger('click');
            await flushPromises();
            expect(writeText).toHaveBeenLastCalledWith(expect.stringMatching(/#\/company-1\/project\/proj-1\/s\/sprint-1\/task-1$/));
            expect(toast.success).toHaveBeenCalledTimes(2);
        });

        it('completes the task from the button beside the status and reopens it', async () => {
            reset();
            updateStatus.mockClear();
            const wrapper = mountPanel();
            await flushPromises();
            const complete = wrapper.get('button.ah-detail__complete');
            expect(complete.attributes('aria-pressed')).toBe('false');
            await complete.trigger('click');
            await flushPromises();
            expect(updateStatus.mock.calls[0][0].newStatus).toMatchObject({ statusKey: 'st-done', statusType: 'close' });
            expect(complete.attributes('aria-pressed')).toBe('true');
            await complete.trigger('click');
            await flushPromises();
            expect(updateStatus.mock.calls[1][0].newStatus).toMatchObject({ statusKey: 'st-open', statusType: 'open' });
            expect(complete.attributes('aria-pressed')).toBe('false');
        });

        it('does not let a member without the status permission complete the task', async () => {
            reset();
            perms['task.task_status'] = false;
            const wrapper = mountPanel();
            await flushPromises();
            expect(wrapper.get('button.ah-detail__complete').element.disabled).toBe(true);
        });

        it('offers subtask, relation, checklist and attachment actions below the description', async () => {
            reset();
            exposed['TaskSubtaskList.startCreate'] = vi.fn();
            exposed['LinkedTasks.startAdding'] = vi.fn();
            exposed['TaskDetailTab.addChecklist'] = vi.fn();
            exposed['TaskDetailTab.attachFile'] = vi.fn();
            const wrapper = mountPanel();
            await flushPromises();
            const row = wrapper.get('.ah-detail__quick');
            expect(row.attributes('role')).toBe('group');
            const labels = row.findAll('button').map((button) => button.text());
            expect(labels).toEqual(['Add subtask', 'Relate', 'Checklist', 'Attach']);

            await row.get('[data-action="checklist"]').trigger('click');
            await flushPromises();
            expect(exposed['TaskDetailTab.addChecklist']).toHaveBeenCalledTimes(1);

            await row.get('[data-action="subtask"]').trigger('click');
            await flushPromises();
            expect(exposed['TaskSubtaskList.startCreate']).toHaveBeenCalledTimes(1);
            expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toContain('Subtasks');
        });

        it('opens the relation picker and the file picker from the action row', async () => {
            reset();
            exposed['LinkedTasks.startAdding'] = vi.fn();
            exposed['TaskDetailTab.attachFile'] = vi.fn();
            const wrapper = mountPanel();
            await flushPromises();
            await wrapper.get('[data-action="relate"]').trigger('click');
            await flushPromises();
            expect(exposed['LinkedTasks.startAdding']).toHaveBeenCalledTimes(1);

            await wrapper.findAll('[role="tab"]').find((tab) => tab.text().startsWith('Description')).trigger('click');
            await wrapper.get('[data-action="attach"]').trigger('click');
            await flushPromises();
            expect(exposed['TaskDetailTab.attachFile']).toHaveBeenCalledTimes(1);
        });

        it('hides the actions a member may not use', async () => {
            reset();
            perms['task.task_checklist'] = false;
            perms['task.task_attachments'] = false;
            perms['task.sub_task_create'] = false;
            const wrapper = mountPanel();
            await flushPromises();
            const labels = wrapper.get('.ah-detail__quick').findAll('button').map((button) => button.text());
            expect(labels).toEqual(['Relate']);
        });
    });

    describe('the phone header chips', () => {
        beforeEach(() => {
            for (const key of Object.keys(perms)) delete perms[key];
            for (const key of Object.keys(apps)) delete apps[key];
            projectPayload.sprintsObj = [];
            projectPayload.sprintsfolders = [];
            projectPayload.tasks[0] = { _id: 'task-1', TaskName: 'Write spec', TaskKey: 'AH-1', statusKey: 'st-open', statusType: 'open', AssigneeUserId: [], Task_Priority: 'high' };
        });

        it('shows the priority chip when the Priority app is on', async () => {
            const wrapper = mountPanel({ width: 390 });
            await flushPromises();
            expect(wrapper.get('.ah-detail__chips').text()).toContain('High');
        });

        it('shows no priority chip when the Priority app is off, as the properties list does', async () => {
            apps.Priority = false;
            const wrapper = mountPanel({ width: 390 });
            await flushPromises();
            expect(wrapper.get('.ah-detail__chips').text()).not.toContain('High');
        });

        it('shows no priority chip to a member who may not see priority', async () => {
            perms['task.task_priority'] = null;
            const wrapper = mountPanel({ width: 390 });
            await flushPromises();
            expect(wrapper.get('.ah-detail__chips').text()).not.toContain('High');
        });
    });

    describe('undo and the desktop tracker', () => {
        beforeEach(() => {
            for (const key of Object.keys(perms)) delete perms[key];
            for (const key of Object.keys(exposed)) delete exposed[key];
            projectPayload.sprintsObj = [];
            projectPayload.sprintsfolders = [];
            projectPayload.tasks[0] = { _id: 'task-1', TaskName: 'Write spec', TaskKey: 'AH-1', statusKey: 'st-open', statusType: 'open', AssigneeUserId: [], isParentTask: true };
        });

        it('offers undo after ticking done and puts the previous status back', async () => {
            updateStatus.mockClear();
            const wrapper = mountPanel();
            await flushPromises();
            await wrapper.get('button.ah-detail__complete').trigger('click');
            await flushPromises();
            expect(undoToast.current).not.toBeNull();
            await runUndo();
            await flushPromises();
            expect(updateStatus).toHaveBeenCalledTimes(2);
            const undo = updateStatus.mock.calls[1][0];
            expect(undo.newStatus).toMatchObject({ statusKey: 'st-open', statusType: 'open' });
            expect(undo.prevStatus).toMatchObject({ statusName: 'Done', updatedTaskName: 'Open' });
            dismissUndoToast();
        });

        it('opens the desktop tracker hand-off from the more menu', async () => {
            exposed['TaskTrackerHandoff.start'] = vi.fn();
            const wrapper = mountPanel();
            await flushPromises();
            wrapper.findComponent({ name: 'TaskDetailAction' }).vm.$emit('open', 'tracker');
            await flushPromises();
            expect(exposed['TaskTrackerHandoff.start']).toHaveBeenCalledTimes(1);
        });
    });

    describe('the phone status chip', () => {
        const stored = { ...projectPayload.taskStatusData[0] };
        beforeEach(() => {
            projectPayload.sprintsObj = [];
            projectPayload.sprintsfolders = [];
            projectPayload.tasks[0] = { _id: 'task-1', TaskName: 'Write spec', TaskKey: 'AH-1', statusKey: 'st-open', statusType: 'open', AssigneeUserId: [] };
            Object.assign(projectPayload.taskStatusData[0], { textColor: '#ff9600', bgColor: '#ff960035' });
        });
        afterEach(() => Object.assign(projectPayload.taskStatusData[0], stored));

        it('keeps the status name readable on a workspace colour', async () => {
            const wrapper = mountPanel({ width: 390 });
            await flushPromises();
            const chip = wrapper.get('.ah-detail__chips button.ah-chip');
            const style = chip.element.style;
            expect(chip.text()).toContain('Open');
            expect(chip.classes()).toContain('ah-status-ink');
            expect(worstContrast(inkOf(style), style.background, 'light')).toBeGreaterThanOrEqual(4.5);
            expect(worstContrast(style.getPropertyValue('--status-ink-dark'), style.background, 'dark')).toBeGreaterThanOrEqual(4.5);
        });
    });
});
