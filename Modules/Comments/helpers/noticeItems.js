const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { COMMENT_NOTICE_ITEMS } = require('../../../Config/notificationKey');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../../utils/commonFunctions');

const done = new Set();

/* A preference the settings document lacks sends nothing and never shows in the settings grid, so documents
 * written before these types existed get them, switched on, the first time this process needs them. */
const ensureCommentNoticeItems = async (companyId, userIds) => {
    const company = String(companyId || '');
    const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String))]
        .filter((id) => !done.has(`${company}:${id}`));
    if (!company || !ids.length) return;
    for (const item of COMMENT_NOTICE_ITEMS) {
        await MongoDbCrudOpration(company, {
            type: SCHEMA_TYPE.NOTIFICATIONS_SETTINGS,
            data: [
                { userId: { $in: ids }, 'tasks.items': { $exists: true }, 'tasks.items.key': { $ne: item.key } },
                { $push: { 'tasks.items': { ...item } } },
            ],
        }, 'updateMany');
    }
    ids.forEach((id) => {
        done.add(`${company}:${id}`);
        removeCache(`notification:${id}:${company}`);
    });
};

const forgetHealed = () => done.clear();

module.exports = { ensureCommentNoticeItems, forgetHealed };
