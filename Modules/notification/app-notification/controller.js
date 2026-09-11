const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { Notification_key } = require("../../../Config/notificationKey.js");
const mongoose = require("mongoose")

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const fail = (res, code, message) => res.status(code).json({ status: false, statusText: message, message });

// The feed always belongs to the session user; a userId naming anyone else is refused, not silently swapped.
const resolveRecipient = (req, res, claimedUserId) => {
    if (claimedUserId && String(claimedUserId) !== String(req.uid)) {
        fail(res, 403, "You can only read or change your own notifications.");
        return null;
    }
    return String(req.uid);
}

exports.sendMessage = async (req, res) => {
    try {
        const { data } = req.body

        const params = {
            type: SCHEMA_TYPE.MENTIONS,
            data: data
        };

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, "save");

        return res.status(200).json({ status: true, data: response || {} });

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while send message on mentions",
            error: error
        });
    }
}

exports.getMentionsMessages = async (req, res) => {
    try {
        const { mentions, lastMention, firstMention, loadMore } = req.query;
        const userId = resolveRecipient(req, res, req.query.userId);
        if (!userId) return;

        let query = {
            mentionIds: {
                $in: [userId]
            }
        };

        if (loadMore === 'true') {
            if (mentions && mentions > 0 && lastMention) {
                query.createdAt = { $lt: new Date(lastMention) };
            }
        } else {
            if (mentions && mentions > 0 && firstMention) {
                query.createdAt = { $gt: new Date(firstMention) };
            }
        }

        const options = {
            limit: 10,
            sort: { createdAt: -1 }
        };

        const params = {
            type: SCHEMA_TYPE.MENTIONS,
            data: [
                query,
                {},
                options
            ]
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'find');

        return res.status(200).json({ status: true, data: response || [] });

    } catch (error) {
        return fail(res, 500, `An error occurred while fetching mentions: ${error.message}`);
    }
}

exports.getNotificationMessages = async (req, res) => {
    try {
        const { loadMore, batchSize = 10, notificationSkip = 0, filter = 'unread' } = req.query;
        const userId = resolveRecipient(req, res, req.query.userId);
        if (!userId) return;

        const limit = parseInt(batchSize);
        const skip = parseInt(notificationSkip);

        if (isNaN(limit) || limit <= 0 || isNaN(skip) || skip < 0) {
            return fail(res, 400, "Invalid pagination parameters");
        }

        // `notSeen` holds the recipients who have NOT read the notification yet.
        const normalizedFilter = (filter === 'archived' || filter === 'archive') ? 'archived' : 'unread';

        const baseMatch = [
            { assigneeUsers: { $in: [userId] } },
            { key: { $ne: Notification_key.COMMENTS_IM_MENTIONS_IN }},
            {
                $or: [
                    { notificationType: 'push' },
                    { notificationType: null }
                ]
            },
            { receiverID: userId }
        ];

        if (normalizedFilter === 'archived') {
            baseMatch.push({ notSeen: { $nin: [userId] } });
        } else {
            baseMatch.push({ notSeen: { $in: [userId] } });
        }

        const query = [
            { $match: { $and: baseMatch } },
            { $sort: { createdAt: -1, _id: 1 } },
            { $skip: loadMore ? skip : 0 },
            { $limit: limit },
        ];

        const params = {
            type: SCHEMA_TYPE.NOTIFICATIONS,
            data: [query],
        };

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'aggregate');

        return res.status(200).json({ status: true, data: response || [] });

    } catch (error) {
        return fail(res, 500, `An error occurred while fetching notification messages: ${error.message}`);
    }
}

exports.updateMarkRead = async (req, res) => {
    try {
        const { key, id, isClickPush = false, commentsId = "" } = req.body;
        const userId = resolveRecipient(req, res, req.body.userId);
        if (!userId) return;

        const isNotification = key === 'notifications';
        const byComment = isClickPush && key === "mentions";

        if (byComment ? !commentsId : !OBJECT_ID_PATTERN.test(String(id || ''))) {
            return fail(res, 400, byComment ? "'commentsId' is required" : "'id' must be a valid id");
        }

        const update = isNotification
            ? { $set: { notificationStatus: 'completed' }, $pull: { notSeen: userId } }
            : { $pull: { notSeen: userId } };

        const recipientFilter = isNotification
            ? { assigneeUsers: { $in: [userId] } }
            : { mentionIds: { $in: [userId] } };

        const filter = byComment
            ? { comment_id: commentsId, ...recipientFilter }
            : { _id: new mongoose.Types.ObjectId(id), ...recipientFilter };

        const query = {
            type: isNotification ? SCHEMA_TYPE.NOTIFICATIONS : SCHEMA_TYPE.MENTIONS,
            data: [filter, update],
        };

        const response = await MongoDbCrudOpration(req.headers['companyid'], query, 'updateOne');

        return res.status(200).json({ status: true, data: response });

    } catch (error) {
        return fail(res, 500, `An error occurred while mark read message: ${error.message}`);
    }
}

exports.deleteMarkReadFromGlobal = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                status: false,
                message: `'id' paramter id required`
            })
        }

        const query = {
            type: SCHEMA_TYPE.NOTIFICATIONS,
            data: [
                {
                    notificationId: id
                }
            ],
        };

        const response = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, query, 'deleteOne');

        return res.status(200).json({ status: true, data: response });

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while delete mark read message from global",
            error: error.message,
        });
    }
}

exports.updateMarkAllRead = async (req, res) => {
    try {
        const { key } = req.body;
        const userId = resolveRecipient(req, res, req.body.userId);
        if (!userId) return;

        const params = key === 'notifications'
            ? [
                { assigneeUsers: { $in: [userId] }, notSeen: { $in: [userId] }, notificationType: 'push' },
                { $pull: { notSeen: userId } }
            ]
            : [
                { mentionIds: { $in: [userId] }, notSeen: { $in: [userId] } },
                { $pull: { notSeen: userId } }
            ];

        const query = {
            type: key === 'notifications' ? SCHEMA_TYPE.NOTIFICATIONS : SCHEMA_TYPE.MENTIONS,
            data: params,
        };

        const response = await MongoDbCrudOpration(req.headers['companyid'], query, 'updateMany');

        return res.status(200).json({ status: true, data: response });

    } catch (error) {
        return fail(res, 500, `An error occurred while mark read message: ${error.message}`);
    }
}
