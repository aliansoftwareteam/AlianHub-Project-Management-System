// Task-to-task relation rules. Pure data + validation — no I/O — so the
// route dispatcher, the relations mixin, and the unit tests share one
// source of truth.

const RELATION_TYPES = Object.freeze({
    BLOCKS: 'blocks',
    BLOCKED_BY: 'blocked_by',
    DUPLICATES: 'duplicates',
    DUPLICATED_BY: 'duplicated_by',
    RELATES_TO: 'relates_to',
});

const RELATION_TYPE_LIST = Object.freeze(Object.values(RELATION_TYPES));

// Every link is stored on BOTH task documents: the initiating side keeps
// `type`, the related side keeps INVERSE_RELATION[type]. `relates_to` is
// symmetric, so it is its own inverse.
const INVERSE_RELATION = Object.freeze({
    [RELATION_TYPES.BLOCKS]: RELATION_TYPES.BLOCKED_BY,
    [RELATION_TYPES.BLOCKED_BY]: RELATION_TYPES.BLOCKS,
    [RELATION_TYPES.DUPLICATES]: RELATION_TYPES.DUPLICATED_BY,
    [RELATION_TYPES.DUPLICATED_BY]: RELATION_TYPES.DUPLICATES,
    [RELATION_TYPES.RELATES_TO]: RELATION_TYPES.RELATES_TO,
});

// Human wording used in history messages and list responses:
// "<TaskKey> <label> <TaskKey>", e.g. "AH-12 is blocked by AH-34".
const RELATION_LABELS = Object.freeze({
    [RELATION_TYPES.BLOCKS]: 'blocks',
    [RELATION_TYPES.BLOCKED_BY]: 'is blocked by',
    [RELATION_TYPES.DUPLICATES]: 'duplicates',
    [RELATION_TYPES.DUPLICATED_BY]: 'is duplicated by',
    [RELATION_TYPES.RELATES_TO]: 'relates to',
});

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

const isObjectIdString = (id) => OBJECT_ID_PATTERN.test(String(id || ''));

/* Validate a single task reference (used by `list`). */
const validateTaskRef = ({ companyId, taskId }) => {
    if (!companyId) {
        return { valid: false, reason: 'companyId is required.' };
    }
    if (!isObjectIdString(taskId)) {
        return { valid: false, reason: 'A valid taskId is required.' };
    }
    return { valid: true, reason: '' };
};

/* Validate a pair of tasks (used by `remove`, where type is irrelevant). */
const validateRelationPair = ({ companyId, taskId, relatedTaskId }) => {
    const refCheck = validateTaskRef({ companyId, taskId });
    if (!refCheck.valid) {
        return refCheck;
    }
    if (!isObjectIdString(relatedTaskId)) {
        return { valid: false, reason: 'A valid relatedTaskId is required.' };
    }
    if (String(taskId) === String(relatedTaskId)) {
        return { valid: false, reason: 'A task cannot be linked to itself.' };
    }
    return { valid: true, reason: '' };
};

/* Validate the full add-relation input (pair + relation type). */
const validateRelationInput = ({ companyId, taskId, relatedTaskId, type }) => {
    const pairCheck = validateRelationPair({ companyId, taskId, relatedTaskId });
    if (!pairCheck.valid) {
        return pairCheck;
    }
    if (!INVERSE_RELATION[type]) {
        return { valid: false, reason: `Unknown relation type "${type}". Allowed: ${RELATION_TYPE_LIST.join(', ')}.` };
    }
    return { valid: true, reason: '' };
};

module.exports = {
    RELATION_TYPES,
    RELATION_TYPE_LIST,
    INVERSE_RELATION,
    RELATION_LABELS,
    isObjectIdString,
    validateTaskRef,
    validateRelationPair,
    validateRelationInput,
};
