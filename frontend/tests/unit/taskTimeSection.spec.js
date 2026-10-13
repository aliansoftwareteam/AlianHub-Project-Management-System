import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { ref } from 'vue';

const { apiRequest, toast } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}));
vi.mock('@/services', () => ({ apiRequest }));
vi.mock('vue-toast-notification', () => ({ useToast: () => toast }));
vi.mock('@/composable', () => ({
    useGetterFunctions: () => ({ getUser: (id) => ({ u1: { Employee_Name: 'Mira Member' }, u2: { Employee_Name: 'Tom Teammate' } }[id]) })
}));
vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));
vi.mock('@/components/organisms/TaskDetailOverlay/TaskTimerChip.vue', () => ({
    default: { name: 'TaskTimerChip', props: ['task', 'project', 'canStart'], render: () => null }
}));

import TaskTimeSection from '@/components/organisms/TaskDetailOverlay/TaskTimeSection.vue';
import en from '@/locales/en.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);

const TASK = { _id: 'task-1', TaskName: 'Write spec', ProjectID: 'proj-1', sprintId: 'sprint-1', totalEstimatedTime: 240 };
const ENTRIES = '/api/v1/timesheet/task/task-1';
const at = (iso) => Math.floor(new Date(iso).getTime() / 1000);

let data;
const serve = () => apiRequest.mockImplementation(async (method, url) => {
    if (url === ENTRIES) return { data: { status: true, data } };
    if (url === '/api/v2/manualLogtime' || url === '/api/v2/deleteManualLogtime') return { data: { status: true } };
    return { data: { status: false } };
});

const mountSection = (props = {}) => mount(TaskTimeSection, {
    props: { task: TASK, project: { _id: 'proj-1', ProjectName: 'Launch' }, canTrack: true, ...props },
    global: {
        plugins: [createStore({ getters: { 'settings/companyOwnerDetail': () => ({ userId: 'owner-1' }), 'settings/companyDateFormat': () => ({ dateFormat: 'DD/MM/YYYY' }) } })],
        mocks: { $t: i18n.global.t },
        provide: { $userId: ref('u1'), $companyId: ref('company-1') }
    }
});

beforeEach(() => {
    apiRequest.mockReset();
    data = {
        taskId: 'task-1',
        estimateMinutes: 240,
        totalMinutes: 165,
        mineMinutes: 45,
        seesEveryone: false,
        entries: [
            { _id: 'e1', userId: 'u1', startedAt: at('2026-09-22T09:00:00'), endedAt: at('2026-09-22T09:45:00'), minutes: 45, note: 'Draft', billable: true, source: 'manual', locked: false, running: false, canEdit: true },
            { _id: 'e2', userId: 'u1', startedAt: at('2026-09-14T09:00:00'), endedAt: at('2026-09-14T10:00:00'), minutes: 60, note: 'Old', billable: true, source: 'manual', locked: true, running: false, canEdit: false }
        ]
    };
    serve();
});

