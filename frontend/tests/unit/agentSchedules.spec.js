import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (key) => key } } }));

import AgentSchedules from '@/views/Ai/AgentSchedules.vue';
import { blankSchedule, nextRunText, scheduleError, schedulePayload, scheduleForm, describeSchedule, REPORT_KEYS } from '@/views/Ai/agentSchedule';

const t = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);

const ROW = {
    _id: 's1', agentId: 'a1', ownerId: 'user-1', report: 'daily_briefing', every: 'weekdays', at: '08:30', timezone: 'Europe/Berlin',
    enabled: true, deliver: { email: true }, options: {}, nextRunAt: '2026-09-29T06:30:00.000Z',
    lastResult: { status: 'done', runId: 'r9', at: '2026-09-28T06:30:02.000Z' }
};

describe('the schedule helpers', () => {
    it('offers the four built-in reports', () => {
        expect(REPORT_KEYS).toEqual(['daily_briefing', 'deadline_watch', 'mentions_digest', 'weekly_status']);
    });

    it('starts a new schedule in the viewer\'s own time zone, on weekdays, emailing nobody', () => {
        const form = blankSchedule('Asia/Kolkata');
        expect(form).toMatchObject({ report: 'daily_briefing', every: 'weekdays', at: '09:00', timezone: 'Asia/Kolkata', email: false, enabled: true });
    });

    it('names what is wrong before anything is sent', () => {
        expect(scheduleError({ ...blankSchedule('UTC'), at: '9am' })).toBe('Ai.schedule_error_time');
        expect(scheduleError({ ...blankSchedule('UTC'), timezone: '' })).toBe('Ai.schedule_error_timezone');
        expect(scheduleError({ ...blankSchedule('UTC'), report: 'deadline_watch', days: 0 })).toBe('Ai.schedule_error_days');
        expect(scheduleError(blankSchedule('UTC'))).toBe('');
    });

    it('sends only what the server stores, and a weekday only for a weekly schedule', () => {
        const payload = schedulePayload({ ...blankSchedule('UTC'), every: 'weekdays', weekday: 3, taskId: ' ', pageProjectId: '' });
        expect(payload).toEqual({ report: 'daily_briefing', every: 'weekdays', at: '09:00', timezone: 'UTC', enabled: true, options: {}, deliver: { email: false } });
        const weekly = schedulePayload({ ...blankSchedule('UTC'), every: 'weekly', weekday: 5, report: 'deadline_watch', days: 4, taskId: 'task-1' });
        expect(weekly).toMatchObject({ every: 'weekly', weekday: 5, options: { days: 4 }, deliver: { email: false, taskId: 'task-1' } });
    });

    it('reads a stored schedule back into the editor', () => {
        expect(scheduleForm(ROW)).toMatchObject({ report: 'daily_briefing', every: 'weekdays', at: '08:30', timezone: 'Europe/Berlin', email: true });
    });

    it('says when the next run is, in the schedule\'s own time zone', () => {
        const text = nextRunText(t, ROW, { locale: 'en-GB' });
        expect(text).toContain('Ai.schedule_next_run');
        expect(text).toContain('08:30');
    });

    it('says a paused schedule will not run', () => {
        expect(nextRunText(t, { ...ROW, enabled: false })).toBe('Ai.schedule_off');
        expect(nextRunText(t, { ...ROW, nextRunAt: null })).toBe('Ai.schedule_next_unknown');
    });

    it('describes the rhythm in words', () => {
        expect(describeSchedule(t, ROW)).toContain('Ai.schedule_every_weekdays');
        expect(describeSchedule(t, { ...ROW, every: 'weekly', weekday: 1 })).toContain('Ai.schedule_every_weekly');
    });
});

const ok = (data) => Promise.resolve({ data: { status: true, data } });

