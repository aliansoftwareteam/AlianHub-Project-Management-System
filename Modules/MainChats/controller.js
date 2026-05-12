const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { myCache } = require('../../Config/config');
const { removeCache } = require("../../utils/commonFunctions");
const { replaceObjectKey } = require("../Auth/helper");
const logger = require('../../Config/loggerConfig.js');

// BUG-020 / #74 fix: the cache writer in `getChats` used
//   `mainChat:${req.headers['companyid']}`
// while the invalidator in `updateMainChat` built a different key from the
// updated *document's* _id via `JSON.parse(JSON.stringify(result))?._id`.
// The two keys never matched, so cache invalidation was a no-op and stale
// chats stuck around until the 3600s TTL expired. Centralise the key
// builder so set/remove use the same shape.
const mainChatCacheKey = (companyId) => `mainChat:${companyId}`;
exports.mainChatCacheKey = mainChatCacheKey;

exports.getChats = async (req, res) => {
    try {
        const chatsObj = {
            type: SCHEMA_TYPE.MAIN_CHATS,
            data: []
        };

        const cacheKey = mainChatCacheKey(req.headers['companyid']);
        let chats = myCache.get(cacheKey);
        let isFromCache = true;
        if (!chats) {
            isFromCache = false;
            chats = await MongoDbCrudOpration(req.headers['companyid'], chatsObj, 'find');

            if (!chats || chats.length === 0) {
                return res.status(404).json({ message: "Chats not found" });
            }

            myCache.set(cacheKey, chats, 3600);
        }
        if (isFromCache) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(cacheKey)
            });
        }

        res.status(200).json(chats);
    } catch (error) {
        console.error('Error fetching chats:', error);
        res.status(404).json({ message: 'An error occurred while fetching the chats', error: error.message });
    }
}

exports.updateMainChat = (companyId, chatObj) => {
    return new Promise(async (resolve, reject) => {
        try {
            const objSchema = {
                type: SCHEMA_TYPE.MAIN_CHATS,
                data: chatObj
            };
            MongoDbCrudOpration(companyId, objSchema, 'findOneAndUpdate').then((result) => {
                // BUG-020 / #74 fix: use the same key the setter uses
                // (`mainChat:${companyId}`). The old key was built from the
                // updated document's `_id`, which never matched the setter's
                // companyId-keyed entry — cache invalidation was a no-op.
                removeCache(mainChatCacheKey(companyId), true);
                resolve(result);
            })
            .catch((error) => {
                console.error("Error in updateMainChat:", error);
                reject({ message: "An error occurred while updating the main chat.", error: error.message });
            })
        } catch (error) {
            console.error("Error updating main chat:", error);
            reject({ message: "An error occurred while updating the main chat.", error: error.message });
        }
    });
};

exports.setChats = async (req, res) => {
    try {
        const { findQuery } = req.body;
        let query =  replaceObjectKey(findQuery,['objId'])
        const setChatsObj = {
            type: SCHEMA_TYPE.TASKS,
            data: query
        };
        // BUG-019 / #73 fix: `setChat = await ...` without a declaration
        // keyword created an implicit global. In non-strict mode that's a
        // cross-request leak vector (the global is shared between
        // concurrent invocations); in strict mode the assignment throws
        // ReferenceError on first call.
        const setChat = await MongoDbCrudOpration(req.headers['companyid'], setChatsObj, 'find');
        res.status(200).json(setChat)
    } catch (error) {
        logger.error('Error getting setChats query:', JSON.stringify(error));
        res.status(400).json({ error: 'Internal Server Error', message: error.message });
    }
}