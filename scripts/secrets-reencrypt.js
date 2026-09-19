#!/usr/bin/env node
/* npm run secrets:reencrypt
 * The operator's half of a SECRETS_KEY rotation. With the old key moved to SECRETS_KEY_PREVIOUS and the new one
 * in SECRETS_KEY, it reseals every company's stored secrets under the new key, revokes the copies that were
 * orphaned while no key was set, writes one audit row per company, and says how many live secrets are still
 * on the previous key. SECRETS_KEY_PREVIOUS can be unset only when that number is zero. Safe to run again. */
const crypto = require('crypto');
const path = require('path');

const ACTOR = { id: 'script:secrets-reencrypt' };
const AUDIT_WAIT_MS = 10000;

async function reencryptCompanies({ store, listCompanies, log = console.log }) {
    const cfg = store.config();
    if (!cfg.keyValid) throw new Error(cfg.error || 'SECRETS_KEY is missing or shorter than 32 characters, so nothing can be resealed.');
    const run = crypto.randomBytes(8).toString('hex');
    const companies = {};
    log(`Resealing stored secrets under key ${cfg.keyId}${cfg.previousKeyId ? `, reading ${cfg.previousKeyId} too` : ' (SECRETS_KEY_PREVIOUS is not set)'}.`);
    for (const company of await listCompanies()) {
        const companyId = String(company._id);
        try {
            const orphansRevoked = await store.revokeOrphans({ companyId, actor: ACTOR });
            const counts = await store.reencryptAll({ companyId, actor: ACTOR, run });
            companies[companyId] = { orphansRevoked, ...counts };
            log(`  ${companyId}: moved ${counts.moved}, already current ${counts.kept}, unreadable ${counts.failed}, changed meanwhile ${counts.raced}, revoked ${counts.revoked}, orphans revoked ${orphansRevoked}`);
        } catch (error) {
            companies[companyId] = { error: String((error && error.message) || error) };
            log(`  ${companyId}: FAILED ${companies[companyId].error}`);
        }
    }
    const outcomes = Object.values(companies);
    const sum = (key) => outcomes.reduce((total, outcome) => total + (outcome[key] || 0), 0);
    const failedCompanies = outcomes.filter((outcome) => outcome.error).length;
    const onPreviousKey = sum('onPreviousKey');
    const unreadable = sum('failed');
    const safeToUnset = !failedCompanies && onPreviousKey === 0;

    log(`Live secrets still on the previous key: ${onPreviousKey}`);
    if (unreadable) log(`Live secrets that would not open (their key is not set, or the row is damaged): ${unreadable}. Revoke them under Settings → Integrations and connect again.`);
    if (failedCompanies) log(`Companies that failed: ${failedCompanies}.`);
    log(safeToUnset
        ? 'No live secret is left on the previous key: it is safe to unset SECRETS_KEY_PREVIOUS.'
        : 'Keep SECRETS_KEY_PREVIOUS set, fix the above and run this again.');
    return { run, companies, onPreviousKey, unreadable, safeToUnset, exitCode: safeToUnset && !unreadable ? 0 : 1 };
}

/* The recorder writes after it returns, and this process exits as soon as main does. */
async function auditRowsWritten({ run, expected }) {
    const { SCHEMA_TYPE } = require('../Config/schemaType');
    const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
    const deadline = Date.now() + AUDIT_WAIT_MS;
    for (;;) {
        let written = 0;
        for (const companyId of expected) {
            written += await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUDIT_LOGS, data: [{ action: 'secret.reencrypt', 'meta.run': run }] }, 'countDocuments');
        }
        if (written >= expected.length) return true;
        if (Date.now() > deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}

async function main() {
    require('../Config/applyEnv').loadDotEnv(path.join(__dirname, '..', '.env'));
    if (!process.env.STORAGE_TYPE) process.env.STORAGE_TYPE = 'server';
    if (!process.env.MONGODB_URL) throw new Error('MONGODB_URL is not set.');
    const { SCHEMA_TYPE } = require('../Config/schemaType');
    const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
    const listCompanies = () => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [{}, { _id: 1 }] }, 'find');
    const result = await reencryptCompanies({ store: require('../Config/secrets'), listCompanies });
    const expected = Object.entries(result.companies).filter(([, outcome]) => !outcome.error).map(([companyId]) => companyId);
    if (!(await auditRowsWritten({ run: result.run, expected }))) console.error('The audit rows for this run were not all written before the wait ran out.');
    return result.exitCode;
}

if (require.main === module) {
    main().then((code) => process.exit(code)).catch((error) => {
        console.error(`secrets-reencrypt: ${error.message || error}`);
        process.exit(1);
    });
}

module.exports = { reencryptCompanies };
