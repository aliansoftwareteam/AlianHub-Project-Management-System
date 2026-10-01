/* The client's reading of the rules in Modules/Tasks/helpers/taskTree.js. The server decides;
 * this only keeps the panel and the parent picker from offering what it would refuse. */

export const MAX_DEPTH = 2;

const TREE_REFUSAL_CODES = Object.freeze(["PARENT_AT_MAX_DEPTH", "SUBTREE_TOO_DEEP", "PARENT_NOT_FOUND"]);

export const ancestorsOf = (task) => (task && Array.isArray(task.ancestors) ? task.ancestors.map(String) : []);

/* A subtask written before the chain existed has none and still sits one level down; a task
 * made top-level again may keep a stale chain, so the parent link decides first. */
export const depthOf = (task) => (task?.ParentTaskId ? Math.max(ancestorsOf(task).length, 1) : 0);

export const canAddSubtask = (task) => depthOf(task) < MAX_DEPTH;

export const subtreeHeight = (top, descendants = []) => descendants.reduce((height, row) => Math.max(height, depthOf(row) - depthOf(top)), 0);

export const deepestParentDepth = (height = 0) => MAX_DEPTH - 1 - height;

export const canBeParentOf = (candidate, task, height = 0) => {
    if (!candidate?._id || !task?._id) return false;
    const taskId = String(task._id);
    const chain = ancestorsOf(candidate);
    if (String(candidate._id) === taskId || String(candidate.ParentTaskId || "") === taskId || chain.includes(taskId)) return false;
    if (candidate.ParentTaskId && !chain.length) return false;
    return depthOf(candidate) <= deepestParentDepth(height);
};

export const parentCandidateMatch = (task, height = 0) => {
    const deepest = deepestParentDepth(height);
    if (deepest < 0) return null;
    const levels = [{ isParentTask: true }];
    for (let depth = 1; depth <= deepest; depth += 1) levels.push({ ancestors: { $size: depth } });
    return { $and: [{ $or: levels }, { ancestors: { $ne: String(task._id) } }] };
};

export const treeRefusalReason = (rejection) => {
    const body = rejection?.error?.response?.data || rejection?.response?.data;
    return body && TREE_REFUSAL_CODES.includes(body.code) && typeof body.statusText === "string" ? body.statusText : "";
};
