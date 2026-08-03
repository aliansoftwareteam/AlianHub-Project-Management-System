const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const socketEmitter = require('../../event/socketEventEmitter');
const { validateReactionInput } = require('./helpers/reactionRules');

// Emoji reactions on tasks and comments. Reactions live as an embedded
// array on the target document — `reactions: [{ emoji, userId, createdAt }]`,
// one entry per user+emoji — so reads need no extra query and socket
// updates carry them automatically. Toggle semantics: present → pull,
// absent → push.

/**
 * POST /api/v2/reactions
 * body: { targetType: 'task'|'comment', targetId, emoji, userData, isProjectComment? }
 * companyId comes from the verified header (same convention as /api/v2/tasks/bulk).
 */
exports.toggleReaction = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const { targetType, targetId, emoji, userData, isProjectComment = false } = req.body || {};
        const userId = userData && (userData.id || userData._id) ? String(userData.id || userData._id) : '';

        const check = validateReactionInput({ companyId, targetType, targetId, emoji, userId });
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason });
        }

        const schemaType = targetType === 'task' ? SCHEMA_TYPE.TASKS : SCHEMA_TYPE.COMMENTS;
        const targetObjId = new mongoose.Types.ObjectId(targetId);

        const doc = await MongoDbCrudOpration(companyId, { type: schemaType, data: [{ _id: targetObjId }] }, 'findOne');
        if (!doc) {
            return res.send({ status: false, statusText: 'Target not found.' });
        }

        const alreadyReacted = (doc.reactions || []).some((reaction) => reaction.emoji === emoji && String(reaction.userId) === userId);
        const updateObj = alreadyReacted
            ? { $pull: { reactions: { emoji, userId } } }
            : { $push: { reactions: { emoji, userId, createdAt: new Date() } } };

        // `timestamps: false`: a reaction is metadata about a message, not an edit
        // of it. Without this Mongoose bumps `updatedAt`, and every UI that infers
        // "edited" from `createdAt !== updatedAt` (the chat bubble and the comment
        // renderer both do) labelled a message as edited the moment anyone reacted
        // to it. The pin update already suppresses timestamps for the same reason.
        const updated = await MongoDbCrudOpration(companyId, {
            type: schemaType,
            data: [{ _id: targetObjId }, updateObj, { returnDocument: 'after', timestamps: false }],
        }, 'findOneAndUpdate');

        const updatedFields = { reactions: updated?.reactions || [] };
        if (targetType === 'task') {
            socketEmitter.emit('update', { type: "update", data: updated, updatedFields, module: 'task' });
        } else {
            socketEmitter.emit('update', { type: "update", data: updated, updatedFields, module: isProjectComment ? 'comments_project' : 'comments' });
        }

        return res.send({
            status: true,
            statusText: alreadyReacted ? 'Reaction removed.' : 'Reaction added.',
            data: { reactions: updated?.reactions || [] },
        });
    } catch (error) {
        logger.error(`ERROR in toggle reaction: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
