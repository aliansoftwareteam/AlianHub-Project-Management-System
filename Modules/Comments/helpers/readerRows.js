const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { myCache } = require('../../../Config/config');
const { readStanding, opensProjectRow, PROJECT_ACCESS_FIELDS } = require('../../../Config/projectAccess');
const { agentOf } = require('../../../Config/agentRequest');
const { narrowingFor } = require('../../../Config/tokenNarrowing');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const { hiddenSprintIds } = require('../../Sprints/helpers/sprintVisibility');
const { readableTasks, TASK_READ_FIELDS } = require('../../Tasks/helpers/taskReadAccess');
const { DOC_NOTICE_SECTION } = require('../../../Config/notificationKey');
const { mentionsKeptFromAgent, noticesKeptFromAgent, withoutKept } = require('./agentChatRows');
const { keptFromCaller } = require('./conversationRows');

// A notice or a mention is written for a person who could open its thread that day, and it stays stored when they
// no longer can. What they read of those rows is decided here each time, by the rule the thread itself is read by
// (./threadAccess), said as a clause for the query: a page, a count and a "there is more" never tell of a row that
// is kept.

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const SCOPE_TTL_SECONDS = 10;

const find = async (companyId, type, filter, fields) => (await MongoDbCrudOpration(companyId, { type, data: [filter, fields] }, 'find')) || [];
const idsOf = (rows) => rows.map((row) => String(row._id));

/* The tasks the person's own rows name. A row is judged by where its task is today, and a row may carry no list at
 * all, so the task itself is asked. A list's channel is told of with the list as its taskId: that names no task. */
const tasksNamedTo = async (companyId, uid) => {
    const [ofNotices, ofMentions] = await Promise.all([
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.NOTIFICATIONS, data: ['taskId', { receiverID: uid }] }, 'distinct'),
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.MENTIONS, data: ['taskId', { mentionIds: uid }] }, 'distinct'),
    ]);
    return [...new Set([...(ofNotices || []), ...(ofMentions || [])].map(String))].filter((id) => OBJECT_ID.test(id));
};

const closedTasksOf = async (companyId, uid) => {
    const named = await tasksNamedTo(companyId, uid);
    if (!named.length) return [];
    const tasks = await find(companyId, SCHEMA_TYPE.TASKS, { _id: { $in: idForms(named).filter((id) => typeof id !== 'string') } }, TASK_READ_FIELDS);
    const open = new Set(idsOf(await readableTasks(companyId, uid, tasks)));
    return idsOf(tasks).filter((id) => !open.has(id));
};

/* What is kept from the person, as plain ids: the projects they cannot open, the private lists they are not on, and
 * the tasks their rows name that they cannot open. Read once for a request and kept a few seconds, since the inbox
 * asks for its counts and its page one after the other; a token narrowed to some projects is kept apart from the
 * person's own asking. */
const scopeOf = async (companyId, uid) => {
    const key = `readerRows:${companyId}:${uid}:${(narrowingFor(uid) || []).join(',')}`;
    const kept = myCache.get(key);
    if (kept) return kept;
    const standing = await readStanding(companyId, uid);
    const projects = await find(companyId, SCHEMA_TYPE.PROJECTS, {}, PROJECT_ACCESS_FIELDS);
    const open = idsOf(projects.filter((project) => opensProjectRow(project, standing)));
    const isOpen = new Set(open);
    const [closedLists, closedTasks] = await Promise.all([
        standing.privileged ? [] : hiddenSprintIds(companyId, uid, open).then((lists) => lists.map(String)),
        closedTasksOf(companyId, uid),
    ]);
    const scope = { closedProjects: idsOf(projects).filter((id) => !isOpen.has(id)), closedLists, closedTasks };
    myCache.set(key, scope, SCOPE_TTL_SECONDS);
    return scope;
};

/* A doc is opened by its own sharing, whatever project it is filed in, so a doc's notice is not judged by the project. */
const placesKept = ({ closedProjects, closedLists, closedTasks }) => [
    ...(closedProjects.length ? [{ projectId: { $in: idForms(closedProjects) }, type: { $ne: DOC_NOTICE_SECTION.key } }] : []),
    ...(closedLists.length ? [{ sprintId: { $in: idForms(closedLists) } }] : []),
    ...(closedTasks.length ? [{ taskId: { $in: idForms(closedTasks) } }] : []),
];

const keptFromReader = async (companyId, uid, keptFromAgent, scope) => {
    const chat = await (agentOf(uid) ? keptFromAgent(companyId, uid) : keptFromCaller(companyId, uid));
    const kept = [...(chat.$nor || []), ...placesKept(scope)];
    return kept.length ? { $nor: kept } : {};
};

const mentionsKeptFromReader = async (companyId, uid) => keptFromReader(companyId, uid, mentionsKeptFromAgent, await scopeOf(String(companyId), String(uid)));
const noticesKeptFromReader = async (companyId, uid) => keptFromReader(companyId, uid, noticesKeptFromAgent, await scopeOf(String(companyId), String(uid)));

/* Both clauses for a request that reads or changes the person's notices and mentions, named as the inbox names its rows. */
const inboxRowsKeptFromReader = async (companyId, uid) => {
    const scope = await scopeOf(String(companyId), String(uid));
    const notification = await keptFromReader(companyId, uid, noticesKeptFromAgent, scope);
    /* A person's two clauses are one and the same; an agent's differ by what marks a chat row in each collection. */
    const mention = agentOf(uid) ? await keptFromReader(companyId, uid, mentionsKeptFromAgent, scope) : notification;
    return { notification, mention };
};

module.exports = { mentionsKeptFromReader, noticesKeptFromReader, inboxRowsKeptFromReader, withoutKept };
