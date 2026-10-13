import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/locales/en.js';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/services', () => ({ apiRequest }));
vi.mock('@/store/index', () => ({ default: { getters: {} } }));

import { logTime } from '@/composable/useTimer';
import { timeLogFailureKey } from '@/composable/timeLogFailure';

const read = (rel) => fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8');
const task = { taskId: 't1', taskName: 'Task', projectId: 'p1', projectName: 'Project' };

beforeEach(() => apiRequest.mockReset());

describe('a refusal for an approved timesheet period', () => {
    it('reaches the caller with the server\'s code', async () => {
        apiRequest.mockResolvedValue({ data: { status: false, code: 'period_locked', statusText: 'This timesheet period is approved and locked.' } });

        await expect(logTime({ task, minutes: 30, date: '2026-03-02' })).rejects.toMatchObject({ code: 'period_locked' });
    });

    it('is shown with its own translated message, other failures keep theirs', () => {
        expect(timeLogFailureKey({ code: 'period_locked' }, 'Time.log_failed')).toBe('Time.period_locked');
        expect(timeLogFailureKey(new Error('log_failed'), 'Time.log_failed')).toBe('Time.log_failed');
        expect(timeLogFailureKey(undefined, 'Home.timer_log_failed')).toBe('Home.timer_log_failed');
        expect(en.Time.period_locked).toMatch(/approved/);
    });

    it.each([
        'views/TimeLog/LogTimeSheet.vue',
        'views/Timesheet/UserTimeSheet/UserTimesheet.vue',
        'views/Home/TodayOverdue.vue',
        'components/organisms/TaskDetailOverlay/TaskTimerChip.vue',
    ])('is what %s shows when logging fails', (file) => {
        expect(read(file)).toContain('timeLogFailureKey(');
    });
});
