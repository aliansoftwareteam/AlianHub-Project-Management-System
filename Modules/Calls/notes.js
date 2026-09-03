const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { generateMeetingNotes } = require('../AI/meetingNotes');
const socketEmitter = require('../../event/socketEventEmitter');
const logger = require('../../Config/loggerConfig');

const companyOf = (req) => req.headers['companyid'];
const isObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(String(id || ''));

const emitNotes = (type, data) => {
    try {
        socketEmitter.emit(type, { type, data, module: 'calls' });
    } catch (error) {
        logger.error(`calls notes emit: ${error.message}`);
    }
};

const ownNotesFilter = (req, id) => ({
    _id: id,
    participants: String(req.uid),
    deletedStatusKey: { $ne: 1 },
});

/**
 * POST /api/v2/calls/notes
 * Called once by the client that ran the notetaker when the call ends. The transcript
 * is already text (the client transcribes the recording through /api/v1/ai/transcribe),
 * so the only AI work here is the summary + action items.
 */
exports.createNotes = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });

        const body = req.body || {};
        const callId = String(body.callId || '').trim();
        if (!callId) return res.send({ status: false, statusText: 'callId is required.' });

        const participants = [...new Set([String(req.uid), ...(Array.isArray(body.participants) ? body.participants.map(String) : [])])].filter(Boolean);
        const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
        const durationSec = Math.max(0, Number(body.durationSec) || 0);

        let summary = '';
        let actionItems = [];
        let aiError = '';
        if (transcript) {
            const generated = await generateMeetingNotes({
                transcript,
                title: body.title,
                participants: Array.isArray(body.participantNames) ? body.participantNames : [],
                kind: 'call',
            });
            if (generated.status) {
                summary = generated.data.summary;
                actionItems = generated.data.actionItems;
            } else {
                aiError = generated.reason || '';
            }
        }

        const data = {
            _id: new mongoose.Types.ObjectId(),
            callId,
            chatId: String(body.chatId || ''),
            projectId: String(body.projectId || ''),
            sprintId: String(body.sprintId || ''),
            media: body.media === 'video' ? 'video' : 'audio',
            title: String(body.title || '').slice(0, 200),
            participants,
            startedAt: body.startedAt ? new Date(body.startedAt) : new Date(Date.now() - durationSec * 1000),
            endedAt: new Date(),
            durationSec,
            notetaker: true,
            transcript,
            summary,
            actionItems,
            status: 'ready',
            createdBy: String(req.uid),
            deletedStatusKey: 0,
        };

        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.CALLS, data }, 'save');
        emitNotes('insert', saved);
        return res.send({ status: true, statusText: aiError, data: saved });
    } catch (error) {
        logger.error(`createNotes: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/** GET /api/v2/calls/notes/:id */
exports.getNotes = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        if (!isObjectId(req.params.id)) return res.send({ status: false, statusText: 'Invalid id.' });

        const doc = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.CALLS, data: [ownNotesFilter(req, req.params.id)],
        }, 'findOne');
        if (!doc) return res.send({ status: false, statusText: 'Notes not found.' });
        return res.send({ status: true, data: doc });
    } catch (error) {
        logger.error(`getNotes: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/** GET /api/v2/calls/notes?chatId=…  — the caller's own notes, newest first. */
exports.listNotes = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        const filter = { participants: String(req.uid), deletedStatusKey: { $ne: 1 } };
        if (req.query.chatId) filter.chatId = String(req.query.chatId);
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.CALLS,
            data: [filter, { transcript: 0 }, { sort: { createdAt: -1 }, limit: 50 }],
        }, 'find');
        return res.send({ status: true, data: rows || [] });
    } catch (error) {
        logger.error(`listNotes: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

const EDITABLE = ['title', 'summary', 'actionItems', 'status', 'recapPostedAt', 'transcript'];

/** PATCH /api/v2/calls/notes/:id  { summary?, actionItems?, status?, title?, recapPostedAt? } */
exports.updateNotes = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.send({ status: false, statusText: 'companyId is required.' });
        if (!isObjectId(req.params.id)) return res.send({ status: false, statusText: 'Invalid id.' });

        const patch = {};
        EDITABLE.forEach((key) => {
            if (req.body && req.body[key] !== undefined) patch[key] = req.body[key];
        });
        if (patch.status === 'discarded') patch.deletedStatusKey = 1;
        if (!Object.keys(patch).length) return res.send({ status: false, statusText: 'Nothing to update.' });

        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.CALLS,
            data: [ownNotesFilter(req, req.params.id), { $set: patch }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) return res.send({ status: false, statusText: 'Notes not found.' });
        emitNotes('update', updated);
        return res.send({ status: true, data: updated });
    } catch (error) {
        logger.error(`updateNotes: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
