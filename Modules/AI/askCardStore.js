const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

/* The answers Ask cards keep, one per dashboard, card and viewer (Modules/AI/askCard reads and writes them). */

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const store = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.DASHBOARD_CARD_ANSWERS, data }, method);

/* Drops the answers of every card of the dashboard that is not in `keptUids`. */
const forgetCards = async (companyId, dashboardId, keptUids = []) => {
    const result = await store(companyId, [{ dashboardId: String(dashboardId), cardUid: { $nin: keptUids.map(String) } }], 'deleteMany');
    return (result && result.deletedCount) || 0;
};

const validViewer = (userId) => {
    const id = String(userId || '').trim();
    if (!OBJECT_ID.test(id)) throw new Error('Erasing kept card answers needs a valid user id.');
    return id;
};

/* Erasure by person (Knowledge/controls): answers how many kept answers went. */
const eraseViewer = async (companyId, userId) => {
    const result = await store(companyId, [{ userId: validViewer(userId) }], 'deleteMany');
    return (result && result.deletedCount) || 0;
};

const hasAnswers = async (companyId, userId) => Boolean(await store(companyId, [{ userId: validViewer(userId) }, '_id', { lean: true }], 'findOne'));

module.exports = { store, forgetCards, eraseViewer, hasAnswers };
