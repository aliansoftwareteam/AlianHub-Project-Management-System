const crypto = require('crypto');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const logger = require('../../Config/loggerConfig');
const { chainConfig } = require('./helpers/chainRules');

/*
 * AUDIT_CHAIN_KEY cannot change (owner decision, 2026-09-23): rows, heads and anchors do not record which key
 * signed them, so under a new key every older chained row reads as broken. The first start with the chain on
 * stores a fingerprint of the key; a later start under a different key refuses to run.
 */

const LOG = '[audit-chain]';
const DOC_ID = 'key';
const FINGERPRINT_LABEL = 'alianhub-audit-chain-key-fingerprint:v1';

/* Audit row hashes are already HMACs under this key over known content, so this reveals nothing more about it. */
const fingerprintOf = (key) => crypto.createHmac('sha256', key).update(FINGERPRINT_LABEL).digest('hex');

const defaultRun = (data, method) => require('../../utils/mongo-handler/mongoQueries')
    .MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.AUDIT_CHAIN_KEY, data }, method);

const defaultExit = (message) => require('../../Config/processGuards').fatal(message, 'audit-chain-key');

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

const since = (stored) => (stored.at ? new Date(stored.at).toISOString() : 'an earlier start');

const changedMessage = (stored) => `${LOG} AUDIT_CHAIN_KEY has changed: it does not match the key fingerprint stored `
    + `on ${since(stored)} in the ${SCHEMA_TYPE.AUDIT_CHAIN_KEY} collection of the global database. The key cannot change: `
    + 'audit rows, chain heads and anchors do not record which key signed them, so under a new key every older chained '
    + `audit row would read as broken. The server will not start. Set AUDIT_CHAIN_KEY back to the value it had on ${since(stored)} `
    + '(from your secret store or the backup of the old environment) and start the server again.';

const readStored = async (run) => plain(await run([{ _id: DOC_ID }], 'findOne'));

/* A concurrent first start by another server loses the upsert race here, then reads the winner's fingerprint. */
const storeOnce = async (run, fingerprint) => {
    try {
        await run([{ _id: DOC_ID }, { $setOnInsert: { fingerprint, at: new Date() } }, { upsert: true }], 'updateOne');
    } catch (error) {
        if (!error || error.code !== 11000) throw error;
    }
};

/** Resolves 'off', 'stored', 'match', 'refused' or 'unchecked'; a refusal calls exit(message, 1). */
const checkKey = async ({ env = process.env, exit = defaultExit, run = defaultRun } = {}) => {
    const cfg = chainConfig(env);
    if (!cfg.on) return 'off';
    const fingerprint = fingerprintOf(cfg.key);
    let stored;
    let result = 'match';
    try {
        stored = await readStored(run);
        if (!stored) {
            await storeOnce(run, fingerprint);
            stored = await readStored(run);
            result = 'stored';
        }
        if (!stored) throw new Error(`the ${SCHEMA_TYPE.AUDIT_CHAIN_KEY} document was not found after it was written`);
    } catch (error) {
        logger.error(`${LOG} could not check AUDIT_CHAIN_KEY against its stored fingerprint, starting unchecked: ${(error && error.message) || error}`);
        return 'unchecked';
    }
    if (stored.fingerprint !== fingerprint) {
        await exit(changedMessage(stored), 1);
        return 'refused';
    }
    if (result === 'stored') logger.info(`${LOG} stored the AUDIT_CHAIN_KEY fingerprint in the global database; the key cannot change from now on`);
    return result;
};

const guardAtBoot = async ({ env = process.env } = {}) => {
    if (!env.MONGODB_URL || !chainConfig(env).on) return 'off';
    const { checkDb } = require('../Instance/health');
    const db = await checkDb();
    if (!db.ok) {
        logger.error(`${LOG} could not check AUDIT_CHAIN_KEY against its stored fingerprint, starting unchecked: ${db.error}`);
        return 'unchecked';
    }
    return checkKey({ env });
};

module.exports = { FINGERPRINT_LABEL, fingerprintOf, checkKey, guardAtBoot };
