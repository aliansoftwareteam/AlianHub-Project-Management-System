// Personal notepad (COLLAB-06). A note belongs to req.uid: user ids in the body,
// query or headers are ignored. The convert-to-task marker is stamped by the client
// after it created the task through the task routes; this module never creates tasks.
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { sanitizeNotePayload } = require('./notesRules');
const logger = require('../../Config/loggerConfig');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const NOTE_DELETED = 1;

const ownerOf = (req) => String(req.uid || '');
const matchedCount = (result) => (result && result.matchedCount !== undefined ? result.matchedCount : (result && result.modifiedCount) || 0);

exports.createNote = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const userId = ownerOf(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required' });
        }
        const fields = sanitizeNotePayload(req.body);
        const doc = {
            _id: new mongoose.Types.ObjectId(),
            userId,
            companyId: String(companyId),
            title: fields.title || '',
            content: fields.content || '',
            convertedTaskId: '',
            deletedStatusKey: 0,
        };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.NOTES, data: doc }, 'save');
        res.send({ status: true, statusText: 'Note created', data: saved });
    } catch (error) {
        logger.error(`[notes] create failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

exports.listMine = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const userId = ownerOf(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required' });
        }
        // deletedStatusKey: 0 active, 1 deleted, 2 archived. Deleted notes are in neither view.
        const wantArchived = req.query && (req.query.archived === '1' || req.query.archived === 'true');
        const notes = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.NOTES,
            data: [
                { userId, deletedStatusKey: wantArchived ? 2 : 0 },
                null,
                { sort: { updatedAt: -1 } },
            ],
        }, 'find');
        res.send({ status: true, data: notes || [] });
    } catch (error) {
        logger.error(`[notes] list failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

const updateOwnNote = async (req, res, patch, statusText) => {
    const companyId = req.headers['companyid'];
    const id = String(req.params.id || '');
    const userId = ownerOf(req);
    if (!companyId || !userId || !OBJECT_ID_PATTERN.test(id)) {
        return res.status(400).send({ status: false, statusText: 'companyId and a valid note id are required' });
    }
    const result = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.NOTES,
        data: [{ _id: new mongoose.Types.ObjectId(id), userId, deletedStatusKey: { $ne: NOTE_DELETED } }, { $set: patch }],
    }, 'updateOne');
    if (!matchedCount(result)) {
        return res.status(404).send({ status: false, statusText: 'Note not found' });
    }
    return res.send({ status: true, statusText });
};

exports.updateNote = async (req, res) => {
    try {
        const patch = sanitizeNotePayload(req.body);
        if (!Object.keys(patch).length) {
            return res.send({ status: false, statusText: 'Nothing to update' });
        }
        if (patch.convertedTaskId && !OBJECT_ID_PATTERN.test(patch.convertedTaskId)) {
            return res.status(400).send({ status: false, statusText: 'convertedTaskId must be a task id' });
        }
        return await updateOwnNote(req, res, patch, 'Updated');
    } catch (error) {
        logger.error(`[notes] update failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

exports.deleteNote = async (req, res) => {
    try {
        return await updateOwnNote(req, res, { deletedStatusKey: NOTE_DELETED }, 'Deleted');
    } catch (error) {
        logger.error(`[notes] delete failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};
