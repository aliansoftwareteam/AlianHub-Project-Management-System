const R = require('../frontend/src/views/Projects/composables/taskRisk');

const NOW = new Date('2026-09-03T12:00:00Z').getTime();
const DAY = R.DAY_MS;
const at = (days) => new Date(NOW + days * DAY).toISOString();

const task = (overrides) => Object.assign({
    _id: 't1',
    TaskName: 'Task',
    statusType: 'active',
    status: { text: 'In Progress', type: 'active' },
    Updated_At: at(0),
}, overrides);

const score = (overrides) => R.taskRisk(task(overrides), { now: NOW }).score;
const factorKeys = (overrides) => R.taskRisk(task(overrides), { now: NOW }).factors.map((f) => f.key);

describe('taskRisk basics', () => {
    test('a fresh task with nothing wrong scores 0', () => {
        expect(score({})).toBe(0);
        expect(R.taskRisk(task({}), { now: NOW }).top).toBeNull();
    });

    test('a closed task never carries risk, however late it is', () => {
        const closed = task({ statusType: 'close', status: { text: 'Done', type: 'close' }, DueDate: at(-30) });
        expect(R.taskRisk(closed, { now: NOW })).toEqual({ score: 0, level: 'low', factors: [], top: null });
    });

    test('junk input is safe', () => {
        expect(R.taskRisk(null, { now: NOW }).score).toBe(0);
        expect(R.taskRisk(undefined).score).toBe(0);
        expect(score({ DueDate: 'not-a-date' })).toBe(0);
    });

    test('the same task always scores the same', () => {
        const t = task({ DueDate: at(-4), totalEstimatedTime: 600, remainingHours: 0 });
        expect(R.taskRisk(t, { now: NOW }).score).toBe(R.taskRisk(t, { now: NOW }).score);
    });
});

describe('overdue', () => {
    test('due today or in the future adds nothing', () => {
        expect(score({ DueDate: at(0) })).toBe(0);
        expect(score({ DueDate: at(5) })).toBe(0);
    });

    test('grows with the days late and caps at its weight', () => {
        const oneDay = score({ DueDate: at(-1) });
        const threeDays = score({ DueDate: at(-3) });
        expect(oneDay).toBe(11);
        expect(threeDays).toBeGreaterThan(oneDay);
        expect(score({ DueDate: at(-90) })).toBe(R.WEIGHTS.overdue);
    });
});

describe('blocked', () => {
    test('a status the project named "Blocked" counts', () => {
        expect(factorKeys({ status: { text: 'Blocked', type: 'active' } })).toContain('blocked');
    });

    test('a blocked_by relation counts even when the status does not say so', () => {
        expect(factorKeys({ relations: [{ type: 'blocked_by', taskId: 'x' }] })).toContain('blocked');
    });

    test('a relates_to relation does not', () => {
        expect(factorKeys({ relations: [{ type: 'relates_to', taskId: 'x' }] })).not.toContain('blocked');
    });

    test('an old block outweighs a fresh one and caps at its weight', () => {
        const fresh = R.taskRisk(task({ status: { text: 'Blocked' } }), { now: NOW });
        const stale = R.taskRisk(task({ status: { text: 'Blocked' }, Updated_At: at(-20), lastMessage: at(-20) }), { now: NOW });
        expect(fresh.factors[0].points).toBe(10);
        expect(stale.factors.find((f) => f.key === 'blocked').points).toBe(R.WEIGHTS.blocked);
    });
});

