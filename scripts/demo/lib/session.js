const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections } = require('../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { assertLocalTarget } = require('./guard');
const { readAccounts, writeAccounts, findDemoAccount, normaliseEmail, track } = require('./accounts');
const { SESSION_SECONDS } = require('./team');

async function issueSessionToken({ email, accountsPath, adapter = require('./appAdapter') } = {}) {
    assertLocalTarget(process.env);
    if (typeof email !== 'string' || !email.trim()) throw new Error('Pass --email <demo email>.');
    const wanted = normaliseEmail(email);

    const accounts = readAccounts(accountsPath);
    const hit = findDemoAccount(accounts, wanted);
    if (!hit) throw new Error(`${wanted} is not a demo account in .demo-accounts.local.json.`);

    const user = await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [{ _id: String(hit.account.userId), demo: true }],
    }, 'findOne');
    if (!user || normaliseEmail(user.Employee_Email) !== wanted) throw new Error(`${wanted} is not a demo user in this database.`);
    if (!(user.AssignCompany || []).map(String).includes(hit.companyId)) {
        throw new Error(`${wanted} is not a member of company ${hit.companyId}.`);
    }

    const { accessToken, sessionId } = await adapter.issueSession(String(user._id));
    track(hit.entry, 'sessions', sessionId);
    writeAccounts(accountsPath, accounts);
    return { accessToken, companyId: hit.companyId, expiresInSeconds: SESSION_SECONDS };
}

module.exports = { issueSessionToken };
