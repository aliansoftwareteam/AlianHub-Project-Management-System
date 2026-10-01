'use strict';

const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { memberProfiles } = require('../../utils/companyMembers');
const { canPostToThread } = require('../Comments/helpers/threadWriteAccess');
const { refuseThread } = require('../Comments/helpers/threadAccess');
const { callerOf } = require('./askThreads');
const aiMention = require('./aiMention');
const { sharedAmong } = require('./publicSources');
const { ASK_ANSWER, citedKey, sharedSourcesOf } = require('./shareToken');

/* An Ask answer is built from what its asker can open. Posting it into a conversation puts it in front of everyone
 * who reads that conversation, so only what every one of them can open is posted: an answer built with anything else
 * is held back until the asker chooses to post the rest, and a line stays only when everything it cites is shared. */

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const CHANNEL_THREAD = 'default';
const QUESTION_MAX = 1000;
const ANSWER_MAX = 20000;
const MAX_CHANNELS = 100;
const MAX_DIRECTS = 200;
const CITE = /\[([^\]\n]{1,80})\]/g;

const isId = (value) => typeof value === 'string' && OBJECT_ID.test(value);
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const bothForms = (ids) => ids.flatMap((id) => [String(id), oid(id)]);
const find = (companyId, type, data) => MongoDbCrudOpration(companyId, { type, data }, 'find');
const findOne = (companyId, type, data) => MongoDbCrudOpration(companyId, { type, data }, 'findOne');

const threadFrom = (body) => {
    const { projectId, sprintId, taskId } = body || {};
    if (!isId(projectId) || !isId(sprintId) || !(taskId === CHANNEL_THREAD || isId(taskId))) return null;
    return { projectId, sprintId, taskId };
};

/* A line stays when it cites something and everything it cites is shared: a line that cites nothing cannot be shown
 * to rest on shared sources once the answer was built with others. */
const onlyShared = (answer, cites, shared) => {
    const isShared = new Map(cites.map((c) => [c.ref, shared.has(`${c.kind}:${c.id}`)]));
    const kept = String(answer).split('\n').filter((line) => {
        if (!line.trim()) return true;
        const refs = [...line.matchAll(CITE)].map((match) => match[1]).filter((ref) => isShared.has(ref));
        return refs.length > 0 && refs.every((ref) => isShared.get(ref));
    });
    const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { text, cited: cites.filter((c) => isShared.get(c.ref) && text.includes(`[${c.ref}]`)) };
};

const refuse = (res, statusCode, code, statusText) => res.status(statusCode).json({ status: false, code, statusText });

/** POST /api/v1/ai/ask/post  body: { projectId, sprintId, taskId, question, answer, cited, shareToken, onlyShared? } */
const post = async (req, res) => {
    try {
        const caller = callerOf(req, res);
        if (!caller) return undefined;
        const { companyId, uid } = caller;
        const body = req.body || {};
        const thread = threadFrom(body);
        const question = String(body.question || '').trim().slice(0, QUESTION_MAX);
        const answer = String(body.answer || '');
        const cited = Array.isArray(body.cited) ? body.cited : [];
        if (!thread || !question || !answer || answer.length > ANSWER_MAX) {
            return refuse(res, 400, 'invalid', 'The conversation, question and answer are required.');
        }

        const used = sharedSourcesOf(body.shareToken, { companyId, uid, thread: ASK_ANSWER, question, answer, cited });
        if (!used) return refuse(res, 403, 'share_refused', 'Ask again to post this answer.');

        const space = await findOne(companyId, SCHEMA_TYPE.MAIN_CHATS, [{ _id: oid(thread.projectId) }, { default: 1 }]);
        if (!space) return refuse(res, 404, 'not_a_conversation', 'That conversation was not found.');
        const access = await canPostToThread(companyId, uid, thread);
        if (!access.allowed) return refuseThread(res, access);

        const direct = isId(thread.taskId) ? await findOne(companyId, SCHEMA_TYPE.TASKS, [{ _id: oid(thread.taskId) }, { AssigneeUserId: 1, mainChat: 1 }]) : null;
        const shared = await sharedAmong(companyId, { thread, conversation: direct && direct.mainChat === true ? direct : null, used });
        const cites = citedKey(cited).map(([kind, id, ref, projectId]) => ({ kind, id, ref, projectId }));
        const unshared = used.filter(([kind, id]) => !shared.has(`${kind}:${id}`)).length;
        const trimmed = unshared ? onlyShared(answer, cites, shared) : { text: answer, cited: cites };

        if (unshared && body.onlyShared !== true) {
            return res.status(200).json({
                status: false,
                code: 'not_shared',
                statusText: "This answer uses items some people in that conversation can't open.",
                data: { unshared, unsharedCited: cites.filter((c) => !shared.has(`${c.kind}:${c.id}`)).map((c) => c.ref), postable: Boolean(trimmed.text) },
            });
        }
        if (!trimmed.text) return res.status(200).json({ status: false, code: 'nothing_shared', statusText: 'Nothing in this answer can be opened by everyone in that conversation.' });

        const saved = await aiMention.postAnswer(companyId, {
            chat: true,
            thread,
            askerId: uid,
            answer: trimmed.text,
            cited: trimmed.cited,
            question: { userId: uid, message: aiMention.escapeStored(question) },
        });
        return res.status(200).json({ status: true, statusText: 'Posted.', data: { id: String(saved._id), trimmed: Boolean(unshared) } });
    } catch (error) {
        logger.error(`ask post: ${error && error.message ? error.message : error}`);
        return refuse(res, 500, 'failed', 'Could not post the answer.');
    }
};

