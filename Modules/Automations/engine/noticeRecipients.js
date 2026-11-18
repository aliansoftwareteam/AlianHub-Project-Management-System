const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { nonMembersOf } = require('../../../Config/companyMembers');
const { canReadTask } = require('../../Tasks/helpers/taskReadAccess');
const { namesOf } = require('../../Workflows/people');

const TASK_ASSIGNEES = 'task_assignees';
const TASK_CREATOR = 'task_creator';
const TASK_WATCHERS = 'task_watchers';
const ROLES = [TASK_ASSIGNEES, TASK_CREATOR, TASK_WATCHERS];
const MAX_MESSAGE = 500;
const MAX_RECIPIENTS = 50;
const MAX_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const listed = (config = {}) => [...new Set((Array.isArray(config.recipients) ? config.recipients : [config.recipients])
    .filter((v) => v !== undefined && v !== null)
    .map((v) => String(v).trim())
    .filter(Boolean))];

const configErrors = (config = {}) => {
    const errors = [];
    const entries = listed(config);
    if (!entries.length) errors.push('recipients: name at least one person or role');
    if (entries.length > MAX_RECIPIENTS) errors.push(`recipients: at most ${MAX_RECIPIENTS} allowed`);
    entries.filter((e) => !OBJECT_ID.test(e) && !ROLES.includes(e))
        .forEach((e) => errors.push(`recipients: "${e}" is not a person of this workspace`));
    if (typeof config.message !== 'string' || !config.message.trim()) errors.push('message: required');
    else if (config.message.length > MAX_MESSAGE) errors.push(`message: must be ${MAX_MESSAGE} characters or fewer`);
    return errors;
};

const idsOf = (value) => (Array.isArray(value) ? value : [value]).filter(Boolean).map(String);

const peopleFor = (entry, task) => {
    if (entry === TASK_ASSIGNEES) return idsOf(task.AssigneeUserId);
    if (entry === TASK_CREATOR) return idsOf(task.Task_Leader);
    if (entry === TASK_WATCHERS) return idsOf(task.watchers);
    return [entry];
};

/* Who a notify step reaches on `task`. Only a live member who can open the task is told; whoever
 * caused the event is left out unless the rule opts in. Reads only. */
const planNotice = async ({ companyId, task = {}, config = {}, context = {} }) => {
    const wanted = [...new Set(listed(config).flatMap((entry) => peopleFor(entry, task)))];
    const actorId = config.includeActor === true || !context.actor || !context.actor.userId ? '' : String(context.actor.userId);
    const outsiders = new Set(await nonMembersOf(companyId, wanted));

    const reasons = {};
    for (const id of wanted) {
        if (id === actorId) reasons[id] = 'caused_event';
        else if (outsiders.has(id)) reasons[id] = 'not_a_member';
        // eslint-disable-next-line no-await-in-loop
        else if (!(await canReadTask(companyId, id, task))) reasons[id] = 'no_task_access';
    }

    const names = await namesOf(wanted);
    const named = (userId) => ({ userId, name: names[userId] || null });
    return {
        recipients: wanted.filter((id) => !reasons[id]).map(named),
        skipped: wanted.filter((id) => reasons[id]).map((id) => ({ ...named(id), reason: reasons[id] })),
    };
};

/* One more notice from `ruleId` to `userId` in the current clock hour, or false once the hour's limit is reached.
 * Every write is conditional, so two runs at once cannot take the same slot; none moves updatedAt, which
 * orders the rule list by when a person last edited a rule. */
const claimSlot = async (companyId, ruleId, userId, now = Date.now()) => {
    if (!OBJECT_ID.test(String(ruleId || '')) || !OBJECT_ID.test(String(userId || ''))) return false;
    const _id = new mongoose.Types.ObjectId(String(ruleId));
    const hour = Math.floor(now / HOUR_MS);
    const path = `notifyWindows.${userId}`;
    const write = (filter, update) => MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AUTOMATION_RULES, data: [{ _id, ...filter }, update, { returnDocument: 'after', timestamps: false }],
    }, 'findOneAndUpdate');

    const takeOne = () => write({ [`${path}.hour`]: hour, [`${path}.count`]: { $lt: MAX_PER_HOUR } }, { $inc: { [`${path}.count`]: 1 } });
    const openHour = () => write({ [`${path}.hour`]: { $ne: hour } }, { $set: { [path]: { hour, count: 1 } } });
    // The second takeOne is for the run that lost the race to open the hour.
    return Boolean(await takeOne() || await openHour() || await takeOne());
};

/* The members and roles a notify step names, without a task: who holds a live seat and who does not. For the backtest. */
const describeRecipients = async (companyId, config = {}) => {
    const entries = listed(config);
    const ids = entries.filter((e) => OBJECT_ID.test(e));
    const outsiders = new Set(await nonMembersOf(companyId, ids));
    const names = await namesOf(ids);
    const named = (userId) => ({ userId, name: names[userId] || null });
    return {
        people: [
            ...ids.filter((id) => !outsiders.has(id)).map(named),
            ...entries.filter((e) => ROLES.includes(e)).map((role) => ({ userId: role, name: null })),
        ],
        skipped: ids.filter((id) => outsiders.has(id)).map((id) => ({ ...named(id), reason: 'not_a_member' })),
    };
};

const notifyStepsOf = (rule = {}) => (Array.isArray(rule.steps) ? rule.steps : []).filter((step) => step && step.action === 'notify');

module.exports = {
    ROLES, TASK_ASSIGNEES, TASK_CREATOR, TASK_WATCHERS, MAX_MESSAGE, MAX_RECIPIENTS, MAX_PER_HOUR,
    listed, configErrors, planNotice, claimSlot, describeRecipients, notifyStepsOf,
};