const mountSchedules = async (props = {}, rows = [ROW]) => {
    apiRequest.mockImplementation((type) => (type === 'get' ? ok(rows) : ok({ ...ROW, _id: 's2' })));
    const wrapper = mount(AgentSchedules, {
        props: { agentId: 'a1', autonomy: 3, canManage: true, agentOwnerId: 'user-1', projects: [{ _id: 'p1', ProjectName: 'Launch' }], ...props },
        global: { stubs: { RouterLink: RouterLinkStub, ShellIcon: true } }
    });
    await flushPromises();
    return wrapper;
};

describe('the Schedule section on the agent page', () => {
    let wrapper;
    beforeEach(() => { apiRequest.mockReset(); });
    afterEach(() => { if (wrapper) wrapper.unmount(); wrapper = null; });

    it('explains that only an L3 agent can run on a schedule and offers no editor', async () => {
        wrapper = await mountSchedules({ autonomy: 2 });
        expect(wrapper.find('[data-test="schedule-needs-l3"]').text()).toBe('Ai.schedule_needs_l3');
        expect(wrapper.find('[data-test="schedule-add"]').exists()).toBe(false);
        expect(apiRequest).not.toHaveBeenCalled();
    });

    it('lists the schedules with their next run and a link to the last result', async () => {
        wrapper = await mountSchedules();
        expect(apiRequest).toHaveBeenCalledWith('get', '/api/v2/agents/a1/schedules');
        const row = wrapper.find('[data-test="schedule-row"]');
        expect(row.exists()).toBe(true);
        expect(row.find('[data-test="schedule-next"]').text()).toContain('Ai.schedule_next_run');
        const last = row.findComponent(RouterLinkStub);
        expect(last.props('to')).toMatchObject({ name: 'AiRun', params: { runId: 'r9' } });
    });

    it('saves a new schedule from the editor', async () => {
        wrapper = await mountSchedules({}, []);
        await wrapper.find('[data-test="schedule-add"]').trigger('click');
        await wrapper.find('[data-test="schedule-report"]').setValue('weekly_status');
        await wrapper.find('[data-test="schedule-every"]').setValue('weekly');
        await wrapper.find('[data-test="schedule-weekday"]').setValue('5');
        await wrapper.find('[data-test="schedule-at"]').setValue('16:00');
        await wrapper.find('[data-test="schedule-save"]').trigger('click');
        await flushPromises();
        const post = apiRequest.mock.calls.find(([type]) => type === 'post');
        expect(post[1]).toBe('/api/v2/agents/a1/schedules');
        expect(post[2]).toMatchObject({ report: 'weekly_status', every: 'weekly', weekday: 5, at: '16:00' });
    });

    it('says a report posted to a task only includes what its readers can see', async () => {
        wrapper = await mountSchedules({}, []);
        await wrapper.find('[data-test="schedule-add"]').trigger('click');
        expect(wrapper.find('[data-test="schedule-shared-note"]').exists()).toBe(false);
        await wrapper.find('[data-test="schedule-page"]').setValue('p1');
        expect(wrapper.find('[data-test="schedule-shared-note"]').text()).toBe('Ai.schedule_shared_scope_note');
    });

    it('does not send an editor with a bad time', async () => {
        wrapper = await mountSchedules({}, []);
        await wrapper.find('[data-test="schedule-add"]').trigger('click');
        await wrapper.find('[data-test="schedule-at"]').setValue('');
        await wrapper.find('[data-test="schedule-save"]').trigger('click');
        await flushPromises();
        expect(apiRequest.mock.calls.some(([type]) => type === 'post')).toBe(false);
        expect(wrapper.find('[data-test="schedule-error"]').text()).toBe('Ai.schedule_error_time');
    });

    it('shows the list read-only to someone who cannot manage it', async () => {
        wrapper = await mountSchedules({ canManage: false, agentOwnerId: 'someone-else' });
        expect(wrapper.find('[data-test="schedule-row"]').exists()).toBe(true);
        expect(wrapper.find('[data-test="schedule-add"]').exists()).toBe(false);
    });
});
