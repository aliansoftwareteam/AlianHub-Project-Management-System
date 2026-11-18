const crypto = require('crypto');
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
// conversation it was asked in. The text given is the asking message's own and no other message's, and only as its
// author last wrote it: the row keeps a digest of those words, and words changed by anyone else are never handed.
// In a project's channel the project's manager has to be on, as for a handed task; outside a project there is none.
// Nothing is answered here and no model is called: the AI gets the question when it next asks for work.

const { STATUS, ASKED_IN_CHAT, LEFT } = findings;
const WHERE = Object.freeze({ CHANNEL: 'channel', CONVERSATION: 'conversation' });
const WHY_NOT = Object.freeze({ MANAGER_OFF: 'project_manager_off' });
const ASKED_TYPES = Object.freeze(['text', 'link']);
const TEXT_MAX = 2000;
const ROWS_READ = 50;
const PEOPLE_SWEPT = 500;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const isId = (value) => OBJECT_ID.test(String(value || ''));
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);
const findOne = async (companyId, type, id, fields) => plain(await MongoDbCrudOpration(companyId, { type, data: [{ _id: oid(id) }, fields] }, 'findOne'));
const findRows = async (companyId, data) => ((await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECT_FINDINGS, data }, 'find')) || []).map(plain);

const namesTheirOwnAi = (message, uid) => parseOwnAiMentionIds(message).some((id) => id.toLowerCase() === String(uid).toLowerCase());
const digestOf = (message) => crypto.createHash('sha256').update(String(message || '')).digest('hex');
const keyOf = (messageId) => `${ASKED_IN_CHAT}:${messageId}`;
const waitingOf = (uid, more = {}) => ({ status: STATUS.OPEN, rule: ASKED_IN_CHAT, userId: String(uid), ...more });

/* Where a chat thread sits: a channel, in a project or in a chat space, or a conversation between people. null for a
 * task's own thread, for a project's comments, and for a conversation with an in-product agent, which answers there itself. */
const placeOf = async (companyId, thread) => {
    if (!isId(thread.projectId) || !isId(thread.sprintId)) return null;
    if (thread.taskId === CHANNEL_THREAD) {
        const [project, space, channel] = await Promise.all([
            findOne(companyId, SCHEMA_TYPE.PROJECTS, thread.projectId, { ProjectName: 1, agentManager: 1, deletedStatusKey: 1 }),
            findOne(companyId, SCHEMA_TYPE.MAIN_CHATS, thread.projectId, { ProjectName: 1 }),
            findOne(companyId, SCHEMA_TYPE.SPRINTS, thread.sprintId, { name: 1 }),
        ]);
        if (!project && !space) return null;
        return {
            where: WHERE.CHANNEL, inProject: Boolean(project), projectName: (project || space).ProjectName || '', channelName: (channel && channel.name) || '',
            managerOn: !project || (project.deletedStatusKey !== 1 && Boolean(project.agentManager) && project.agentManager.on === true),
        };
    }
    if (!isId(thread.taskId)) return null;
    const task = await findOne(companyId, SCHEMA_TYPE.TASKS, thread.taskId, { ProjectID: 1, mainChat: 1, agentId: 1, deletedStatusKey: 1 });
    const betweenPeople = task && task.mainChat === true && !task.agentId && task.deletedStatusKey !== 1 && String(task.ProjectID) === thread.projectId;
    return betweenPeople ? { where: WHERE.CONVERSATION, inProject: false, projectName: '', channelName: '', managerOn: true } : null;
};

/* The person's own AI in a chat conversation they may write in, when one of their connections reaches it; or why it
 * is not theirs to ask there, said only to a person who has one that could be. */
const askableIn = async (companyId, uid, thread, now = new Date()) => {
    const at = threadOf(thread);
    if (!isId(uid) || !(await canPostToThread(companyId, uid, at)).allowed) return {};
    const place = await placeOf(companyId, at);
    const own = place ? await connectedAgents.ownFor(companyId, uid, at.projectId, now) : null;
    if (!own) return {};
    return place.managerOn ? { own } : { why: WHY_NOT.MANAGER_OFF };
};

