const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections } = require('../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { assertLocalTarget } = require('../../demo/lib/guard');
const { GLOBAL, isScaleUser, findScaleCompany, openScaleCompany, globalFind } = require('./guard');
const { MARK } = require('./shape');

const globalWrite = (type, method, ...data) => MongoDbCrudOpration(GLOBAL, { type, data }, method);
const deleted = (result) => (result && result.deletedCount) || 0;

/* Removes the marked company's database and the rows the seed left in the global database: the marked users with their
 * sign-in rows and sessions, the storage bucket and the company. A user who belongs to any other company is kept.
 * The company row goes last, so a run that stops halfway can be repeated. */
async function dropScale({ adapter = require('./adapter') } = {}) {
    assertLocalTarget(process.env);
    const removed = { company: 0, bucket: 0, users: 0, userAuth: 0, sessions: 0, keptUsers: 0 };
    const company = await findScaleCompany();
    if (!company) return { companyId: null, removed };

    const { companyId } = await openScaleCompany(company._id);
    const markedCompany = { _id: companyId, 'scaleSeed.by': MARK };
    await globalWrite(SCHEMA_TYPE.COMPANIES, 'updateOne', markedCompany, { $set: { deletingAt: new Date() } });

    const users = (await globalFind(SCHEMA_TYPE.USERS, { scaleSeed: MARK })).filter(isScaleUser);
    const ownOnly = users.filter((user) => (user.AssignCompany || []).map(String).every((id) => id === companyId));
    removed.keptUsers = users.length - ownOnly.length;
    const userIds = ownOnly.map((user) => String(user._id));
    if (userIds.length) {
        removed.sessions = deleted(await globalWrite(dbCollections.SESSIONS, 'deleteMany', { userId: { $in: userIds } }));
        removed.userAuth = deleted(await globalWrite(dbCollections.USER_AUTH, 'deleteMany', { _id: { $in: userIds } }));
        removed.users = deleted(await globalWrite(SCHEMA_TYPE.USERS, 'deleteMany', { _id: { $in: userIds }, scaleSeed: MARK }));
    }

    await adapter.dropCompany(companyId);
    removed.bucket = deleted(await globalWrite(dbCollections.BUCKETS, 'deleteMany', { id: companyId }));
    removed.company = deleted(await globalWrite(SCHEMA_TYPE.COMPANIES, 'deleteOne', markedCompany));
    return { companyId, removed };
}

module.exports = { dropScale };
