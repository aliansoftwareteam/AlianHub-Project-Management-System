/* A stand-in for Modules/Tasks/helpers/taskReadAccess in a suite about some other rule, whose world is the
 * projects Modules/Agents/scope says a person can open: a task is read by whoever can open its project. The rule
 * itself, private lists included, is asked in tests/ai-task-reads-open-rule, automation-reads-open-rule,
 * workflow-run-task-rule and task-read-batch-matches-single. */
const taskReadByProject = () => {
    const opens = async (companyId, uid, task) => Boolean(task && task.ProjectID)
        && (await require('../../Modules/Agents/scope').visibleProjectIds(companyId, uid) || []).map(String).includes(String(task.ProjectID));
    const readableTasks = async (companyId, uid, rows) => {
        const kept = [];
        for (const row of rows || []) {
            if (await opens(companyId, uid, row)) kept.push(row);
        }
        return kept;
    };
    return { canReadTask: opens, readableTasks, TASK_READ_FIELDS: Object.freeze({ ProjectID: 1, sprintId: 1, mainChat: 1, AssigneeUserId: 1 }) };
};

/* A stand-in for Modules/Comments/helpers/readerRows in a suite about the rows themselves: nothing is kept from the reader. */
const nothingKeptFromReader = () => ({
    mentionsKeptFromReader: async () => ({}),
    noticesKeptFromReader: async () => ({}),
    inboxRowsKeptFromReader: async () => ({ notification: {}, mention: {} }),
    withoutKept: (match, kept) => (Object.keys(kept).length ? { $and: [match, kept] } : match),
});

module.exports = { taskReadByProject, nothingKeptFromReader };
