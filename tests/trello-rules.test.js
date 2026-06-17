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

// A board exercising the rich card data (checklists, comments, labels,
// attachments, members) the S3-01 importer enrichment consumes.
const richBoard = () => ({
    name: 'Rich Board',
    lists: [{ id: 'l1', name: 'To Do', closed: false }],
    members: [
        { id: 'm1', fullName: 'Jane Doe', username: 'jane', email: 'JANE@Example.com' },
        { id: 'm2', fullName: 'No Email', username: 'noemail' },
    ],
    cards: [
        {
            id: 'c1', name: 'Rich Card', desc: 'body', due: null, idList: 'l1', closed: false,
            idMembers: ['m1', 'm2'],
            labels: [{ name: 'Bug', color: 'red' }, { name: '', color: 'green' }, { name: '', color: '' }],
            attachments: [{ name: 'spec.pdf', url: 'https://trello.com/x/spec.pdf', bytes: 2048 }, { name: 'no-url', url: '' }],
        },
    ],
    checklists: [
        { id: 'cl1', idCard: 'c1', name: 'Acceptance', checkItems: [
            { name: 'Item 2', state: 'incomplete', pos: 200 },
            { name: 'Item 1', state: 'complete', pos: 100 },
            { name: '', state: 'incomplete', pos: 300 },
        ] },
    ],
    actions: [
        { type: 'commentCard', date: '2026-06-01T10:00:00.000Z', data: { text: 'Looks good', card: { id: 'c1' } }, memberCreator: { fullName: 'Jane Doe' } },
        { type: 'updateCard', date: '2026-06-01T11:00:00.000Z', data: { card: { id: 'c1' } } },
        { type: 'commentCard', date: '2026-06-02T10:00:00.000Z', data: { text: '   ', card: { id: 'c1' } } },
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

    test('plain board yields empty rich arrays (never undefined)', () => {
        const t = rules.parseTrelloBoard({ board: board(), statusNames: STATUSES, leaderId: 'u1' }).tasks[0];
        expect(t.checklists).toEqual([]);
        expect(t.comments).toEqual([]);
        expect(t.labels).toEqual([]);
        expect(t.attachments).toEqual([]);
        expect(t.memberEmails).toEqual([]);
    });
});

describe('trelloRules — parseTrelloBoard rich card data (S3-01)', () => {
    const richTask = () => rules.parseTrelloBoard({ board: richBoard(), statusNames: STATUSES, leaderId: 'u1' }).tasks[0];

    test('extracts checklists with items sorted by pos and state mapped, dropping empty items', () => {
        const t = richTask();
        expect(t.checklists).toHaveLength(1);
        expect(t.checklists[0].name).toBe('Acceptance');
        expect(t.checklists[0].items.map((i) => i.name)).toEqual(['Item 1', 'Item 2']);
        expect(t.checklists[0].items[0].isChecked).toBe(true);
        expect(t.checklists[0].items[1].isChecked).toBe(false);
    });

    test('extracts only commentCard actions that carry text', () => {
        const t = richTask();
        expect(t.comments).toHaveLength(1);
        expect(t.comments[0].text).toBe('Looks good');
        expect(t.comments[0].author).toBe('Jane Doe');
    });

    test('keeps labels with a name or color, drops fully-empty ones; keeps attachments with a url', () => {
        const t = richTask();
        expect(t.labels).toEqual([{ name: 'Bug', color: 'red' }, { name: '', color: 'green' }]);
        expect(t.attachments).toHaveLength(1);
        expect(t.attachments[0].url).toBe('https://trello.com/x/spec.pdf');
    });

    test('maps member emails where present (lowercased), skips members without an email', () => {
        expect(richTask().memberEmails).toEqual(['jane@example.com']);
    });
});

describe('trelloRules — validateTrelloInput', () => {
    const base = { companyId: 'c', userId: 'u', projectId: PID, sprintId: SID, board: board() };
    test('accepts a valid board', () => { expect(rules.validateTrelloInput(base).valid).toBe(true); });
    test('rejects a board without a cards array', () => { expect(rules.validateTrelloInput({ ...base, board: { name: 'x' } }).valid).toBe(false); });
    test('rejects a board with no open cards', () => { expect(rules.validateTrelloInput({ ...base, board: { cards: [{ name: 'c', closed: true }] } }).valid).toBe(false); });
    test('rejects a bad sprintId', () => { expect(rules.validateTrelloInput({ ...base, sprintId: 'x' }).valid).toBe(false); });
});
