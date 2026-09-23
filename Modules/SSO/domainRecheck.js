const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { domainTxtRecord, txtRecordsInclude, keepVerifications, keepLapses } = require('./helpers/ssoRules');
const { resolveTxt, saysRecordAbsent } = require('./helpers/dnsTxt');

// One missed day is a DNS migration or a typo being fixed; three in a row is a domain the company let go.
const LAPSE_AFTER_FAILED_CHECKS = 3;

const FOUND = 'found';
const ABSENT = 'absent';
const UNKNOWN = 'unknown';

const checkRecord = async (domain, token) => {
    const record = domainTxtRecord(domain, token);
    try {
        return txtRecordsInclude(await resolveTxt(record.name), record.value) ? FOUND : ABSENT;
    } catch (error) {
        return saysRecordAbsent(error) ? ABSENT : UNKNOWN;
    }
};

const recheckCompanyDomains = async (companyId) => {
    const cfg = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SSO_CONFIGS, data: [{ deletedStatusKey: 0 }] }, 'findOne');
    const token = cfg && cfg.domainVerificationToken;
    const verified = cfg ? keepVerifications(cfg.verifiedDomains, cfg.domains) : [];
    if (!token || !verified.length) return { lapsed: [] };

    const now = new Date();
    const stillVerified = [];
    const lapsed = [];
    for (const entry of verified) {
        const result = await checkRecord(entry.domain, token); // eslint-disable-line no-await-in-loop
        if (result === UNKNOWN) {
            stillVerified.push(entry);
            continue;
        }
        const failedChecks = result === FOUND ? 0 : (entry.failedChecks || 0) + 1;
        if (failedChecks >= LAPSE_AFTER_FAILED_CHECKS) lapsed.push({ domain: entry.domain, lapsedAt: now, failedChecks });
        else stillVerified.push({ ...entry, lastCheckedAt: now, failedChecks });
    }

    const lapsedDomains = [
        ...keepLapses(cfg.lapsedDomains, cfg.domains, stillVerified).filter((l) => !lapsed.some((n) => n.domain === l.domain)),
        ...lapsed.map(({ domain, lapsedAt }) => ({ domain, lapsedAt })),
    ];
    // Matching the token keeps a config the owner replaced meanwhile from being overwritten with stale domains.
    const saved = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SSO_CONFIGS,
        data: [{ deletedStatusKey: 0, domainVerificationToken: token }, { $set: { verifiedDomains: stillVerified, lapsedDomains } }],
    }, 'findOneAndUpdate');
    if (!saved) return { lapsed: [] };

    lapsed.forEach(({ domain, failedChecks }) => {
        try {
            require('../Audit/recorder').recordAudit(String(companyId), {
                action: 'sso.domain_unverified', entityType: 'sso', entityName: domain, meta: { failedChecks, reason: 'txt_record_missing' },
            });
        } catch (e) { /* audit is best-effort */ }
        logger.info(`[ssoDomainRecheck] ${companyId}: ${domain} is no longer verified`);
    });
    return { lapsed: lapsed.map((l) => l.domain) };
};

const runSsoDomainRecheckForAllCompanies = async () => {
    const companies = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: SCHEMA_TYPE.COMPANIES, data: [{}, { _id: 1 }] }, 'find');
    for (const c of (companies || [])) {
        // eslint-disable-next-line no-await-in-loop
        await recheckCompanyDomains(String(c._id)).catch((e) => logger.error(`[ssoDomainRecheck] ${c._id}: ${e.message}`));
    }
};

module.exports = { LAPSE_AFTER_FAILED_CHECKS, recheckCompanyDomains, runSsoDomainRecheckForAllCompanies };
