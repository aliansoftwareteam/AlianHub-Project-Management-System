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
 * mapped onto an existing project status (falls back to the first status).
 *
 * Each task also carries the rich card data the importer enriches it with after
 * creation — checklists, comments, labels, attachments (as link references) and
 * member emails. Note: Trello JSON exports usually OMIT member emails (privacy)
 * and host attachment URLs behind auth, so member-mapping is best-effort and
 * attachments are kept as links rather than downloaded. Pure — no I/O. */
const parseTrelloBoard = ({ board, statusNames, leaderId }) => {
    const lists = Array.isArray(board.lists) ? board.lists : [];
    const listById = {};
    lists.filter((list) => list && !list.closed).forEach((list) => {
        listById[String(list.id)] = String(list.name || '');
    });

    // card id → [{ name, items: [{ name, isChecked }] }]
    const checklistsByCard = {};
    (Array.isArray(board.checklists) ? board.checklists : []).forEach((cl) => {
        if (!cl || !cl.idCard) return;
        const items = (Array.isArray(cl.checkItems) ? cl.checkItems : [])
            .slice()
            .sort((a, b) => ((a && a.pos) || 0) - ((b && b.pos) || 0))
            .map((ci) => ({ name: String((ci && ci.name) || '').trim().slice(0, 500), isChecked: !!(ci && ci.state === 'complete') }))
            .filter((ci) => ci.name);
        if (!items.length && !cl.name) return;
        (checklistsByCard[String(cl.idCard)] = checklistsByCard[String(cl.idCard)] || [])
            .push({ name: String(cl.name || 'Checklist').trim().slice(0, 200), items });
    });

    // card id → [{ text, author, date }] (Trello stores comments as commentCard actions)
    const commentsByCard = {};
    (Array.isArray(board.actions) ? board.actions : []).forEach((action) => {
        if (!action || action.type !== 'commentCard' || !action.data || !action.data.card) return;
        const cardId = String(action.data.card.id || '');
        const text = String((action.data && action.data.text) || '').trim();
        if (!cardId || !text) return;
        const author = (action.memberCreator && (action.memberCreator.fullName || action.memberCreator.username)) || '';
        (commentsByCard[cardId] = commentsByCard[cardId] || [])
            .push({ text: text.slice(0, 10000), author: String(author), date: action.date || null });
    });

    // member id → email (usually absent in JSON exports → best-effort assignee mapping)
    const emailByMemberId = {};
    (Array.isArray(board.members) ? board.members : []).forEach((member) => {
        if (member && member.id && member.email) {
            emailByMemberId[String(member.id)] = String(member.email).trim().toLowerCase();
        }
    });

    const tasks = [];
    let skipped = 0;
    (board.cards || []).forEach((card) => {
        if (!card || card.closed || !String(card.name || '').trim()) { skipped += 1; return; }
        const cardId = String(card.id || '');
        const listName = listById[String(card.idList)] || '';
        const due = card.due ? new Date(card.due) : null;
        const labels = (Array.isArray(card.labels) ? card.labels : [])
            .map((label) => ({ name: String((label && label.name) || '').trim(), color: String((label && label.color) || '').trim() }))
            .filter((label) => label.name || label.color);
        const attachments = (Array.isArray(card.attachments) ? card.attachments : [])
            .map((att) => ({ name: String((att && (att.name || att.url)) || '').slice(0, 300), url: String((att && att.url) || ''), bytes: (att && Number(att.bytes)) || 0 }))
            .filter((att) => att.url);
        const memberEmails = (Array.isArray(card.idMembers) ? card.idMembers : [])
            .map((id) => emailByMemberId[String(id)])
            .filter(Boolean);
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
            // Rich card data, enriched onto the task after creation (S3-01).
            checklists: checklistsByCard[cardId] || [],
            comments: commentsByCard[cardId] || [],
            labels,
            attachments,
            memberEmails,
        });
    });
    return { tasks, skipped, listNames: Object.values(listById) };
};

module.exports = { MAX_CARDS, validateTrelloInput, parseTrelloBoard };