/* What the "@" menu of a chat conversation offers its person: their own AI, or nothing and why. It writes nothing. */
const offeredIn = async (companyId, uid, thread, now = new Date()) => {
    const { own, why } = await askableIn(companyId, uid, thread, now);
    return { offered: own ? [own] : [], why: why || '' };
};

const leaving = (why, uid, now) => ({ $unset: { claim: '' }, $set: { status: STATUS.CLOSED, closedAt: now, leftQueue: { why, userId: String(uid), at: now } } });

const leave = (companyId, row, why, now) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECT_FINDINGS, data: [{ _id: row._id, status: STATUS.OPEN }, leaving(why, row.userId, now)],
}, 'updateOne');

/* No rule treats the mark as a person's edit of the message: it goes out as the answering state of an in-product
 * agent does. A mark taken off goes out as null, so a page that merges the update over its row drops it too. */
const announceMark = (companyId, comment) => socketEmitter.emit('update', {
    type: 'update', data: comment, updatedFields: {}, module: 'comments', companyId, actor: { kind: 'agent', userId: null }, depth: 1,
});

/* The mark names nobody: a member reads the AI's name from the member list, and a guest, who is shown no colleague's AI, reads none. */
const setMark = async (companyId, commentId, mark) => {
    const marked = plain(await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: [{ _id: oid(commentId) }, mark ? { $set: { ownAiAsk: mark } } : { $unset: { ownAiAsk: '' } }, { returnDocument: 'after', timestamps: false }],
    }, 'findOneAndUpdate'));
    if (marked) announceMark(companyId, mark ? marked : { ...marked, ownAiAsk: null });
};

const rowOf = async (companyId, comment) => (await findRows(companyId, [{ projectId: { $in: idForms([String(comment.projectId)]) }, key: keyOf(comment._id) }]))[0] || null;

const unask = async (companyId, comment, now) => {
    const row = await rowOf(companyId, comment);
    if (row && row.status === STATUS.OPEN) await leave(companyId, row, LEFT.TAKEN_BACK, now);
    if (comment.ownAiAsk) await setMark(companyId, comment._id, null);
};

/* The author reworded a question that still waits: it waits on, as they wrote it now. */
const keepWords = async (companyId, comment) => {
    const row = await rowOf(companyId, comment);
    if (!row || row.status !== STATUS.OPEN) return;
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECT_FINDINGS, data: [{ _id: row._id, status: STATUS.OPEN }, { $set: { facts: { ...(row.facts || {}), textDigest: digestOf(comment.message) } } }],
    }, 'updateOne');
};

const ask = async (companyId, comment, now) => {
    if (!isId(comment._id) || !ASKED_TYPES.includes(comment.type) || comment.isDeleted === true) return null;
    const askerId = String(comment.userId || '');
    if (!namesTheirOwnAi(comment.message, askerId)) return null;
    const thread = threadOf(comment);
    const { own } = await askableIn(companyId, askerId, thread, now);
    if (!own) return null;
    const earlier = await rowOf(companyId, comment);
    if (earlier && earlier.status !== STATUS.CLOSED) return null;
    const row = await findings.open(companyId, thread.projectId, {
        key: keyOf(comment._id), rule: ASKED_IN_CHAT, taskId: '', taskIds: [], userId: askerId, facts: { messageId: String(comment._id), textDigest: digestOf(comment.message) },
    }, now, earlier || undefined);
    if (!row) return null;
    await setMark(companyId, comment._id, { at: now });
    return { itemId: String(row._id) };
};

/* Called after a chat message is saved by a signed-in person. A message that names its author's own AI is queued
 * for it once; naming someone else's AI, or naming one where the author has none, does nothing. Never throws: the
 * message is posted. */
const fromChatMessage = async (companyId, saved, now = new Date()) => {
    const comment = plain(saved);
    try {
        return comment ? await ask(companyId, comment, now) : null;
    } catch (error) {
        logger.error(`[own-ai] message ${comment && comment._id} was not queued: ${error.message}`);
        return null;
    }
};

/* Called after a message is changed. `byAuthor` is true only for the author's own edit as a signed-in person: words
 * anyone else wrote into the message, an owner or an admin included, are not the author's question, so the row
 * closes and the mark goes. A deleted message asks nothing. Never throws: the change is saved. */
