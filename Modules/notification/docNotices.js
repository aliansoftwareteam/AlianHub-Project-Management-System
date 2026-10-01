const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { DOC_NOTICE_SECTION, docNoticeSection } = require('../../Config/notificationKey');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');

const done = new Set();

/* A section the settings document lacks sends nothing and never shows in the settings grid, so documents
 * written before doc notices existed get it, switched on, the first time this process needs it. */
const ensureDocNoticeSection = async (companyId, userIds) => {
    const company = String(companyId || '');
    const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String))]
        .filter((id) => !done.has(`${company}:${id}`));
    if (!company || !ids.length) return;
    await MongoDbCrudOpration(company, {
        type: SCHEMA_TYPE.NOTIFICATIONS_SETTINGS,
        data: [
            { userId: { $in: ids }, [DOC_NOTICE_SECTION.key]: { $exists: false } },
            { $set: { [DOC_NOTICE_SECTION.key]: docNoticeSection() } },
        ],
    }, 'updateMany');
    ids.forEach((id) => {
        done.add(`${company}:${id}`);
        removeCache(`notification:${id}:${company}`);
    });
};

const forgetHealedDocNotices = () => done.clear();

module.exports = { ensureDocNoticeSection, forgetHealedDocNotices };
