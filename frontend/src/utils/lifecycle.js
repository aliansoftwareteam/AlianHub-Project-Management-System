/* CommonJS on purpose: webpack consumes it in the app and root Jest loads it untranspiled. */
const ACTIVE = 'active';
const ARCHIVED = 'archived';
const CLOSED = 'closed';
const TRASHED = 'trashed';

/* deletedStatusKey values as the server writes them today.
   Tasks inherit a key from the container that archived or closed them:
   3 parent task, 4 sprint archived, 5 sprint closed, 6 folder archived,
   7 project archived, 8 project closed. */
const KEYS = {
    project: { [ARCHIVED]: 2, [TRASHED]: 1, [ACTIVE]: 0 },
    sprint: { [ARCHIVED]: 2, [CLOSED]: 5, [TRASHED]: 1, [ACTIVE]: 0 },
    task: { [ARCHIVED]: 2, [TRASHED]: 1, [ACTIVE]: 0 }
};

const TASK_ARCHIVED = new Set([2, 3, 4, 6, 7]);
const TASK_CLOSED = new Set([5, 8]);

function lifecycleOf(doc, kind = 'project') {
    const key = Number(doc && doc.deletedStatusKey) || 0;
    if (key === 1) return TRASHED;
    if (kind === 'task') {
        if (TASK_ARCHIVED.has(key)) return ARCHIVED;
        if (TASK_CLOSED.has(key)) return CLOSED;
        return ACTIVE;
    }
    if (kind === 'sprint') {
        if (key === 2) return ARCHIVED;
        if (key === 5) return CLOSED;
        return ACTIVE;
    }
    if (key === 2) return ARCHIVED;
    if (doc && doc.statusType === 'close') return CLOSED;
    return ACTIVE;
}

function keyFor(kind, state) {
    const table = KEYS[kind];
    if (!table || !(state in table)) throw new Error(`no lifecycle key for ${kind}/${state}`);
    return table[state];
}

const isActive = (doc, kind) => lifecycleOf(doc, kind) === ACTIVE;

module.exports = { ACTIVE, ARCHIVED, CLOSED, TRASHED, lifecycleOf, keyFor, isActive };
