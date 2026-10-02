const mongoose = require('mongoose');
const logger = require('../../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const socketEmitter = require('../../../event/socketEventEmitter');
const { asThePerson } = require('../../../Config/agentRequest');
const { threadOf, canPostToThread } = require('../../Comments/helpers/threadWriteAccess');
const { commentThreadAccess } = require('../../Comments/helpers/threadAccess');
const { CHANNEL_THREAD } = require('../../Comments/helpers/conversation');
const { parseOwnAiMentionIds, mentionsAsNames } = require('../../Comments/helpers/parseMentions');
const { commentPlainText } = require('../../Comments/helpers/plainText');
const connectedAgents = require('../connectedAgents');
const projectLimits = require('../projectLimits');
const findings = require('./findings');

// A question a person put to their own connected AI by naming it in a chat message. It waits in the work queue as a
// row that names no task, and it is given to that person's connections alone, while the person can still open the
// conversation it was asked in. The text given is the asking message's own and no other message's. Nothing is
// answered here and no model is called: the AI gets the question when it next asks for work.

const { STATUS, ASKED_IN_CHAT, LEFT } = findings;
const WHERE = Object.freeze({ CHANNEL: 'channel', CONVERSATION: 'conversation' });
const ASKED_TYPES = Object.freeze(['text', 'link']);
const TEXT_MAX = 2000;
const ROWS_READ = 50;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const isId = (value) => OBJECT_ID.test(String(value || ''));
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);
const findOne = async (companyId, type, id, fields) => plain(await MongoDbCrudOpration(companyId, { type, data: [{ _id: oid(id) }, fields] }, 'findOne'));

const namesTheirOwnAi = (message, uid) => parseOwnAiMentionIds(message).some((id) => id.toLowerCase() === String(uid).toLowerCase());

/* Where a chat thread sits: a channel, in a project or in a chat space, or a conversation between people. null for a
 * task's own thread, for a project's comments, and for a conversation with an in-product agent, which answers there itself. */
const placeOf = async (companyId, thread) => {
    if (!isId(thread.projectId) || !isId(thread.sprintId)) return null;
    if (thread.taskId === CHANNEL_THREAD) {
        const [project, space, channel] = await Promise.all([
            findOne(companyId, SCHEMA_TYPE.PROJECTS, thread.projectId, { ProjectName: 1 }),
            findOne(companyId, SCHEMA_TYPE.MAIN_CHATS, thread.projectId, { ProjectName: 1 }),
            findOne(companyId, SCHEMA_TYPE.SPRINTS, thread.sprintId, { name: 1 }),
        ]);
        if (!project && !space) return null;
        return { where: WHERE.CHANNEL, inProject: Boolean(project), projectName: (project || space).ProjectName || '', channelName: (channel && channel.name) || '' };
    }
    if (!isId(thread.taskId)) return null;
    const task = await findOne(companyId, SCHEMA_TYPE.TASKS, thread.taskId, { ProjectID: 1, mainChat: 1, agentId: 1, deletedStatusKey: 1 });
    const betweenPeople = task && task.mainChat === true && !task.agentId && task.deletedStatusKey !== 1 && String(task.ProjectID) === thread.projectId;
    return betweenPeople ? { where: WHERE.CONVERSATION, inProject: false, projectName: '', channelName: '' } : null;
};

/* The person's own AI in a chat conversation they may write in, when one of their connections reaches it. */
const ownAiIn = async (companyId, uid, thread, now = new Date()) => {
    const at = threadOf(thread);
    if (!(await canPostToThread(companyId, uid, at)).allowed || !(await placeOf(companyId, at))) return null;
    return connectedAgents.ownFor(companyId, uid, at.projectId, now);
};

const leaving = (why, uid, now) => ({ $unset: { claim: '' }, $set: { status: STATUS.CLOSED, closedAt: now, leftQueue: { why, userId: String(uid), at: now } } });

const leave = (companyId, row, why, now) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECT_FINDINGS, data: [{ _id: row._id, status: STATUS.OPEN }, leaving(why, row.userId, now)],
}, 'updateOne');

const withdrawAllOf = (companyId, uid, now = new Date()) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECT_FINDINGS, data: [{ status: STATUS.OPEN, rule: ASKED_IN_CHAT, userId: String(uid) }, leaving(LEFT.WITHDRAWN, uid, now)],
}, 'updateMany');

/* What the "@" menu of a chat conversation offers its person: their own AI, or nothing. A person with no connected
 * AI left has nothing waiting for one, so their questions leave the queue here. */
const offeredIn = async (companyId, uid, thread, now = new Date()) => {
    if (!isId(uid)) return [];
    if (!(await connectedAgents.ownFor(companyId, uid, null, now))) {
        await withdrawAllOf(companyId, uid, now);
        return [];
    }
    const own = await ownAiIn(companyId, uid, thread, now);
    return own ? [own] : [];
};

/* No rule treats the mark as a person's edit of the message: it goes out as the answering state of an in-product agent does. */
const announceMark = (companyId, comment) => socketEmitter.emit('update', {
    type: 'update', data: comment, updatedFields: {}, module: 'comments', companyId, actor: { kind: 'agent', userId: null }, depth: 1,
});