const afterMessageChange = async (companyId, { before, after, byAuthor, now = new Date() }) => {
    const was = plain(before);
    const is = plain(after);
    try {
        if (!was || !is) return;
        const sameWords = String(is.message || '') === String(was.message || '');
        if (is.isDeleted !== true && sameWords) return;
        if (is.isDeleted === true || !byAuthor || !namesTheirOwnAi(is.message, String(was.userId || ''))) {
            await unask(companyId, is, now);
        } else if (!is.ownAiAsk) {
            await ask(companyId, is, now);
        } else {
            await keepWords(companyId, is);
        }
    } catch (error) {
        logger.error(`[own-ai] the change of message ${was && was._id} was not followed: ${error.message}`);
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

const asAuthorWroteIt = (row, message, uid) => String(message.userId) === String(uid) && namesTheirOwnAi(message.message, uid)
    && digestOf(message.message) === String((row.facts && row.facts.textDigest) || '');

/* The question as its person's AI is given it, or null. Here a row leaves the queue that slipped past the places
 * that close one: none of the person's connections that were there when it was asked is left, or its message is
 * gone or no longer reads as its author wrote it. One the person cannot open just now, or whose project's manager
 * is off, is kept and not given. */
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
    if (!message || !asAuthorWroteIt(row, message, uid)) {
        await leave(companyId, row, LEFT.TAKEN_BACK, now);
        if (message && message.ownAiAsk) await setMark(companyId, message._id, null);
        return null;
    }
    const thread = threadOf(message);
    const [place, access] = await Promise.all([placeOf(companyId, thread), asThePerson(() => commentThreadAccess(companyId, uid, thread))]);
    if (!place || !place.managerOn || !access.allowed || !within(reach, place, thread)) return null;
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
    const rows = await findRows(companyId, [
        waitingOf(uid, { leftQueue: null, ...(projectId ? { projectId: { $in: idForms([String(projectId)]) } } : {}) }), {}, { sort: { openedAt: 1 }, limit: ROWS_READ },
    ]);
    if (!rows.length) return [];
    const read = (await Promise.all(rows.map((row) => readFor(companyId, uid, row, { reach, now })))).filter(Boolean);
    const paused = await projectLimits.pausedAmong(companyId, read.map((item) => item.projectId).filter(Boolean));
    return read.filter((item) => !item.projectId || !paused.includes(item.projectId.toLowerCase()));
};

/* Called where a connection is revoked. A person with no connected AI left has nothing waiting for one. While
 * another of their connections is left the rows stay: which of them is given a row is judged when the queue is read.
 * Never throws: the connection is already revoked. */
const connectionEnded = async (companyId, userId, now = new Date()) => {
    try {
        if (!companyId || !isId(userId) || !(await findRows(companyId, [waitingOf(userId), { _id: 1 }, { limit: 1 }])).length) return 0;
        if (await connectedAgents.ownFor(companyId, userId, null, now)) return 0;
        const closed = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECT_FINDINGS, data: [waitingOf(userId), leaving(LEFT.WITHDRAWN, userId, now)],
        }, 'updateMany');
        return Number((closed && closed.modifiedCount) || 0);
    } catch (error) {
        logger.error(`[own-ai] the questions waiting for ${userId} were not closed: ${error.message}`);
        return 0;
    }
};

/* A connection that runs out is revoked by nobody: the daily check of what is about to end asks for everyone who has a question waiting. */
const closeEnded = async (companyId, now = new Date()) => {
    try {
        const waiting = await findRows(companyId, [{ status: STATUS.OPEN, rule: ASKED_IN_CHAT }, { userId: 1 }, { limit: PEOPLE_SWEPT }]);
        const people = [...new Set(waiting.map((row) => String(row.userId || '')).filter(isId))];
        let closed = 0;
        for (const userId of people) {
            // eslint-disable-next-line no-await-in-loop
            closed += await connectionEnded(companyId, userId, now);
        }
        return closed;
    } catch (error) {
        logger.error(`[own-ai] ${companyId}: the questions of ended connections were not closed: ${error.message}`);
        return 0;
    }
};

module.exports = { WHERE, WHY_NOT, offeredIn, fromChatMessage, afterMessageChange, readFor, waitingFor, connectionEnded, closeEnded };
