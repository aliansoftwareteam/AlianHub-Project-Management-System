const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { myCache } = require('../../Config/config');
const { removeCache } = require("../../utils/commonFunctions");
const { replaceObjectKey } = require("../Auth/helper");
const logger = require('../../Config/loggerConfig.js');
exports.getChats = async (req, res) => {
    try {
        const chatsObj = {
            type: SCHEMA_TYPE.MAIN_CHATS,
            data: []
        };

        const mainChatCacheKey = `mainChat:${req.headers['companyid']}`; 
        let chats = myCache.get(mainChatCacheKey);
        let isFromCache = true;
        if (!chats) {
            isFromCache = false;
            chats = await MongoDbCrudOpration(req.headers['companyid'], chatsObj, 'find');

            if (!chats || chats.length === 0) {
                return res.status(404).json({ message: "Chats not found" });
            }

            myCache.set(mainChatCacheKey, chats, 3600); 
        }
        if (isFromCache) {
            res.set({
                'FromCache': 'true',
                'cacheExpireTime': myCache.getTtl(mainChatCacheKey)
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
                removeCache(`mainChat:${JSON.parse(JSON.stringify(result))?._id}`, true);
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