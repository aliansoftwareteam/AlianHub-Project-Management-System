'use strict';

const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { memberProfiles } = require('../../utils/companyMembers');
const aiSwitch = require('../AICore/aiSwitch');
const { commentThreadAccess, refuseThread } = require('../Comments/helpers/threadAccess');
const { taskIdMatch } = require('../Comments/helpers/taskIdMatch');
const { generateMeetingNotes } = require('./meetingNotes');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const CHANNEL_THREAD = 'default';
const MAX_MESSAGES = 80;
const MESSAGE_CHAR_CAP = 800;

const isId = (value) => typeof value === 'string' && OBJECT_ID.test(value);

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&#39;': "'", '&nbsp;': ' ', '&amp;': '&' };

function plainMessage(raw) {
    const text = String(raw || '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&(lt|gt|quot|#0?39|nbsp|amp);/g, (entity) => ENTITIES[entity] || entity)
        .replace(/\[([^\]]+)\]\([0-9a-f]{24}\)/gi, '@$1')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > MESSAGE_CHAR_CAP ? `${text.slice(0, MESSAGE_CHAR_CAP)}…` : text;
}

/* The same filter GET /api/v1/comments/get-paginated-messages reads a main-chat conversation with,
 * narrowed to what a model can read. */
async function loadMessages(companyId, { projectId, sprintId, taskId }, accessMatch) {
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: [[
            {
                $match: {
                    $and: [
                        { projectId: new mongoose.Types.ObjectId(projectId) },
                        accessMatch,
                        { isDeleted: { $ne: true } },
                        { sprintId: new mongoose.Types.ObjectId(sprintId) },
                        { taskId: taskIdMatch(taskId) },
                        { $or: [{ type: 'text' }, { type: 'link' }, { type: { $exists: false } }] },
                    ],
                },
            },
            { $sort: { createdAt: -1 } },
            { $limit: MAX_MESSAGES },
            { $sort: { createdAt: 1 } },
            { $project: { message: 1, userId: 1, agentName: 1, createdAt: 1 } },
        ]],
    }, 'aggregate');
}

async function namesOf(companyId, rows) {
    const ids = [...new Set(rows.map((row) => String(row.userId || '')).filter(isId))];
    if (!ids.length) return {};
    try {
        const users = await memberProfiles(companyId, ids, { Employee_Name: 1 });
        return Object.fromEntries(users.map((user) => [String(user._id), user.Employee_Name]));
    } catch (error) {
        logger.error(`chatSummary: could not resolve names: ${error.message}`);
        return {};
    }
}

async function summarizeChat({ companyId, uid, projectId, sprintId, taskId }) {
    const access = await commentThreadAccess(companyId, uid, { projectId, sprintId, taskId });
    if (!access.allowed) return { refused: access };

    await aiSwitch.assertAllowed(companyId);

    const rows = (await loadMessages(companyId, { projectId, sprintId, taskId }, access.match)) || [];
    const names = await namesOf(companyId, rows);
    const lines = rows
        .map((row) => ({ who: row.agentName || names[String(row.userId)] || 'Someone', text: plainMessage(row.message) }))
        .filter((line) => line.text);

    if (!lines.length) return { status: true, data: { summary: '', actionItems: [], messageCount: 0 } };

    const result = await generateMeetingNotes({
        transcript: lines.map((line) => `${line.who}: ${line.text}`).join('\n'),
        participants: [...new Set(lines.map((line) => line.who))],
        kind: 'chat',
        companyId,
        userId: uid,
    });
    if (!result.status) return result;
    return { status: true, data: { ...result.data, messageCount: lines.length } };
}

/** POST /api/v1/ai/chat-summary  { projectId, sprintId, taskId }: taskId is 'default' for a channel. */
async function chatSummaryHandler(req, res) {
    const companyId = String(req.headers['companyid'] || '');
    if (!isId(companyId)) return res.status(400).json({ status: false, statusText: 'companyId header required' });

    const { projectId, sprintId, taskId } = req.body || {};
    if (!isId(projectId) || !isId(sprintId) || !(taskId === CHANNEL_THREAD || isId(taskId))) {
        return res.status(400).json({ status: false, statusText: 'projectId, sprintId and taskId are required.' });
    }

    try {
        const result = await summarizeChat({ companyId, uid: req.uid, projectId, sprintId, taskId });
        if (result.refused) return refuseThread(res, result.refused);
        if (!result.status) return res.status(200).json({ status: false, statusText: result.reason });
        return res.status(200).json({ status: true, data: result.data });
    } catch (error) {
        if (aiSwitch.isAiOff(error)) return res.status(403).json({ status: false, code: aiSwitch.AI_OFF, statusText: error.message });
        logger.error(`chatSummary: ${error && error.message ? error.message : error}`);
        return res.status(500).json({ status: false, statusText: 'Could not summarise this conversation.' });
    }
}

module.exports = { summarizeChat, chatSummaryHandler, _internal: { plainMessage } };
