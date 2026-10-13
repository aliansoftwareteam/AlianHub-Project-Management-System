jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const { readIntent, dueWindow } = require('../Modules/AI/askIntent');
const { taskClauses } = require('../Modules/AI/askStructured');
const { promptFor } = require('../Modules/AI/ask');

const ME = '6f0000000000000000000001';
const NOW = new Date('2026-09-28T09:00:00Z');

const URGENT_STARTER = 'Which of my open tasks are overdue, due soon or high priority? List the most urgent first.';

describe('"Find my urgent work" reads as one structured filter', () => {
    it('reads mine, not done, and the urgent window from the starter prompt', () => {
        const intent = readIntent(URGENT_STARTER, { selfId: ME });
        expect(intent.assignee).toEqual({ self: true, id: ME });
        expect(intent.due).toBe('urgent');
        expect(intent.filtered).toBe(true);
    });

    it('also reads plain "urgent work"', () => {
        expect(readIntent('what is my urgent work', { selfId: ME }).due).toBe('urgent');
    });

    it('keeps plain overdue and due soon as they were', () => {
        expect(readIntent('my overdue tasks', { selfId: ME }).due).toBe('overdue');
        expect(readIntent('my tasks due soon', { selfId: ME }).due).toBe('soon');
    });

    it('matches work that is overdue, due in the next seven days, or high or urgent priority, and never done', () => {
        const window = dueWindow('urgent', { now: NOW, timeZone: 'UTC' });
        expect(window.before.toISOString()).toBe('2026-10-06T00:00:00.000Z');
        const clauses = taskClauses({ due: 'urgent', status: { type: 'open' }, assignee: { self: true, id: ME } }, { now: NOW, timeZone: 'UTC' });
        const text = JSON.stringify(clauses, (key, value) => (value instanceof RegExp ? value.source : value));
        expect(text).toContain('"statusType":{"$nin"');
        expect(text).toContain('"AssigneeUserId":"6f0000000000000000000001"');
        const either = clauses.find((c) => c.$or && c.$or.some((o) => o.Task_Priority));
        expect(either).toBeDefined();
        expect(either.$or[0]).toEqual({ DueDate: { $lt: window.before, $ne: null } });
        expect(either.$or[1].Task_Priority.test('HIGH')).toBe(true);
        expect(either.$or[1].Task_Priority.test('urgent')).toBe(true);
        expect(either.$or[1].Task_Priority.test('MEDIUM')).toBe(false);
    });

    it('tells the model what the urgent filter covered', () => {
        const prompt = promptFor(URGENT_STARTER, [], {
            due: 'urgent', dueBefore: '2026-10-06', assignee: { self: true }, today: '2026-09-28', timeZone: 'UTC', total: 0, listed: 0,
        });
        expect(prompt).toMatch(/overdue, due before 2026-10-06, or high or urgent priority/);
    });
});
