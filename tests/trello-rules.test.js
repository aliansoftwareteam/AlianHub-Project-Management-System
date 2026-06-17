const rules = require('../Modules/Importers/helpers/trelloRules');

const STATUSES = ['To Do', 'In Progress', 'Completed'];
const PID = '6571e7195470e64b120328dd';
const SID = '6a071189c7e0ff41978a57ce';

const board = () => ({
    name: 'My Board',
    lists: [
        { id: 'l1', name: 'To Do', closed: false },
        { id: 'l2', name: 'In Progress', closed: false },
        { id: 'l3', name: 'Archived List', closed: true },
    ],
    cards: [
        { name: 'Card A', desc: 'first', due: '2026-07-01T00:00:00.000Z', idList: 'l1', closed: false },
        { name: 'Card B', desc: '', due: null, idList: 'l2', closed: false },
        { name: 'Closed card', idList: 'l1', closed: true },
        { name: '', idList: 'l1', closed: false },
    ],
});

describe('trelloRules — parseTrelloBoard', () => {
    test('maps open cards to tasks with list-derived status; skips closed/nameless', () => {
        const { tasks, skipped, listNames } = rules.parseTrelloBoard({ board: board(), statusNames: STATUSES, leaderId: 'u1' });
        expect(tasks).toHaveLength(2);
        expect(skipped).toBe(2);
        expect(tasks[0].TaskName).toBe('Card A');
        expect(tasks[0].status).toBe('To Do');
        expect(tasks[0].DueDate).toContain('2026-07-01');
        expect(tasks[0].Task_Leader).toBe('u1');
        expect(tasks[1].status).toBe('In Progress');
        expect(listNames).toContain('To Do');
        expect(listNames).not.toContain('Archived List');
    });
});

describe('trelloRules — validateTrelloInput', () => {
    const base = { companyId: 'c', userId: 'u', projectId: PID, sprintId: SID, board: board() };
    test('accepts a valid board', () => { expect(rules.validateTrelloInput(base).valid).toBe(true); });
    test('rejects a board without a cards array', () => { expect(rules.validateTrelloInput({ ...base, board: { name: 'x' } }).valid).toBe(false); });
    test('rejects a board with no open cards', () => { expect(rules.validateTrelloInput({ ...base, board: { cards: [{ name: 'c', closed: true }] } }).valid).toBe(false); });
    test('rejects a bad sprintId', () => { expect(rules.validateTrelloInput({ ...base, sprintId: 'x' }).valid).toBe(false); });
});
