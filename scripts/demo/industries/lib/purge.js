const { SCHEMA_TYPE } = require('../../../../Config/schemaType');
const { dbCollections } = require('../../../../Config/collections');
const { MARK, isDemoInstance, isShowcaseCompany, isShowcasePerson } = require('./guard');

const deleted = (result) => (result && result.deletedCount) || 0;

/* Returns a public demo instance to the demo companies alone: every other company (with its database, storage and
 * bucket) and every account except the demo companies' people and `keepEmails` go. Refused off a DEMO_MODE instance,
 * because on any other install those companies are someone's real work. */
async function purgeVisitors({ adapter, keepEmails = [], env = process.env, log = () => {} }) {
    if (!isDemoInstance(env)) throw new Error('Refusing to purge: --purge runs only where DEMO_MODE is "true".');
    const keep = new Set(keepEmails.map((email) => String(email || '').trim().toLowerCase()).filter(Boolean));
    if (!keep.size) throw new Error('Refusing to purge: no account to keep (set DEMO_EMAIL or pass --owner).');
    const removed = { companies: 0, users: 0, userAuth: 0, sessions: 0, buckets: 0 };

    const companies = await adapter.find(adapter.GLOBAL, SCHEMA_TYPE.COMPANIES, {}, { _id: 1, Cst_CompanyName: 1, demoShowcase: 1 });
    for (const company of companies.filter((row) => !isShowcaseCompany(row))) {
        const id = String(company._id);
        const notShowcase = { _id: adapter.oid(id), 'demoShowcase.by': { $ne: MARK } };
        await adapter.globalWrite(SCHEMA_TYPE.COMPANIES, 'updateOne', notShowcase, { $set: { deletingAt: new Date() } });
        await adapter.dropCompany(id);
        removed.buckets += deleted(await adapter.globalWrite(dbCollections.BUCKETS, 'deleteMany', { id }));
        await adapter.globalWrite(SCHEMA_TYPE.USERS, 'updateMany', { AssignCompany: id }, { $pull: { AssignCompany: id } });
        await adapter.globalWrite(SCHEMA_TYPE.USERS, 'updateMany', { lastSelectedCompany: id }, { $unset: { lastSelectedCompany: 1 } });
        removed.companies += deleted(await adapter.globalWrite(SCHEMA_TYPE.COMPANIES, 'deleteOne', notShowcase));
        log(`Removed ${company.Cst_CompanyName || id} (${id})`);
    }

    const users = await adapter.find(adapter.GLOBAL, SCHEMA_TYPE.USERS, {}, { _id: 1, Employee_Email: 1, demoShowcase: 1 });
    const goIds = users
        .filter((user) => !keep.has(String(user.Employee_Email || '').toLowerCase()) && !isShowcasePerson(user))
        .map((user) => String(user._id));
    if (goIds.length) {
        removed.sessions = deleted(await adapter.globalWrite(dbCollections.SESSIONS, 'deleteMany', { userId: { $in: goIds } }));
        removed.userAuth = deleted(await adapter.globalWrite(dbCollections.USER_AUTH, 'deleteMany', { _id: { $in: goIds } }));
        removed.users = deleted(await adapter.globalWrite(SCHEMA_TYPE.USERS, 'deleteMany', { _id: { $in: goIds } }));
    }
    return removed;
}

module.exports = { purgeVisitors };
