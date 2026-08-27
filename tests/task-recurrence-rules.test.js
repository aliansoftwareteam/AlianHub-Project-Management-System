const {
    normalizeFreq,
    nextOccurrenceDates,
    shouldSpawnNext,
    buildNextOccurrenceTask,
    RECURRENCE_FREQ,
} = require('../Modules/Tasks/helpers/taskMongo/recurrenceRules');

const TASK_ID = '64b7f0c2a1b2c3d4e5f60718';

function weeklyTask(overrides = {}) {
    return {
        _id: TASK_ID,
        TaskName: 'Weekly standup notes',
        TaskKey: 'SMOKE-1',
        AssigneeUserId: ['u-ada'],
        watchers: [],
        DueDate: new Date(2026, 7, 27),
        startDate: new Date(2026, 7, 26),
        TaskType: 'task',
        TaskTypeKey: 1,
        ProjectID: '64b7f0c2a1b2c3d4e5f60711',
        CompanyId: '64b7f0c2a1b2c3d4e5f60700',
        Task_Leader: 'u-ada',
        sprintArray: { id: 's1', name: 'List' },
        Task_Priority: 'MEDIUM',
        sprintId: 's1',
        description: 'Take notes',
        recurrence: { freq: 'week' },
        relations: [{ type: 'blocks', taskId: '64b7f0c2a1b2c3d4e5f60719' }],
        ...overrides,
    };
}

describe('due-date recurrence', () => {
    test('week and month are the only freqs; weekly/monthly aliases normalize', () => {
        expect(normalizeFreq('week')).toBe(RECURRENCE_FREQ.WEEK);
        expect(normalizeFreq('weekly')).toBe(RECURRENCE_FREQ.WEEK);
        expect(normalizeFreq('month')).toBe(RECURRENCE_FREQ.MONTH);
        expect(normalizeFreq('monthly')).toBe(RECURRENCE_FREQ.MONTH);
        expect(normalizeFreq('year')).toBe('');
        expect(normalizeFreq({ freq: 'week' })).toBe('week');
    });

    test('next occurrence is exactly one week or one month later — never a year of clones', () => {
        const week = nextOccurrenceDates({
            startDate: new Date(2026, 7, 26),
            dueDate: new Date(2026, 7, 27),
            freq: 'week',
        });
        expect(week.DueDate.getFullYear()).toBe(2026);
        expect(week.DueDate.getMonth()).toBe(8);
        expect(week.DueDate.getDate()).toBe(3);
        expect(week.startDate.getDate()).toBe(2);

        const month = nextOccurrenceDates({
            dueDate: new Date(2026, 7, 27),
            freq: 'month',
        });
        expect(month.DueDate.getFullYear()).toBe(2026);
        expect(month.DueDate.getMonth()).toBe(8);
        expect(month.DueDate.getDate()).toBe(27);
        expect(month.startDate).toBeNull();
    });

    test('spawn-next-on-complete: only when moving to close, with a freq, and not already spawned', () => {
        expect(shouldSpawnNext({
            prevStatusType: 'default_active',
            nextStatusType: 'close',
            recurrence: { freq: 'week' },
        })).toBe(true);
        expect(shouldSpawnNext({
            prevStatusType: 'default_active',
            nextStatusType: 'close',
            recurrence: { freq: 'month' },
        })).toBe(true);
        expect(shouldSpawnNext({
            prevStatusType: 'close',
            nextStatusType: 'close',
            recurrence: { freq: 'week' },
        })).toBe(false);
        expect(shouldSpawnNext({
            prevStatusType: 'default_active',
            nextStatusType: 'active',
            recurrence: { freq: 'week' },
        })).toBe(false);
        expect(shouldSpawnNext({
            prevStatusType: 'default_active',
            nextStatusType: 'close',
            recurrence: {},
        })).toBe(false);
        expect(shouldSpawnNext({
            prevStatusType: 'default_active',
            nextStatusType: 'close',
            recurrence: { freq: 'week', spawnedTaskId: 'already' },
        })).toBe(false);
    });

    test('completing a weekly task builds exactly one next task, not a year', () => {
        const dates = nextOccurrenceDates({
            startDate: weeklyTask().startDate,
            dueDate: weeklyTask().DueDate,
            freq: 'week',
        });
        const next = buildNextOccurrenceTask(weeklyTask(), { dates, spawnedFromId: TASK_ID });
        expect(next.TaskName).toBe('Weekly standup notes');
        expect(next.statusType).not.toBe('close');
        expect(next.relations).toEqual([]);
        expect(next.recurrence.freq).toBe('week');
        expect(next.recurrence.spawnedFromId).toBe(TASK_ID);
        expect(next.DueDate.getFullYear()).toBe(2026);
        expect(next.DueDate.getMonth()).toBe(8);
        expect(next.DueDate.getDate()).toBe(3);

        const year = [];
        let cursor = weeklyTask();
        for (let i = 0; i < 3; i++) {
            const step = nextOccurrenceDates({
                startDate: cursor.startDate,
                dueDate: cursor.DueDate,
                freq: 'week',
            });
            year.push(buildNextOccurrenceTask(cursor, { dates: step, spawnedFromId: cursor._id }));
            cursor = { ...cursor, DueDate: step.DueDate, startDate: step.startDate };
        }
        expect(year).toHaveLength(3);
        expect(year.length).toBeLessThan(52);
    });
});