describe('the Time section of the task panel', () => {
    it('lists the task\'s entries with who, when and how long, and the total against the estimate', async () => {
        const wrapper = mountSection();
        await flushPromises();

        expect(apiRequest).toHaveBeenCalledWith('get', ENTRIES);
        const rows = wrapper.findAll('[data-test="time-entry"]');
        expect(rows).toHaveLength(2);
        expect(rows[0].text()).toContain('Mira Member');
        expect(rows[0].text()).toContain('45m');
        expect(rows[0].text()).toContain('Draft');
        expect(wrapper.get('[data-test="time-total"]').text()).toBe('2h 45m of 4h 00m');
        expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('165');
        expect(wrapper.text()).toContain("the total includes everyone's");
    });

    it('offers edit and delete only on entries the rules let the caller change', async () => {
        const wrapper = mountSection();
        await flushPromises();
        const [open, locked] = wrapper.findAll('[data-test="time-entry"]');
        expect(open.find('[data-test="time-edit"]').exists()).toBe(true);
        expect(open.find('[data-test="time-delete"]').exists()).toBe(true);
        expect(locked.find('[data-test="time-edit"]').exists()).toBe(false);
        expect(locked.text()).toContain('Locked');
    });

    it('adds time manually through the manual time route and refreshes the list', async () => {
        const wrapper = mountSection();
        await flushPromises();
        await wrapper.get('[data-test="time-add"]').trigger('click');
        await wrapper.get('[data-test="time-date"]').setValue('2026-09-24');
        await wrapper.get('[data-test="time-start"]').setValue('13:30');
        await wrapper.get('[data-test="time-hours"]').setValue(1);
        await wrapper.get('[data-test="time-minutes"]').setValue(15);
        await wrapper.get('[data-test="time-note"]').setValue('Review');
        await wrapper.get('[data-test="time-billable"]').setValue(false);
        await wrapper.get('form').trigger('submit');
        await flushPromises();

        const call = apiRequest.mock.calls.find(([, url]) => url === '/api/v2/manualLogtime');
        expect(call[0]).toBe('post');
        expect(call[2]).toMatchObject({
            logTimeDate: '2026-09-24', startLogTime: '13:30', endLogTime: '14:45', timeDuration: '01:15', description: 'Review',
            ticketId: 'task-1', projectId: 'proj-1', userId: 'u1', isEdit: false, billable: false, companyId: 'company-1', companyOwnerId: 'owner-1', sprintId: 'sprint-1'
        });
        expect(apiRequest.mock.calls.filter(([, url]) => url === ENTRIES)).toHaveLength(2);
        expect(wrapper.find('form').exists()).toBe(false);
    });

    it('edits an entry as an edit of that record', async () => {
        const wrapper = mountSection();
        await flushPromises();
        await wrapper.get('[data-test="time-edit"]').trigger('click');
        await wrapper.get('[data-test="time-minutes"]').setValue(30);
        await wrapper.get('form').trigger('submit');
        await flushPromises();

        const call = apiRequest.mock.calls.find(([, url]) => url === '/api/v2/manualLogtime');
        expect(call[2]).toMatchObject({ isEdit: true, timeSheetId: 'e1', previousLoggedTime: '00:45', timeDuration: '00:30', userId: 'u1' });
    });

    it('shows the locked-period refusal instead of closing the form', async () => {
        apiRequest.mockImplementation(async (method, url) => {
            if (url === ENTRIES) return { data: { status: true, data } };
            return { data: { status: false, code: 'period_locked', statusText: 'locked' } };
        });
        const wrapper = mountSection();
        await flushPromises();
        await wrapper.get('[data-test="time-add"]').trigger('click');
        await wrapper.get('form').trigger('submit');
        await flushPromises();

        expect(wrapper.get('[role="alert"]').text()).toBe(en.Time.period_locked);
        expect(wrapper.find('form').exists()).toBe(true);
    });

    it('deletes an entry after a second press', async () => {
        const wrapper = mountSection();
        await flushPromises();
        const remove = wrapper.get('[data-test="time-delete"]');
        await remove.trigger('click');
        expect(apiRequest.mock.calls.some(([, url]) => url === '/api/v2/deleteManualLogtime')).toBe(false);
        await remove.trigger('click');
        await flushPromises();

        const call = apiRequest.mock.calls.find(([, url]) => url === '/api/v2/deleteManualLogtime');
        expect(call[2]).toMatchObject({ timeSheetId: 'e1', userId: 'u1', timeDuration: 45, ticketId: 'task-1', projectId: 'proj-1' });
    });

    it('hands the timer to anyone the panel allows to track', async () => {
        const wrapper = mountSection({ canTrack: true });
        await flushPromises();
        expect(wrapper.findComponent({ name: 'TaskTimerChip' }).props('canStart')).toBe(true);
    });
});
