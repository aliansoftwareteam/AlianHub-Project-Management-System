const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { moveTasks } = require('../../Tasks/helpers/moveTasks');

const OPEN = 0;
const TRASHED = 1;
const ARCHIVED = 2;
const TASK_ARCHIVED = 7;
const TASK_CLOSED = 8;
const CLOSE = 'close';
const MARK = 'trashedWithProject';

const LIFECYCLE_FIELDS = 'status statusType deletedStatusKey trashedFromKey';

const keyOf = (value) => Number(value) || OPEN;
const has = (object, field) => Boolean(object) && Object.prototype.hasOwnProperty.call(object, field);
const isKey = (value) => value !== undefined && value !== null && Number.isInteger(Number(value));

/* The key a project's live tasks carry in each state: a task with any other key was put away on its own and is
 * never moved by the project. Tasks that leave with a trashed project are marked, so a task trashed on its own
 * before stays in the trash when the project comes back. */
const taskKeyFor = ({ deletedStatusKey, statusType } = {}) => {
    const key = keyOf(deletedStatusKey);
    if (key === TRASHED) return { keys: [TRASHED], marked: true };
    if (key === ARCHIVED) return { keys: [TASK_ARCHIVED], marked: false };
    if (statusType === CLOSE) return { keys: [TASK_CLOSED], marked: false };
    return { keys: [OPEN], marked: false };
};

const touchesLifecycle = (updateObject, key) => (!key || key === '$set')
    && (has(updateObject, 'deletedStatusKey') || has(updateObject, 'statusType'));

/* A project trashed before trashedFromKey existed comes back open with every task its old restore took: 1 and 7. */
const LEGACY_TRASH = { keys: [TRASHED, TASK_ARCHIVED], marked: false };

const planLifecycle = (before = {}, updateObject = {}) => {
    const after = {
        deletedStatusKey: has(updateObject, 'deletedStatusKey') ? updateObject.deletedStatusKey : before.deletedStatusKey,
        statusType: has(updateObject, 'statusType') ? updateObject.statusType : before.statusType,
    };
    const stamp = {};
    const wasClosed = before.statusType === CLOSE;
    const isClosed = after.statusType === CLOSE;
    if (!wasClosed && isClosed) stamp.statusBeforeClose = before.status === undefined ? null : before.status;
    if (wasClosed && !isClosed) stamp.statusBeforeClose = null;

    const fromKey = keyOf(before.deletedStatusKey);
    const toKey = keyOf(after.deletedStatusKey);
    const leavesTrash = fromKey === TRASHED && toKey !== TRASHED;
    const legacy = leavesTrash && !isKey(before.trashedFromKey);
    if (fromKey !== TRASHED && toKey === TRASHED) stamp.trashedFromKey = fromKey;
    if (leavesTrash && !legacy) stamp.trashedFromKey = null;

    const from = legacy ? LEGACY_TRASH : taskKeyFor(before);
    const to = taskKeyFor(after);
    const same = !legacy && from.keys[0] === to.keys[0];
    return { stamp, move: same ? null : { from: from.keys, fromMarked: from.marked, to: to.keys[0], toMarked: to.marked } };
};

const restoreTargetOf = (before = {}) => (isKey(before.trashedFromKey) ? Number(before.trashedFromKey) : OPEN);

const readLifecycle = (companyId, projectId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECTS,
    data: [{ _id: new mongoose.Types.ObjectId(String(projectId)) }, LIFECYCLE_FIELDS],
}, 'findOne');

/* Tasks written before deletedStatusKey was required have none, and live with the open ones. */
const keysFilter = (keys) => {
    if (keys.includes(OPEN)) return { $in: [...keys, null] };
    return keys.length === 1 ? keys[0] : { $in: keys };
};

const applyMove = async (companyId, projectId, move, options) => {
    if (!move) return null;
    const ProjectID = new mongoose.Types.ObjectId(String(projectId));
    const filter = { ProjectID, deletedStatusKey: keysFilter(move.from), ...(move.fromMarked ? { [MARK]: true } : {}) };
    const update = { $set: { deletedStatusKey: move.to, ...(move.toMarked ? { [MARK]: true } : {}) } };
    if (move.fromMarked) update.$unset = { [MARK]: '' };
    const result = await moveTasks(companyId, filter, update, { deletedStatusKey: move.to }, options);
    if (move.fromMarked) {
        // A task restored on its own while the project was in the trash keeps the mark; it must not follow the project next time.
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ ProjectID, [MARK]: { $exists: true } }, { $unset: { [MARK]: '' } }] }, 'updateMany');
    }
    return result;
};

module.exports = {
    LIFECYCLE_FIELDS,
    taskKeyFor,
    touchesLifecycle,
    planLifecycle,
    restoreTargetOf,
    readLifecycle,
    applyMove,
};
