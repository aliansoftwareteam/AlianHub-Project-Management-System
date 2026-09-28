const { SCHEMA_TYPE } = require('../../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../../utils/mongo-handler/mongoQueries');
const { getTask, ruleOwner, recordAutomationAudit, oid, DeterministicError } = require('../tools');
const assignees = require('../assignees');

const plainTask = (task) => (task && task.toObject ? task.toObject() : task);

/* One person per write through the task panel's own assignee path, so history, notifications, watchers and the socket
 * event are the panel's. The event names the automation and sits one level deeper, which is what keeps an assign rule
 * on "assignee changes" from waking itself. */
const applyPlan = async (companyId, task, plan, context) => {
    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(task.ProjectID) }, { ProjectName: 1 }],
    }, 'findOne');
    if (!project) throw new DeterministicError(`project ${task.ProjectID} not found`);
    // Required here: the Tasks helpers pull in LogTime and storage, which must not load just because the engine did.
    const assignment = require('../../../Tasks/helpers/taskMongo/updateAssignment');
    const shared = {
        projectData: { _id: String(project._id), ProjectName: project.ProjectName || '', CompanyId: String(companyId) },
        taskData: { _id: String(task._id), TaskName: task.TaskName || '', sprintId: task.sprintId || '', folderObjId: task.folderObjId || '' },
        userData: { id: context.actingUserId || null, Employee_Name: `Automation "${context.ruleName || 'Automation'}"` },
        isUpdateTask: true,
        eventActor: { kind: 'automation', userId: null },
        eventDepth: (Number(context.depth) || 0) + 1,
    };
    const writes = [
        ...plan.removed.map((person) => ({ person, type: 'assigneRemove' })),
        ...plan.added.map((person) => ({ person, type: 'assigneeAdd' })),
    ];
    for (const { person, type } of writes) {
        // eslint-disable-next-line no-await-in-loop
        await assignment.updateAssignee({ ...shared, type, firebaseObj: { AssigneeUserId: person.userId }, employeeName: person.name || person.userId });
    }
    recordAutomationAudit(companyId, context, {
        action: 'automation.task.assign',
        entityType: 'task',
        entityId: String(task._id),
        entityName: task.TaskName || '',
        meta: { runId: context.runId || null, ruleId: context.ruleId || null, added: plan.added.map((p) => p.userId), removed: plan.removed.map((p) => p.userId) },
    });
};

module.exports = {
    key: 'assign',
    label: 'Assign to',
    appliesTo: ['task'],
    scopes: ['task.assign'],
    schema: {
        mode: { type: 'select', label: 'Mode', required: true, options: assignees.MODES },
        userIds: { type: 'user_multi', label: 'People', roles: assignees.ROLES },
        roundRobin: { type: 'boolean', label: 'Take turns' },
    },
    validate: (config, options) => assignees.configErrors(config, options),

    /* What run() would do, from the turn the rule has reached, without taking the turn or writing. */
    async preview({ companyId, task, config, context = {}, cursor = 0 }) {
        const plan = await assignees.planAssignment({ companyId, task: plainTask(task), config, context, cursor });
        return { mode: plan.mode, roundRobin: plan.roundRobin, wouldAssign: plan.targets, wouldRemove: plan.removed, skipped: plan.skipped, changed: plan.changed };
    },

    async run({ companyId, entity, config, context = {} }) {
        if (!assignees.MODES.includes(config.mode)) throw new DeterministicError(`mode must be one of ${assignees.MODES.join(', ')} — got "${config.mode}"`);
        const task = plainTask(await getTask(companyId, entity.id));
        const cursor = assignees.rotates(config) ? await assignees.claimTurn(companyId, context.ruleId, context.stepId) : 0;
        const plan = await assignees.planAssignment({ companyId, task, config, context, cursor });
        if (plan.passedOver) await assignees.claimTurn(companyId, context.ruleId, context.stepId, plan.passedOver);

        if (plan.changed) {
            const actingUserId = context.actingUserId || await ruleOwner(companyId, context.ruleId);
            await applyPlan(companyId, task, plan, { ...context, actingUserId });
        }
        return {
            changed: plan.changed,
            mode: plan.mode,
            assigned: plan.added,
            removed: plan.removed,
            skipped: plan.skipped,
            assignees: plan.changed ? plan.next : plan.current,
        };
    },
};
