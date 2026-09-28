const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const socketEmitter = require('../../event/socketEventEmitter');

/**
 * This endpoint is used to get user id document for manage counts
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.getCounts = async (req, res) => {
    try {
        const { id } = req.params;

        if(!id) {
            return res.status(400).json({
                status: false,
                message: `'id' parameters is required.`
            });
        }
        if (String(id) !== String(req.uid)) {
            return res.status(403).json({ status: false, message: 'You can only read your own counts.' });
        }

        let params = {
            type: SCHEMA_TYPE.USERID,
            data: [
                {
                    "userId": id
                }
            ]
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], params, 'findOne');

        return res.status(200).json({ status: true, data: response || {} });

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while get the user id",
            error: error 
        });
    }
}

/**
 * This endpoint is used to update user counts
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
exports.updateCounts = async (req, res) => {
    try {
        const { key } = req.body;
        const userId = String(req.uid || '');

        if (req.body.userId !== undefined && req.body.userId !== userId) {
            return res.status(403).json({ status: false, message: 'You can only clear your own counts.' });
        }
        if(!userId || !key) {
            return res.status(400).json({
                status: false,
                message: `'key' parameter is required.`
            });
        }

        let params = {};
        if (key === 'notifications') {
            params = [
                { userId: userId },
                {
                    $set: {
                        notification_counts: 0
                    }
                },
                {
                    returnDocument: 'after'
                }
            ]
        } else {
            params = [
                { userId: userId },
                {
                    $set: {
                        mention_counts: 0
                    }
                },
                {
                    returnDocument: 'after'
                }
            ]
        }

        const query = {
            type: SCHEMA_TYPE.USERID,
            data: params
        }

        const response = await MongoDbCrudOpration(req.headers['companyid'], query, 'findOneAndUpdate');

        socketEmitter.emit('update', { type: "update", data: response , module: 'userIdNotification' });

        return res.status(200).json({ status: true });

    } catch (error) {
        return res.status(500).json({
            message: "An error occurred while update the user id count",
            error: error 
        });
    }
}