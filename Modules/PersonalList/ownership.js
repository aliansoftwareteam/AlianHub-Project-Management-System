const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

/* A personal list belongs to its owner alone, whatever the role of whoever asks: the rule
 * decideProjectAccess applies in Config/projectAccess.js, as a clause for a project query. */
const ownOrNotPersonal = (uid) => ({ $or: [{ isPersonal: { $ne: true } }, { personalOwner: String(uid) }] });

const isSomeoneElsesPersonalList = (project, uid) => Boolean(project) && project.isPersonal === true && String(project.personalOwner || '') !== String(uid);

const othersPersonalListIds = async (companyId, uid) => {
    const lists = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ isPersonal: true, personalOwner: { $ne: String(uid) } }, { _id: 1 }],
    }, 'find');
    return (lists || []).map((list) => String(list._id));
};

module.exports = { ownOrNotPersonal, isSomeoneElsesPersonalList, othersPersonalListIds };
