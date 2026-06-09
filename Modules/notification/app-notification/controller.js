const { SCHEMA_TYPE } = require("../../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../../utils/mongo-handler/mongoQueries");
const { Notification_key } = require("../../../Config/notificationKey.js");
const mongoose = require("mongoose")

/**
 * This endpoint is used to send message on mentions
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
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

/**
 * This endpoint is used to get all the mentions messages
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.getMentionsMessages = async (req, res) => {
    try {
        const { userId, mentions, lastMention, firstMention, loadMore } = req.query;

        if (!userId) {
            return res.status(400).json({ status: false, message: "userId is required." });
        }

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

        const projection = {};

        const params = {
            type: SCHEMA_TYPE.MENTIONS,
            data: [
                query,
                projection,
                options
            ]
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'find');

        return res.status(200).json({ status: true, data: response || [] });

    } catch (error) {
        return res.status(500).json({
            status: false,
            message: "An error occurred while fetching mentions",
            error: error.message
        });
    }
}

/**
 * This endpoint is used to get all the notification messages
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.getNotificationMessages = async (req, res) => {
    try {
        const { userId, loadMore, batchSize = 10, notificationSkip = 0, filter = 'unread' } = req.query;

        const limit = parseInt(batchSize);
        const skip = parseInt(notificationSkip);

        if (isNaN(limit) || limit <= 0 || isNaN(skip) || skip < 0) {
            return res.status(400).json({
                status: false,
                message: "Invalid pagination parameters",
            });
        }

        // `notSeen` carries the IDs of recipients who have NOT yet read the
        // notification. So `userId IN notSeen` ⇒ unread for that user, and
        // `userId NOT IN notSeen` ⇒ already read / archived for that user.
        // Default to 'unread' to keep the bell focused on actionable items;
        // the dropdown's "View Archive" toggle passes filter=archived.
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
        return res.status(500).json({
            message: "An error occurred while fetching notification messages",
            error: error.message,
        });
    }
}

/**
 * This endpoint is used to update mark read message
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.updateMarkRead = async (req, res) => {
    try {
        const { key, id, userId, isClickPush=false, commentsId="" } = req.body;

        if (!id || !userId) {
            return res.status(400).json({
                status: false,
                message: `'id' and 'userId' paramters are required`
            })
        }

        let params = {};
        if (key === 'notifications') {
            params = {
                $set: {
                    notificationStatus: 'completed',
                },
                $pull: { notSeen: userId }
            }
        } else {
            params = {
                $pull: { notSeen: userId }
            }
        }

        const query = {
            type: key === 'notifications' ? SCHEMA_TYPE.NOTIFICATIONS : SCHEMA_TYPE.MENTIONS,
            data: [
                {
                    _id: new mongoose.Types.ObjectId(id)
                },
                params
            ],
        };

        if (isClickPush && key === "mentions") {
            query.data = [
                {
                    comment_id: commentsId
                },
                params
            ]
        }
        const response = await MongoDbCrudOpration(req.headers['companyid'], query, 'updateOne');

        return res.status(200).json({ status: true, data: response });

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while mark read message",
            error: error.message,
        });
    }
}

/**
 * This endpoint is used to delete mark read message from global database 
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.deleteMarkReadFromGlobal = async (req, res) => {
    try {
        const { key, id } = req.params;

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

/**
 * This endpoint is used to update mark all read message
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.updateMarkAllRead = async (req, res) => {
    try {
        const { key, userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                status: false,
                message: `'userId' paramter is required`
            })
        }

        let params = [];
        if (key === 'notifications') {
            params = [
                {
                    assigneeUsers: { $in: [userId] },
                    notSeen: { $in: [userId] },
                    notificationType: 'push',
                },
                {
                    $pull: { notSeen: userId }
                }
            ]
        } else {
            params = [
                {
                    mentionIds: { $in: [userId] },
                    notSeen: { $in: [userId] }
                },
                {
                    $pull: { notSeen: userId }
                }
            ]
        }

        const query = {
            type: key === 'notifications' ? SCHEMA_TYPE.NOTIFICATIONS : SCHEMA_TYPE.MENTIONS,
            data: params,
        };

        const response = await MongoDbCrudOpration(req.headers['companyid'], query, 'updateMany');

        return res.status(200).json({ status: true, data: response });

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while mark read message",
            error: error.message,
        });
    }
}