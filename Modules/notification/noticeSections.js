const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');

/* A section or an item the settings document lacks sends nothing and never shows in the settings grid, so documents
 * written before a section existed get it, switched on, the first time this process needs it. */
const sectionHealer = (section, fresh) => {
    const done = new Set();
    const items = `${section.key}.items`;

    const ensure = async (companyId, userIds) => {
        const company = String(companyId || '');
        const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String))]
            .filter((id) => !done.has(`${company}:${id}`));
        if (!company || !ids.length) return;
        await MongoDbCrudOpration(company, {
            type: SCHEMA_TYPE.NOTIFICATIONS_SETTINGS,
            data: [
                { userId: { $in: ids }, [section.key]: { $exists: false } },
                { $set: { [section.key]: fresh() } },
            ],
        }, 'updateMany');
        for (const item of section.items) {
            await MongoDbCrudOpration(company, {
                type: SCHEMA_TYPE.NOTIFICATIONS_SETTINGS,
                data: [
                    { userId: { $in: ids }, [items]: { $exists: true }, $nor: [{ [items]: { $elemMatch: { key: item.key } } }] },
                    { $push: { [items]: { ...item } } },
                ],
            }, 'updateMany');
        }
        ids.forEach((id) => {
            done.add(`${company}:${id}`);
            removeCache(`notification:${id}:${company}`);
        });
    };

    return { ensure, forget: () => done.clear() };
};

module.exports = { sectionHealer };
