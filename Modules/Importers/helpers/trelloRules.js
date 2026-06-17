// Trello-import rules. Pure — no I/O — shared by the controller and the tests.
// Input: a Trello board JSON export (Menu → Print/Export → Export as JSON):
//   { name, lists: [{ id, name, closed }], cards: [{ name, desc, due, idList, closed }] }
// Lists become the source status names (mapped onto the project's existing
// statuses); open cards become tasks in the shape createMultipleTasks expects.
const { isObjectIdString, mapStatusName } = require('./jiraRules');

const MAX_CARDS = 2000;

const validateTrelloInput = ({ companyId, projectId, sprintId, board, userId }) => {
    if (!companyId) return { valid: false, reason: 'companyId is required.' };
    if (!userId) return { valid: false, reason: 'userId is required.' };
    if (!isObjectIdString(projectId)) return { valid: false, reason: 'A valid projectId is required.' };
    if (!isObjectIdString(sprintId)) return { valid: false, reason: 'A valid sprintId is required.' };
    if (!board || typeof board !== 'object' || !Array.isArray(board.cards)) {
        return { valid: false, reason: 'A Trello board export with a cards array is required.' };
    }
    const openCards = board.cards.filter((card) => card && !card.closed);
    if (!openCards.length) return { valid: false, reason: 'No open cards found in the board export.' };
    if (openCards.length > MAX_CARDS) return { valid: false, reason: `At most ${MAX_CARDS} cards per import.` };
    return { valid: true, reason: '' };
};

/* Parse a Trello board export → { tasks, skipped, listNames }.
 * Closed lists/cards and nameless cards are skipped; each card's list name is
 * mapped onto an existing project status (falls back to the first status). */
const parseTrelloBoard = ({ board, statusNames, leaderId }) => {
    const lists = Array.isArray(board.lists) ? board.lists : [];
    const listById = {};
    lists.filter((list) => list && !list.closed).forEach((list) => {
        listById[String(list.id)] = String(list.name || '');
    });

    const tasks = [];
    let skipped = 0;
    (board.cards || []).forEach((card) => {
        if (!card || card.closed || !String(card.name || '').trim()) { skipped += 1; return; }
        const listName = listById[String(card.idList)] || '';
        const due = card.due ? new Date(card.due) : null;
        tasks.push({
            TaskName: String(card.name).trim().slice(0, 500),
            status: mapStatusName(listName, statusNames),
            Task_Priority: 'Normal',
            TaskType: 'task',
            TaskTypeKey: 1,
            Task_Leader: leaderId,
            AssigneeUserId: [],
            DueDate: due && !Number.isNaN(due.getTime()) ? due.toISOString() : null,
            rawDescription: String(card.desc || '').slice(0, 10000),
            ParentTaskId: '',
        });
    });
    return { tasks, skipped, listNames: Object.values(listById) };
};

module.exports = { MAX_CARDS, validateTrelloInput, parseTrelloBoard };
