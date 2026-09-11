const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const logger = require("../../Config/loggerConfig");
const { normalizeAuditEntry, retentionCutoff } = require("./helpers/auditRules");

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

// SEC-04 — record an audit row. Fire-and-forget: NEVER throws to the caller, so
// a logging hiccup can never break the mutation it's recording.
const recordAudit = (companyId, entry) => {
    try {
        if (!companyId) return;
        const n = normalizeAuditEntry(entry);
        if (!n.valid) return;
        MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUDIT_LOGS, data: n.entry }, 'save')
            .catch((e) => logger.error(`recordAudit ${companyId}: ${e.message || e}`));
    } catch (e) {
        logger.error(`recordAudit threw: ${e.message || e}`);
    }
};

const sessionActorName = async (uid) => {
    if (!OBJECT_ID_PATTERN.test(uid)) return '';
    const user = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: uid }, { Employee_Name: 1 }] }, 'findOne');
    return (user && user.Employee_Name) || '';
};

/* The actor is whoever the session says; a name or id in the request body is only the client's claim. */
const recordAuditFromReq = (req, entry) => {
    const companyId = req.headers['companyid'] || (req.body && req.body.companyId);
    const actorId = req.uid ? String(req.uid) : '';
    const forwarded = req.headers['x-forwarded-for'] || req.ip;
    const ip = forwarded ? String(forwarded).split(',')[0] : '';
    sessionActorName(actorId)
        .catch((e) => {
            logger.error(`audit actor lookup ${actorId}: ${e.message || e}`);
            return '';
        })
        .then((actorName) => recordAudit(companyId, { actorId, actorName, ip, ...entry }));
};

// Cron: prune rows older than the retention window, across every company.
const runAuditRetentionForAllCompanies = async (retentionDays) => {
    try {
        const companies = await MongoDbCrudOpration('global', { type: SCHEMA_TYPE.COMPANIES, data: [{}, { _id: 1 }] }, 'find');
        const cutoff = retentionCutoff(new Date(), retentionDays || Number(process.env.AUDIT_RETENTION_DAYS) || undefined);
        for (const c of (companies || [])) {
            // eslint-disable-next-line no-await-in-loop
            await MongoDbCrudOpration(String(c._id), { type: SCHEMA_TYPE.AUDIT_LOGS, data: [{ createdAt: { $lt: cutoff } }] }, 'deleteMany')
                .catch((e) => logger.error(`audit prune ${c._id}: ${e.message || e}`));
        }
    } catch (error) {
        logger.error(`runAuditRetentionForAllCompanies: ${error.message || error}`);
    }
};

module.exports = { recordAudit, recordAuditFromReq, runAuditRetentionForAllCompanies };
