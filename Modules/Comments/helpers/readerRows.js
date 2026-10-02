const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged, evaluatePermission } = require('../../../Config/permissionGuard');
const { PRIVATE_PROJECTS, seesEveryPrivateProject } = require('../../../Config/rulePermissions');
const { allowsProject } = require('../../../Config/tokenNarrowing');
const { agentOf } = require('../../../Config/agentRequest');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const { sprintIdentities, hiddenSprintIds } = require('../../Sprints/helpers/sprintVisibility');
const { keepTaskListProjectIds } = require('../../Tasks/helpers/taskListProjects');
const { CHANNEL_THREAD } = require('./conversation');
const { mentionsKeptFromAgent, noticesKeptFromAgent, withoutKept } = require('./agentChatRows');
const { keptFromCaller } = require('./conversationRows');

// A notice or a mention is written for a person who could open its thread that day, and it stays stored when they
// no longer can. What they read of those rows is decided here each time, by the rule the thread itself is read by
// (./threadAccess), said as a clause for the query: a page, a count and a "there is more" never tell of a row that
// is kept.

const PROJECT_FIELDS = { isPrivateSpace: 1, AssigneeUserId: 1, isPersonal: 1, personalOwner: 1 };

const opensProject = (project, uid, { privileged, everyPrivate, identities }) => {
    if (!allowsProject(uid, project._id)) return false;
    if (project.isPersonal === true) return String(project.personalOwner) === String(uid);
    if (privileged || project.isPrivateSpace !== true || everyPrivate) return true;
    return (project.AssigneeUserId || []).map(String).some((id) => identities.has(id));
};

/* Rows name their place by projectId, sprintId and taskId. A list's channel is told of with the list as its taskId,
 * so a row is of a task only when the two differ. */
const placesKeptFrom = async (companyId, uid) => {
    const roleType = await getRoleType(companyId, uid);
    const privileged = isPrivileged(roleType);
    const [projects, identities, everyPrivate] = await Promise.all([
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{}, PROJECT_FIELDS] }, 'find'),
        sprintIdentities(companyId, uid),
        privileged ? true : evaluatePermission(companyId, uid, PRIVATE_PROJECTS).then(seesEveryPrivateProject),
    ]);
    const standing = { privileged, everyPrivate, identities: new Set(identities) };
    const ids = (rows) => rows.map((project) => String(project._id));
    const open = ids((projects || []).filter((project) => roleType !== null && opensProject(project, uid, standing)));
    const closed = ids((projects || []).filter((project) => !open.includes(String(project._id))));
    if (privileged) return closed.length ? [{ projectId: { $in: idForms(closed) } }] : [];

    const [lists, withTasks] = await Promise.all([hiddenSprintIds(companyId, uid, open), keepTaskListProjectIds(companyId, uid, open)]);
    const withoutTasks = open.filter((id) => !withTasks.includes(id));
    return [
        ...(closed.length ? [{ projectId: { $in: idForms(closed) } }] : []),
        ...(lists.length ? [{ sprintId: { $in: idForms(lists) } }] : []),
        ...(withoutTasks.length ? [{ projectId: { $in: idForms(withoutTasks) }, taskId: { $nin: [null, '', CHANNEL_THREAD] }, $expr: { $ne: ['$taskId', '$sprintId'] } }] : []),
    ];
};

const keptFromReader = async (companyId, uid, keptFromAgent) => {
    const [chat, places] = await Promise.all([
        agentOf(uid) ? keptFromAgent(companyId, uid) : keptFromCaller(companyId, uid),
        placesKeptFrom(String(companyId), String(uid)),
    ]);
    const kept = [...(chat.$nor || []), ...places];
    return kept.length ? { $nor: kept } : {};
};

const mentionsKeptFromReader = (companyId, uid) => keptFromReader(companyId, uid, mentionsKeptFromAgent);
const noticesKeptFromReader = (companyId, uid) => keptFromReader(companyId, uid, noticesKeptFromAgent);

/* Both clauses for a request that reads or changes the person's notices and mentions, named as the inbox names its rows. */
const inboxRowsKeptFromReader = async (companyId, uid) => {
    const [notification, mention] = await Promise.all([noticesKeptFromReader(companyId, uid), mentionsKeptFromReader(companyId, uid)]);
    return { notification, mention };
};

module.exports = { mentionsKeptFromReader, noticesKeptFromReader, inboxRowsKeptFromReader, withoutKept };
