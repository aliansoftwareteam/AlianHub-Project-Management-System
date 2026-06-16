const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const mongoose = require("mongoose");
const logger = require("../../Config/loggerConfig");
const {
    MAX_NOTES_PER_USER,
    isObjectId,
    validateStickyPayload,
    validateReorder,
} = require("./helpers/stickyRules");

// Personal sticky notes — one document per note, scoped to the company
// database AND the owning userId. Every query filters on userId, so a user
// can only ever read or mutate their own notes. Content is stored as plain
// text and rendered as text on the client (no HTML).

// Resolve the acting user from the various shapes the clients send.
const getUserId = (req) => {
    const fromBody = req.body && (req.body.userId || (req.body.userData && (req.body.userData.id || req.body.userData._id)));
    const fromQuery = req.query && req.query.uid;
    return String(fromBody || fromQuery || '');
};

/* GET /api/v2/stickies?uid=<userId> — the user's notes, pinned first. */
exports.listStickies = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = getUserId(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and uid are required.' });
        }

        const stickies = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.STICKIES,
            data: [{ userId }, null, { sort: { isPinned: -1, sortIndex: 1, updatedAt: -1 } }],
        }, 'find');

        return res.send({ status: true, statusText: 'Stickies fetched.', data: stickies || [] });
    } catch (error) {
        logger.error(`ERROR in list stickies: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/stickies  body: { content?, color?, userData } */
exports.createSticky = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = getUserId(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required.' });
        }

        const check = validateStickyPayload(req.body || {}, { partial: false });
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason });
        }

        // Per-user count cap (abuse guard).
        const count = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.STICKIES,
            data: [{ userId }],
        }, 'countDocuments');
        if (count >= MAX_NOTES_PER_USER) {
            return res.send({ status: false, statusText: `You can keep at most ${MAX_NOTES_PER_USER} sticky notes.` });
        }

        const created = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.STICKIES,
            data: {
                userId,
                title: check.data.title,
                content: check.data.content,
                color: check.data.color,
                sortIndex: 0,
                isPinned: false,
            },
        }, 'save');

        return res.send({ status: true, statusText: 'Sticky created.', data: created });
    } catch (error) {
        logger.error(`ERROR in create sticky: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* PUT /api/v2/stickies/:id  body: { content?, color?, isPinned?, userData } */
exports.updateSticky = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = getUserId(req);
        const { id } = req.params;
        if (!companyId || !userId || !isObjectId(id)) {
            return res.send({ status: false, statusText: 'companyId, userId and a valid id are required.' });
        }

        const check = validateStickyPayload(req.body || {}, { partial: true });
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason });
        }

        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.STICKIES,
            data: [
                { _id: new mongoose.Types.ObjectId(id), userId },
                { $set: check.data },
                { returnDocument: 'after' },
            ],
        }, 'findOneAndUpdate');

        if (!updated) {
            return res.send({ status: false, statusText: 'Sticky not found.' });
        }
        return res.send({ status: true, statusText: 'Sticky updated.', data: updated });
    } catch (error) {
        logger.error(`ERROR in update sticky: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* DELETE /api/v2/stickies/:id?uid=<userId> */
exports.deleteSticky = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = getUserId(req);
        const { id } = req.params;
        if (!companyId || !userId || !isObjectId(id)) {
            return res.send({ status: false, statusText: 'companyId, userId and a valid id are required.' });
        }

        const deleted = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.STICKIES,
            data: [{ _id: new mongoose.Types.ObjectId(id), userId }],
        }, 'findOneAndDelete');

        if (!deleted) {
            return res.send({ status: false, statusText: 'Sticky not found.' });
        }
        return res.send({ status: true, statusText: 'Sticky deleted.', data: { _id: id } });
    } catch (error) {
        logger.error(`ERROR in delete sticky: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* PUT /api/v2/stickies/reorder  body: { ids: [..], userData } */
exports.reorderStickies = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const userId = getUserId(req);
        if (!companyId || !userId) {
            return res.send({ status: false, statusText: 'companyId and userId are required.' });
        }

        const check = validateReorder(req.body && req.body.ids);
        if (!check.valid) {
            return res.send({ status: false, statusText: check.reason });
        }

        // Each note is updated only when it belongs to the user (userId in
        // the filter), so a forged id for someone else's note is a no-op.
        for (let index = 0; index < check.ids.length; index += 1) {
            await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.STICKIES,
                data: [
                    { _id: new mongoose.Types.ObjectId(check.ids[index]), userId },
                    { $set: { sortIndex: index } },
                ],
            }, 'updateOne');
        }

        return res.send({ status: true, statusText: 'Stickies reordered.' });
    } catch (error) {
        logger.error(`ERROR in reorder stickies: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
