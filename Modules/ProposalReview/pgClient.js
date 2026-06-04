/**
 * Read-only Postgres client for the proposal-review feature.
 *
 * The Upwork job details live in an EXTERNAL Postgres database (the
 * "portfolios" DB). This feature ONLY reads from it (fetch job by token) —
 * it never writes. The connection string comes from the PROPOSAL_PG_URL env
 * var and is never hardcoded or logged.
 *
 * A lazily-created connection pool is reused across requests. If the env var
 * is missing, `isConfigured()` returns false and the engine reports a clear
 * "Postgres not configured" error instead of crashing.
 */
'use strict';

const logger = require('../../Config/loggerConfig');

let Pool = null;
try {
    ({ Pool } = require('pg'));
} catch (_e) {
    Pool = null; // pg not installed yet — handled by isConfigured()
}

let pool = null;

function isConfigured() {
    return Boolean(Pool && process.env.PROPOSAL_PG_URL);
}

function getPool() {
    if (!isConfigured()) return null;
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.PROPOSAL_PG_URL,
            max: Number(process.env.PROPOSAL_PG_POOL_MAX) || 4,
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000,
        });
        pool.on('error', (err) => {
            logger.error(`ProposalReview pg pool error: ${err && err.message ? err.message : err}`);
        });
    }
    return pool;
}

/**
 * Fetch the Upwork job for a given ciphertext token (the `~<token>` from the
 * task name). Matches against the stored URL, which contains the same token.
 * Read-only SELECT. Returns the row or null.
 *
 * @param {string} token e.g. "022061150668529048351"
 */
async function findJobByToken(token) {
    const p = getPool();
    if (!p || !token) return null;
    // Jobs are stored inconsistently, so match on multiple keys:
    //   1. the full ciphertext token appears verbatim in `url`, OR
    //   2. the `jobId` column holds the token with its 2-char version prefix
    //      (e.g. "02"/"01") stripped — many rows only match this way, NOT url, OR
    //   3. the `jobId` equals the token verbatim.
    // (The url-only match missed jobs whose url is a search/details link that
    // doesn't embed the full ~token.)
    const stripped = token.replace(/^0[0-9]/, '');
    const sql = 'SELECT "jobId", title, description, questions, "proposalQuestionAnswer" '
        + 'FROM "Jobs" WHERE url LIKE $1 OR "jobId" = $2 OR "jobId" = $3 LIMIT 1';
    const res = await p.query(sql, ['%' + token + '%', stripped, token]);
    return res.rows[0] || null;
}

module.exports = { isConfigured, findJobByToken, getPool };
