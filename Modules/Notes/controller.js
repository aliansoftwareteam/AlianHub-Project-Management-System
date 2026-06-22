// Personal notepad (COLLAB-06) — HTTP handlers. CRUD on a user's notes plus a
// convert-marker stamp (convertedTaskId), set by the client after it has created
// a task from a note through the EXISTING task-create flow (taskClass.create →
// POST /api/v2/tasks). This module never creates tasks itself. All notes are
// company-scoped (companyId from the request header), matching
// Modules/Reminders/controller.js.
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { sanitizeNotePayload } = require('./notesRules');
const logger = require('../../Config/loggerConfig');

// Resolve the acting user id from the request (auth context first, then header,
// then body) — identical resolution order to Modules/Reminders/controller.js.
function resolveUserId(req) {
    const b = req.body || {};
    return (req.user && (req.user.id || req.user._id))
        || req.headers['userid']
        || b.userId
        || (b.userData && b.userData.id)
        || '';
}

exports.createNote = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const userId = resolveUserId(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required' });
        }
        const fields = sanitizeNotePayload(req.body);
        const doc = {
            _id: new mongoose.Types.ObjectId(),
            userId: String(userId),
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

// List the caller's own notes for the current company (newest updated first).
exports.listMine = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const userId = resolveUserId(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required' });
        }
        const notes = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.NOTES,
            data: [{ userId: String(userId), deletedStatusKey: 0 }, null, { sort: { updatedAt: -1 } }],
        }, 'find');
        res.send({ status: true, data: notes || [] });
    } catch (error) {
        logger.error(`[notes] list failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

// Update title / content (autosave) or stamp convertedTaskId after a convert.
exports.updateNote = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const id = req.params.id;
        if (!companyId || !id) {
            return res.send({ status: false, statusText: 'companyId and note id are required' });
        }
        const patch = sanitizeNotePayload(req.body);
        if (!Object.keys(patch).length) {
            return res.send({ status: false, statusText: 'Nothing to update' });
        }
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.NOTES,
            data: [{ _id: new mongoose.Types.ObjectId(id) }, { $set: patch }],
        }, 'updateOne');
        res.send({ status: true, statusText: 'Updated' });
    } catch (error) {
        logger.error(`[notes] update failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};

// Soft-delete a note.
exports.deleteNote = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const id = req.params.id;
        if (!companyId || !id) {
            return res.send({ status: false, statusText: 'companyId and note id are required' });
        }
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.NOTES,
            data: [{ _id: new mongoose.Types.ObjectId(id) }, { $set: { deletedStatusKey: 1 } }],
        }, 'updateOne');
        res.send({ status: true, statusText: 'Deleted' });
    } catch (error) {
        logger.error(`[notes] delete failed: ${error.message}`);
        res.send({ status: false, statusText: error.message });
    }
};
