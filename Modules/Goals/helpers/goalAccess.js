const WORKSPACE = 'workspace';
const PEOPLE = 'people';
const PRIVATE = 'private';
const VISIBILITIES = Object.freeze([WORKSPACE, PEOPLE, PRIVATE]);

/* Who may read a goal, as the clauses of one rule: the list query sends them to the database and
 * canSee reads the same clauses, so the two cannot drift apart. No clause names a role above member:
 * a private goal is its owner's alone, and a goal shared with people is theirs and the owner's. */
const readerClauses = (caller) => [
    { ownerUserId: caller.uid },
    { visibility: PEOPLE, sharedWith: caller.uid },
    caller.isGuest ? { visibility: WORKSPACE, sharedWith: caller.uid } : { visibility: WORKSPACE },
];

const visibleTo = (caller) => ({ $or: readerClauses(caller) });

const holds = (goal, clause) => Object.entries(clause)
    .every(([field, wanted]) => [].concat(goal[field] == null ? [] : goal[field]).map(String).includes(wanted));

const canSee = (goal, caller) => readerClauses(caller).some((clause) => holds(goal, clause));

const isOwner = (goal, caller) => String(goal.ownerUserId) === caller.uid;
const isNamed = (goal, caller) => (goal.sharedWith || []).map(String).includes(caller.uid);

const canCreate = (caller) => !caller.isGuest;

const canEdit = (goal, caller) => isOwner(goal, caller) || (goal.visibility === WORKSPACE && caller.isPrivileged);

/* Kept apart from canEdit so reporting a value can be opened to more people without touching who edits the goal. */
const canSetValue = (goal, caller) => canEdit(goal, caller);

module.exports = { WORKSPACE, PEOPLE, PRIVATE, VISIBILITIES, visibleTo, canSee, isOwner, isNamed, canCreate, canEdit, canSetValue };
