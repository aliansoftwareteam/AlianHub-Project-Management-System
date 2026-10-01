import { ancestorsOf } from "@taskTreeRules";

/* The task tree of one sprint, as the store keeps it: top-level tasks in `tasks`, each row's
 * children in its `subtaskArray`, three levels deep. A row whose parent has not arrived waits
 * in `waiting`, keyed by that parent's id, and joins the tree when the parent does. */

const idOf = (row) => String(row?._id ?? "");

export const childrenOf = (row) => (Array.isArray(row?.subtaskArray) ? row.subtaskArray : []);

/* "" for a top-level task, the parent's id for a subtask, null when the payload does not say.
 * ParentTaskId decides before the chain does: a task made top-level again can carry a stale one. */
export function parentIdOf(row) {
    if (row?.isParentTask === true) return "";
    if (row?.ParentTaskId) return String(row.ParentTaskId);
    const chain = ancestorsOf(row);
    return chain.length ? chain[chain.length - 1] : null;
}

export function* eachRow(rows) {
    for (const row of rows || []) {
        if (!row) continue;
        yield row;
        yield* eachRow(childrenOf(row));
    }
}

function locateIn(rows, id, parent = null) {
    for (let index = 0; index < (rows || []).length; index += 1) {
        const row = rows[index];
        if (idOf(row) === id) return { row, siblings: rows, index, parent };
        const below = locateIn(childrenOf(row), id, row);
        if (below) return below;
    }
    return null;
}

const waitingLists = (bucket) => Object.entries(bucket.waiting || {});

/* Finds a row in the tree or among the waiting rows. `held` names the parent a waiting row is kept for. */
export function locate(bucket, taskId) {
    const id = String(taskId ?? "");
    if (!id) return null;
    const inTree = locateIn(bucket.tasks, id);
    if (inTree) return inTree;
    for (const [heldFor, rows] of waitingLists(bucket)) {
        const found = locateIn(rows, id);
        if (found) return { ...found, held: found.parent ? undefined : heldFor };
    }
    return null;
}

/* The rows loaded under a task, wherever it is: in the tree, waiting, or not in the store at all. */
export function loadedChildren(bucket, taskId) {
    if (!bucket) return [];
    const found = locate(bucket, taskId);
    return found ? childrenOf(found.row) : bucket.waiting?.[String(taskId)] || [];
}

function adopt(bucket, row) {
    const held = bucket.waiting?.[idOf(row)];
    if (!held) return;
    const known = new Set(childrenOf(row).map(idOf));
    row.subtaskArray = [...childrenOf(row), ...held.filter((child) => !known.has(idOf(child)))];
    delete bucket.waiting[idOf(row)];
}

function attach(bucket, row, parentId) {
    adopt(bucket, row);
    if (!parentId) {
        bucket.tasks.push(row);
        return null;
    }
    const parent = locate(bucket, parentId)?.row;
    if (parent) {
        parent.subtaskArray = [...childrenOf(parent), row];
        return parent;
    }
    bucket.waiting = { ...(bucket.waiting || {}), [parentId]: [...(bucket.waiting?.[parentId] || []), row] };
    return null;
}

function detach(bucket, found) {
    found.siblings.splice(found.index, 1);
    if (found.held && !bucket.waiting[found.held].length) delete bucket.waiting[found.held];
}

/* Puts a row where its payload says it belongs, merging into the copy the store holds. A row
 * that names another parent than the one it sits under moves, with its own subtasks. A payload
 * that names no place only updates a row the store already has.
 * Returns the parent the row was newly put under, if any. */
export function placeRow(bucket, data) {
    const found = locate(bucket, data?._id);
    const wanted = parentIdOf(data);
    const current = found ? (found.held ?? idOf(found.parent)) : null;

    if (found && (wanted === null || wanted === current)) {
        found.siblings[found.index] = { ...found.row, ...data };
        return null;
    }
    if (wanted === null) return null;

    const row = { ...(found?.row || {}), ...data };
    if (found) detach(bucket, found);
    return attach(bucket, row, wanted);
}

/* Takes a row out with everything under it, and forgets the rows that were waiting for any of them. */
export function removeRow(bucket, taskId) {
    const found = locate(bucket, taskId);
    const gone = found ? [...eachRow([found.row])].map(idOf) : [String(taskId ?? "")];
    if (found) detach(bucket, found);
    while (gone.length) {
        const id = gone.pop();
        const held = bucket.waiting?.[id];
        if (!held) continue;
        gone.push(...[...eachRow(held)].map(idOf));
        delete bucket.waiting[id];
    }
    return found && !found.held ? found.parent : null;
}

/* Builds the tree of a flat result, as a search returns it. A row whose parents did not come is left out. */
export function treeOf(rows) {
    const bucket = { tasks: [], waiting: {} };
    (rows || []).forEach((row) => placeRow(bucket, { ...row }));
    return bucket.tasks.map((row) => (Array.isArray(row.subtaskArray) ? row : { ...row, subtaskArray: [] }));
}
