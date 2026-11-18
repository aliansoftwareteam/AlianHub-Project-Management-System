const { SCHEMA_TYPE } = require('../../../../Config/schemaType');
const { dbCollections } = require('../../../../Config/collections');
const { MARK, OBJECT_ID, isShowcaseCompany, isShowcasePerson } = require('./guard');

const deleted = (result) => (result && result.deletedCount) || 0;

/* Removes one demo company: its database and storage, its people who belong to no other company, the company from
 * everyone else's list, its bucket and its row. The row goes last, so a removal that stops halfway can be repeated. */
async function dropShowcase({ companyId, adapter }) {
    const id = String(companyId || '');
    if (!OBJECT_ID.test(id)) throw new Error('A company id is required.');
    const company = await adapter.findOne(adapter.GLOBAL, SCHEMA_TYPE.COMPANIES, { _id: adapter.oid(id) });
    if (!isShowcaseCompany(company)) throw new Error(`Refusing to remove ${id}: it is not a demo industry company.`);

    const removed = { users: 0, userAuth: 0, sessions: 0, unlinked: 0, bucket: 0, company: 0 };
    const members = await adapter.find(adapter.GLOBAL, SCHEMA_TYPE.USERS, { AssignCompany: id }, { _id: 1, AssignCompany: 1, Employee_Email: 1, demoShowcase: 1, lastSelectedCompany: 1 });
    const own = members.filter((user) => isShowcasePerson(user) && (user.AssignCompany || []).map(String).every((cid) => cid === id));
    const ownIds = own.map((user) => String(user._id));
    if (ownIds.length) {
        removed.sessions = deleted(await adapter.globalWrite(dbCollections.SESSIONS, 'deleteMany', { userId: { $in: ownIds } }));
        removed.userAuth = deleted(await adapter.globalWrite(dbCollections.USER_AUTH, 'deleteMany', { _id: { $in: ownIds } }));
        removed.users = deleted(await adapter.globalWrite(SCHEMA_TYPE.USERS, 'deleteMany', { _id: { $in: ownIds }, demoShowcase: MARK }));
    }
    const others = members.filter((user) => !ownIds.includes(String(user._id)));
    for (const user of others) {
        await adapter.globalWrite(SCHEMA_TYPE.USERS, 'updateOne', { _id: user._id }, {
            $pull: { AssignCompany: id },
            ...(String(user.lastSelectedCompany || '') === id ? { $unset: { lastSelectedCompany: 1 } } : {}),
        });
        removed.unlinked += 1;
    }

    await adapter.globalWrite(SCHEMA_TYPE.COMPANIES, 'updateOne', { _id: adapter.oid(id), 'demoShowcase.by': MARK }, { $set: { deletingAt: new Date() } });
    await adapter.dropCompany(id);
    removed.bucket = deleted(await adapter.globalWrite(dbCollections.BUCKETS, 'deleteMany', { id }));
    removed.company = deleted(await adapter.globalWrite(SCHEMA_TYPE.COMPANIES, 'deleteOne', { _id: adapter.oid(id), 'demoShowcase.by': MARK }));
    return { companyId: id, name: company.Cst_CompanyName, removed };
}

module.exports = { dropShowcase };