describe('estimate vs logged', () => {
    test('inside the estimate adds nothing', () => {
        expect(score({ totalEstimatedTime: 600, remainingHours: 200 })).toBe(0);
        expect(score({ totalEstimatedTime: 600, remainingHours: 0 })).toBe(0);
    });

    test('no estimate means the factor cannot fire', () => {
        expect(factorKeys({ totalEstimatedTime: 0, remainingHours: -600 })).not.toContain('burn');
    });

    test('an overrun scores in proportion and caps at double the estimate', () => {
        const half = R.taskRisk(task({ totalEstimatedTime: 600, remainingHours: -300 }), { now: NOW });
        expect(half.factors.find((f) => f.key === 'burn')).toMatchObject({ points: 9, overPct: 50 });
        expect(score({ totalEstimatedTime: 600, remainingHours: -3000 })).toBe(R.WEIGHTS.burn);
    });
});

describe('comment silence', () => {
    test('three quiet days are still fine', () => {
        expect(score({ Updated_At: at(-3), lastMessage: at(-3) })).toBe(0);
    });

    test('after the grace period it grows and caps', () => {
        expect(score({ Updated_At: at(-7), lastMessage: at(-7) })).toBe(6);
        expect(score({ Updated_At: at(-60), lastMessage: at(-60) })).toBe(R.WEIGHTS.silence);
    });

    test('the newest of updatedAt / lastMessage wins', () => {
        expect(score({ Updated_At: at(-30), lastMessage: at(0) })).toBe(0);
    });
});

describe('subtask completion', () => {
    const subs = (done, open) => [].concat(
        Array.from({ length: done }, (_, i) => ({ _id: `d${i}`, statusType: 'close' })),
        Array.from({ length: open }, (_, i) => ({ _id: `o${i}`, statusType: 'active' })),
    );

    test('all subtasks done adds nothing', () => {
        expect(factorKeys({ subtaskArray: subs(3, 0), DueDate: at(0) })).not.toContain('subtasks');
    });

    test('unfinished subtasks weigh more when the due date is on top of you', () => {
        const pressing = R.taskRisk(task({ subtaskArray: subs(1, 3), DueDate: at(1) }), { now: NOW });
        const distant = R.taskRisk(task({ subtaskArray: subs(1, 3), DueDate: at(20) }), { now: NOW });
        expect(pressing.factors.find((f) => f.key === 'subtasks')).toMatchObject({ points: 8, done: 1, total: 4 });
        expect(distant.factors.find((f) => f.key === 'subtasks').points).toBe(3);
    });

    test('a task with no subtasks loaded does not fire the factor', () => {
        expect(factorKeys({ subTasks: 0, DueDate: at(1) })).not.toContain('subtasks');
    });
});

describe('score, level and the top factor', () => {
    test('factors add up and are ordered by weight', () => {
        const result = R.taskRisk(task({
            DueDate: at(-5),
            status: { text: 'Blocked', type: 'active' },
            Updated_At: at(-10),
            lastMessage: at(-10),
            totalEstimatedTime: 600,
            remainingHours: -600,
        }), { now: NOW });
        expect(result.factors.map((f) => f.key)).toEqual(['overdue', 'blocked', 'burn', 'silence']);
        expect(result.top.key).toBe('overdue');
        expect(result.score).toBe(result.factors.reduce((sum, f) => sum + f.points, 0));
    });

    test('the score never passes 100', () => {
        const result = R.taskRisk(task({
            DueDate: at(-200),
            status: { text: 'Blocked', type: 'active' },
            Updated_At: at(-200),
            lastMessage: at(-200),
            totalEstimatedTime: 60,
            remainingHours: -6000,
            subtaskArray: [{ _id: 'a', statusType: 'active' }],
        }), { now: NOW });
        expect(result.score).toBe(100);
        expect(result.level).toBe('high');
    });

    test('levels split low / med / high', () => {
        expect(R.riskLevel(0)).toBe('low');
        expect(R.riskLevel(R.LOW_MAX)).toBe('low');
        expect(R.riskLevel(R.LOW_MAX + 1)).toBe('med');
        expect(R.riskLevel(R.MED_MAX)).toBe('med');
        expect(R.riskLevel(R.MED_MAX + 1)).toBe('high');
        expect(R.riskLevel(100)).toBe('high');
    });
});
