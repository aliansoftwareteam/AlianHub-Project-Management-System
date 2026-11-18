const { storedTask, ancestorsOf, MAX_DEPTH } = require('../Tasks/helpers/taskTree');

/* A chain is trusted only while it ends at the parent the row names: a task made top-level again can still hold an old one. */
const storedChain = (row) => {
    const chain = ancestorsOf(row);
    return chain.length && chain[chain.length - 1] === String(row.ParentTaskId) ? chain : null;
};

/* The tasks above a row, root first. Each holds a count of the unread comments below it, so a
 * level-three row reaches its parent and the root. A caller that names the parent (a row that
 * has just left it) is believed; otherwise the stored row says where it sits. */
const parentIdsOf = async (companyId, { taskId, parentTaskId }) => {
    let parentId = parentTaskId ? String(parentTaskId) : '';
    if (!parentId) {
        const task = await storedTask(companyId, taskId);
        if (!task || !task.ParentTaskId) return [];
        const chain = storedChain(task);
        if (chain) return chain;
        parentId = String(task.ParentTaskId);
    }
    const above = [];
    while (parentId && above.length < MAX_DEPTH && !above.includes(parentId)) {
        above.unshift(parentId);
        // eslint-disable-next-line no-await-in-loop
        const parent = await storedTask(companyId, parentId);
        if (!parent || !parent.ParentTaskId) break;
        const chain = storedChain(parent);
        if (chain) return [...new Set([...chain, ...above])].slice(-MAX_DEPTH);
        parentId = String(parent.ParentTaskId);
    }
    return above;
};

const parentCountFields = async (companyId, { projectId, sprintId, taskId, parentTaskId }) => (await parentIdsOf(companyId, { taskId, parentTaskId }))
    .map((id) => `parentTask_${projectId}_${sprintId}_${id}_comments`);

module.exports = { parentIdsOf, parentCountFields };
