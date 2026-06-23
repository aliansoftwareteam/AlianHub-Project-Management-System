const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const logger = require("../../Config/loggerConfig");
const { normalizeAuditEntry, retentionCutoff } = require("./helpers/auditRules");

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

// Convenience: pull actor + ip from an Express req.
const recordAuditFromReq = (req, entry) => {
    const companyId = req.headers['companyid'] || (req.body && req.body.companyId);
    const userData = (req.body && req.body.userData) || {};
    const forwarded = req.headers['x-forwarded-for'] || req.ip;
    recordAudit(companyId, {
        actorId: req.uid || userData.id || userData._id || '',
        actorName: userData.name || userData.Employee_Name || '',
        ip: forwarded ? String(forwarded).split(',')[0] : '',
        ...entry,
    });
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
