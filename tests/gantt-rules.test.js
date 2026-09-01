const {
    COLLISION_LINE,
    EMPTY_LINE,
    todayLineDate,
    planBarMove,
    fsCollision,
    collisionHints,
} = require('../Modules/Tasks/helpers/taskMongo/ganttRules');

const A = '64b7f0c2a1b2c3d4e5f60718';
const B = '64b7f0c2a1b2c3d4e5f60719';
const C = '64b7f0c2a1b2c3d4e5f6071a';

describe('Gantt drag — no cascade', () => {
    const tasks = [
        { _id: A, startDate: '2026-08-01', DueDate: '2026-08-05' },
        { _id: B, startDate: '2026-08-06', DueDate: '2026-08-10' },
        { _id: C, startDate: '2026-08-11', DueDate: '2026-08-14' },
    ];

    test('moving a bar only updates that task — blocked tasks stay put', () => {
        const plan = planBarMove({
            movedTaskId: A,
            startDate: '2026-08-08',
            dueDate: '2026-08-12',
            tasks,
        });
        expect(plan.cascade).toBe(false);
        expect(plan.updates).toEqual([{ taskId: A, startDate: '2026-08-08', dueDate: '2026-08-12' }]);
        expect(plan.updates).toHaveLength(1);
        expect(plan.dependentsUnchanged).toEqual([B, C]);
        expect(plan.dependentsUnchanged).not.toContain(A);
    });

    test('a date collision does not add a silent move of the successor', () => {
        const plan = planBarMove({
            movedTaskId: A,
            startDate: '2026-08-08',
            dueDate: '2026-08-20',
            tasks,
        });
        expect(plan.updates.map((row) => row.taskId)).toEqual([A]);
        expect(fsCollision({ predecessorDue: '2026-08-20', successorStart: '2026-08-06' })).toBe(true);
    });
});

describe('Gantt collision copper hint', () => {
    test('successor starting before predecessor due is a collision', () => {
        expect(fsCollision({ predecessorDue: '2026-08-10', successorStart: '2026-08-09' })).toBe(true);
        expect(fsCollision({ predecessorDue: '2026-08-10', successorStart: '2026-08-10' })).toBe(false);
        expect(fsCollision({ predecessorDue: '2026-08-10', successorStart: '2026-08-11' })).toBe(false);
    });

    test('blocks arrows that overlap get a copper in-place line, never a banner or a date rewrite', () => {
        const tasks = [
            { _id: A, DueDate: '2026-08-10', startDate: '2026-08-01', relations: [{ type: 'blocks', taskId: B }] },
            { _id: B, DueDate: '2026-08-20', startDate: '2026-08-08', relations: [{ type: 'blocked_by', taskId: A }] },
        ];
        const hints = collisionHints(tasks);
        expect(hints).toEqual([
            {
                sourceId: A,
                targetId: B,
                hint: 'collision',
                css: 'gantt-link--collision',
                line: COLLISION_LINE,
                banner: false,
            },
        ]);
        expect(COLLISION_LINE).toBe('Dates overlap. Blocked task stayed put.');
        expect(hints[0].banner).toBe(false);
        expect(tasks[1].startDate).toBe('2026-08-08');
    });

    test('empty copy is only the pine sentence', () => {
        expect(EMPTY_LINE).toBe('No scheduled tasks yet…');
        expect(EMPTY_LINE).not.toMatch(/give a task dates/);
    });

    test('today-line uses Asia/Kolkata when the host instant is still UTC Tuesday', () => {
        const utcTue = new Date(Date.UTC(2026, 8, 1, 20, 0, 0));
        const week = todayLineDate(utcTue, 'Week', 'Asia/Kolkata');
        const day = todayLineDate(utcTue, 'Day', 'Asia/Kolkata');
        expect(week.getFullYear()).toBe(2026);
        expect(week.getMonth()).toBe(8);
        expect(week.getDate()).toBe(2);
        expect(week.getHours()).toBe(12);
        expect(day.getHours()).toBe(0);
        expect(day.getDate()).toBe(2);
        const hostTue = todayLineDate(utcTue, 'Week', 'UTC');
        expect(hostTue.getDate()).toBe(1);
    });

    test('non-overlapping FS arrows have no hint', () => {
        const tasks = [
            { _id: A, DueDate: '2026-08-05', startDate: '2026-08-01', relations: [{ type: 'blocks', taskId: B }] },
            { _id: B, DueDate: '2026-08-20', startDate: '2026-08-06' },
        ];
        expect(collisionHints(tasks)).toEqual([]);
    });
});
