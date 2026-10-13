const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections } = require('../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { assertLocalTarget } = require('./guard');
const { readAccounts, writeAccounts, removeAccountsFile } = require('./accounts');
const { idForms } = require('./ids');

const GLOBAL = dbCollections.GLOBAL;

/* A row goes only when the manifest lists it AND it is demo-flagged, or (for collections without
 * the flag) it hangs off a demo-flagged parent. An edited manifest cannot reach real data. */
async function unseedCompany(companyId, records) {
    const manifest = (key) => (records[key] || []).map(String);
    const flaggedIds = async (db, type, key) => {
        const ids = manifest(key);
        if (!ids.length) return [];
        const rows = await MongoDbCrudOpration(db, { type, data: [{ _id: { $in: ids }, demo: true }, { _id: 1 }] }, 'find');
        return (rows || []).map((row) => String(row._id));
    };

    const [users, companyUsers, projects, sprints, tasks, agents] = await Promise.all([
        flaggedIds(GLOBAL, SCHEMA_TYPE.USERS, 'users'),
        flaggedIds(companyId, SCHEMA_TYPE.COMPANY_USERS, 'companyUsers'),
        flaggedIds(companyId, SCHEMA_TYPE.PROJECTS, 'projects'),
        flaggedIds(companyId, SCHEMA_TYPE.SPRINTS, 'sprints'),
        flaggedIds(companyId, SCHEMA_TYPE.TASKS, 'tasks'),
        flaggedIds(companyId, SCHEMA_TYPE.AGENTS, 'agents'),
    ]);

    const removed = {};
    const remove = async (key, db, type, filter) => {
        if (!filter._id.$in.length) {
            removed[key] = 0;
            return;
        }
        const out = await MongoDbCrudOpration(db, { type, data: [filter] }, 'deleteMany');
        removed[key] = (out && out.deletedCount) || 0;
    };
    const listed = (key, parent) => ({ _id: { $in: manifest(key) }, ...parent });
    const flagged = (ids) => ({ _id: { $in: ids }, demo: true });

    await remove('agentRevisions', companyId, SCHEMA_TYPE.AGENT_REVISIONS, listed('agentRevisions', { agentId: { $in: agents } }));
    await remove('agents', companyId, SCHEMA_TYPE.AGENTS, flagged(agents));
    await remove('notifications', companyId, SCHEMA_TYPE.NOTIFICATIONS, listed('notifications', { projectId: { $in: idForms(projects) } }));
    await remove('globalNotifications', GLOBAL, dbCollections.NOTIFICATIONS, listed('globalNotifications', { projectId: { $in: idForms(projects) } }));
    await remove('history', companyId, SCHEMA_TYPE.HISTORY, listed('history', { ProjectId: { $in: idForms(projects) } }));
    await remove('tasks', companyId, SCHEMA_TYPE.TASKS, flagged(tasks));
    await remove('sprints', companyId, SCHEMA_TYPE.SPRINTS, flagged(sprints));
    await remove('projects', companyId, SCHEMA_TYPE.PROJECTS, flagged(projects));
    await remove('sessions', GLOBAL, dbCollections.SESSIONS, listed('sessions', { userId: { $in: users } }));
    await remove('notificationSettings', companyId, SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, listed('notificationSettings', { userId: { $in: idForms(users) } }));
    await remove('userIdCounts', companyId, dbCollections.USERID, listed('userIdCounts', { userId: { $in: idForms(users) } }));
    await remove('companyUsers', companyId, SCHEMA_TYPE.COMPANY_USERS, flagged(companyUsers));
    await remove('users', GLOBAL, SCHEMA_TYPE.USERS, flagged(users));
    await remove('userAuth', GLOBAL, dbCollections.USER_AUTH, { _id: { $in: manifest('userAuth').filter((id) => users.includes(id)) } });
    return removed;
}

async function unseedDemoTeam({ company, accountsPath } = {}) {
    assertLocalTarget(process.env);
    const accounts = readAccounts(accountsPath);
    const companyIds = company === undefined ? Object.keys(accounts.companies) : [String(company)];
    const results = {};
    for (const companyId of companyIds) {
        const entry = accounts.companies[companyId];
        if (!entry) throw new Error(`The credentials file has no demo team for company ${companyId}.`);
        results[companyId] = await unseedCompany(companyId, entry.records || {});
        delete accounts.companies[companyId];
        if (Object.keys(accounts.companies).length) writeAccounts(accountsPath, accounts);
        else removeAccountsFile(accountsPath);
    }
    return results;
}

module.exports = { unseedDemoTeam };