const markAsked = async (companyId, commentId, own, now) => {
    const marked = plain(await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: [{ _id: oid(commentId), isDeleted: { $ne: true } }, { $set: { ownAiAsk: { ownerId: own.ownerId, name: own.shownAs, at: now } } }, { returnDocument: 'after', timestamps: false }],
    }, 'findOneAndUpdate'));
    if (marked) announceMark(companyId, marked);
};

/* Called after a chat message is saved. A message that names its author's own AI is queued for it once; naming
 * someone else's AI, or naming one where the author has none, does nothing. Never throws: the message is posted. */
const fromChatMessage = async (companyId, saved, now = new Date()) => {
    const comment = plain(saved);
    try {
        if (!comment || !isId(comment._id) || !ASKED_TYPES.includes(comment.type)) return null;
        const askerId = String(comment.userId || '');
        if (!namesTheirOwnAi(comment.message, askerId)) return null;
        const thread = threadOf(comment);
        const own = await ownAiIn(companyId, askerId, thread, now);
        if (!own) return null;
        const row = await findings.open(companyId, thread.projectId, {
            key: `${ASKED_IN_CHAT}:${comment._id}`, rule: ASKED_IN_CHAT, taskId: '', taskIds: [], userId: askerId, facts: { messageId: String(comment._id) },
        }, now);
        if (!row) return null;
        await markAsked(companyId, comment._id, own, now);
        return { itemId: String(row._id), shownAs: own.shownAs };
    } catch (error) {
        logger.error(`[own-ai] message ${comment && comment._id} was not queued: ${error.message}`);
        return null;
    }
};

const textOf = (message) => commentPlainText(mentionsAsNames(message)).trim().slice(0, TEXT_MAX);

const whereOf = (place, thread) => {
    if (place.where === WHERE.CONVERSATION) return { kind: WHERE.CONVERSATION };
    const channel = { kind: WHERE.CHANNEL, channelId: thread.sprintId, channel: place.channelName };
    return place.inProject ? { ...channel, projectId: thread.projectId, project: place.projectName } : { ...channel, space: place.projectName };
};

/* `reach` is the connection's own limits: a channel in a project is inside them as the project and the list are, and
 * chat outside every project only for a connection that is not kept to some projects. */
const within = (reach, place, thread) => !reach || (place.inProject
    ? reach.allowsProject(thread.projectId) && reach.allowsSprint(thread.sprintId)
    : !reach.keptToProjects);

/* The question as its person's AI is given it, or null. One whose connection is gone, whose message was deleted or
 * no longer names the AI leaves the queue here; one the person cannot open just now is kept and not given. */
const readFor = async (companyId, uid, row, { reach = null, now = new Date() } = {}) => {
    if (!row || row.rule !== ASKED_IN_CHAT || String(row.userId || '') !== String(uid)) return null;
    const own = await connectedAgents.ownFor(companyId, uid, String(row.projectId), now, { since: row.openedAt });
    if (!own) {
        await leave(companyId, row, LEFT.WITHDRAWN, now);
        return null;
    }
    const messageId = String((row.facts && row.facts.messageId) || '');
    const message = isId(messageId)
        ? plain(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMMENTS, data: [{ _id: oid(messageId), isDeleted: { $ne: true } }] }, 'findOne'))
        : null;
    if (!message || String(message.userId) !== String(uid) || !namesTheirOwnAi(message.message, uid)) {
        await leave(companyId, row, LEFT.TAKEN_BACK, now);
        return null;
    }
    const thread = threadOf(message);
    const [place, access] = await Promise.all([placeOf(companyId, thread), asThePerson(() => commentThreadAccess(companyId, uid, thread))]);
    if (!place || !access.allowed || !within(reach, place, thread)) return null;
    return {
        row,
        task: null,
        project: place.inProject ? place.projectName : '',
        projectId: place.inProject ? thread.projectId : null,
        question: {
            messageId,
            text: textOf(message.message),
            askedBy: { id: String(uid), name: own.ownerName },
            where: whereOf(place, thread),
            ...(message.parentId ? { replyTo: String(message.parentId) } : {}),
        },
    };
};

/* The questions waiting for one person's AI, the oldest first. A project where agents are paused holds its own. */
const waitingFor = async ({ companyId, uid, projectId, reach = null, now = new Date() }) => {
    if (!isId(uid)) return [];
    const rows = ((await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECT_FINDINGS,
        data: [
            { status: STATUS.OPEN, rule: ASKED_IN_CHAT, leftQueue: null, userId: String(uid), ...(projectId ? { projectId: { $in: idForms([String(projectId)]) } } : {}) },
            {}, { sort: { openedAt: 1 }, limit: ROWS_READ },
        ],
    }, 'find')) || []).map(plain);
    if (!rows.length) return [];
    const read = (await Promise.all(rows.map((row) => readFor(companyId, uid, row, { reach, now })))).filter(Boolean);
    const paused = await projectLimits.pausedAmong(companyId, read.map((item) => item.projectId).filter(Boolean));
    return read.filter((item) => !item.projectId || !paused.includes(item.projectId.toLowerCase()));
};

module.exports = { WHERE, offeredIn, fromChatMessage, readFor, waitingFor };
