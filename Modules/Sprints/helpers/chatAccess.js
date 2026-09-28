const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { evaluatePermission, isWritable } = require('../../../Config/permissionGuard');
const logger = require('../../../Config/loggerConfig');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const CHAT_CHANNEL = 'chat.chat_channel';
const CHAT_CATEGORY = 'chat.chat_category';

const idsIn = (value) => [...new Set([].concat(value || []).map(String).filter((id) => OBJECT_ID.test(id)))];

const chatSpaces = async (companyId, ids) => {
    const wanted = idsIn(ids);
    if (!wanted.length || !OBJECT_ID.test(String(companyId || ''))) return [];
    return (await MongoDbCrudOpration(String(companyId), {
        type: SCHEMA_TYPE.MAIN_CHATS,
        data: [{ _id: { $in: wanted.map((id) => new mongoose.Types.ObjectId(id)) } }, { default: 1 }],
    }, 'find')) || [];
};

/* The `passMissing` of a sprint or folder write: a container outside the projects collection
 * goes on to requireChatAccess only when it is a chat space; anything else is not there. */
const isChatSpace = async (req, id) => (await chatSpaces(req.headers['companyid'], [id])).length > 0;

/*
 * Channels and categories live in a chat space and are managed by the holders of the chat key the
 * chat screens gate on, whatever the enforcement mode. The direct-message space holds neither.
 * Who may see a private channel is requireSprintAccess's rule, as for any private sprint.
 * `permission(req)` names the key, or null when the write only touches the caller's own entry.
 */
const requireChatAccess = ({ containers, permission }) => async (req, res, next) => {
    try {
        const companyId = String(req.headers['companyid'] || '');
        const spaces = await chatSpaces(companyId, await containers(req));
        if (!spaces.length) return next();
        if (spaces.some((space) => space.default === true)) {
            return res.status(404).json({ status: false, statusText: 'Channel not found.', error: 'Not Found' });
        }
        const key = await permission(req);
        if (key && !isWritable(await evaluatePermission(companyId, req.uid, key, { strict: true }))) {
            return res.status(403).json({ status: false, statusText: 'You do not have permission to perform this action.', error: 'Forbidden', permission: key });
        }
        return next();
    } catch (error) {
        logger.error(`requireChatAccess error: ${error.message || error}`);
        return res.status(403).json({ status: false, statusText: 'Permission check failed.', error: 'Forbidden' });
    }
};

module.exports = { CHAT_CHANNEL, CHAT_CATEGORY, isChatSpace, requireChatAccess };