const postable = async (companyId, uid, threads) => {
    const decisions = await Promise.all(threads.map((thread) => canPostToThread(companyId, uid, thread).catch(() => ({ allowed: false }))));
    return threads.filter((thread, at) => decisions[at].allowed);
};

/** GET /api/v1/ai/ask/post/targets: the channels and direct messages the caller can post in. */
const targets = async (req, res) => {
    try {
        const caller = callerOf(req, res);
        if (!caller) return undefined;
        const { companyId, uid } = caller;
        const spaces = (await find(companyId, SCHEMA_TYPE.MAIN_CHATS, [{}, { default: 1, ProjectName: 1 }])) || [];
        const spaceName = Object.fromEntries(spaces.map((space) => [String(space._id), space.ProjectName || '']));
        const channelSpaces = spaces.filter((space) => space.default !== true).map((space) => String(space._id));
        const directSpaces = spaces.filter((space) => space.default === true).map((space) => String(space._id));

        const sprints = channelSpaces.length ? (await find(companyId, SCHEMA_TYPE.SPRINTS, [
            { projectId: { $in: bothForms(channelSpaces) }, deletedStatusKey: { $nin: [1, 2] } },
            { name: 1, projectId: 1 },
            { limit: MAX_CHANNELS },
        ])) || [] : [];
        const channels = await postable(companyId, uid, sprints.map((sprint) => ({
            projectId: String(sprint.projectId), sprintId: String(sprint._id), taskId: CHANNEL_THREAD, name: sprint.name || '', space: spaceName[String(sprint.projectId)] || '',
        })));

        const chats = directSpaces.length ? (await find(companyId, SCHEMA_TYPE.TASKS, [
            { mainChat: true, ProjectID: { $in: bothForms(directSpaces) }, AssigneeUserId: uid, deletedStatusKey: { $nin: [1, 2] } },
            { ProjectID: 1, sprintId: 1, AssigneeUserId: 1, agentId: 1 },
            { limit: MAX_DIRECTS },
        ])) || [] : [];
        const withPeople = chats.filter((chat) => !chat.agentId && isId(String(chat.sprintId || '')));
        const peerOf = (chat) => (chat.AssigneeUserId || []).map(String).find((id) => id !== uid) || '';
        const peers = [...new Set(withPeople.map(peerOf).filter(isId))];
        const [profiles, seats] = peers.length ? await Promise.all([
            memberProfiles(companyId, peers, { Employee_Name: 1 }),
            find(companyId, SCHEMA_TYPE.COMPANY_USERS, [{ ...ACTIVE_SEAT, userId: { $in: bothForms(peers) } }, { userId: 1 }]),
        ]) : [[], []];
        const nameOf = Object.fromEntries((profiles || []).map((user) => [String(user._id), user.Employee_Name || '']));
        const active = new Set((seats || []).map((seat) => String(seat.userId)));
        const directs = await postable(companyId, uid, withPeople
            .filter((chat) => active.has(peerOf(chat)) && nameOf[peerOf(chat)])
            .map((chat) => ({ projectId: String(chat.ProjectID), sprintId: String(chat.sprintId), taskId: String(chat._id), name: nameOf[peerOf(chat)] })));

        const byName = (a, b) => a.name.localeCompare(b.name);
        return res.status(200).json({ status: true, statusText: 'OK', data: { channels: channels.sort(byName), directs: directs.sort(byName) } });
    } catch (error) {
        logger.error(`ask post targets: ${error && error.message ? error.message : error}`);
        return refuse(res, 500, 'failed', 'Could not list your conversations.');
    }
};

module.exports = { post, targets, onlyShared };
