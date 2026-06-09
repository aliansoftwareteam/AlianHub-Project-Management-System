/**
 * Read-only Postgres client for the Proposal Review feature.
 *
 * Only purpose: given an Upwork ~token extracted from a task name, return the
 * matching row from the "Jobs" table so the Managed Agent can evaluate the
 * proposal against the real job requirements.
 *
 * HARD GUARANTEES:
 *   - Only SELECT is exposed. No insert/update/delete/exec helpers.
 *   - All values are passed as bound parameters ($1, $2…). No string-built SQL.
 *   - The pool is created lazily on first use and reused thereafter.
 *
 * Env vars (read at first call):
 *   - PROPOSAL_PG_URL          required, e.g. postgresql://user:pass@host:5432/portfolios
 *   - PROPOSAL_PG_POOL_MAX     optional, default 4
 */
'use strict';

let Pool;
try {
    ({ Pool } = require('pg'));
} catch (_e) {
    Pool = null;
}

const logger = require('../../Config/loggerConfig');

let pool = null;

function isConfigured() {
    return Boolean(Pool && process.env.PROPOSAL_PG_URL);
}

function getPool() {
    if (pool) return pool;
    if (!isConfigured()) {
        throw new Error('ProposalReview Postgres client not configured: install `pg` and set PROPOSAL_PG_URL');
    }
    const max = Number(process.env.PROPOSAL_PG_POOL_MAX) || 4;
    pool = new Pool({
        connectionString: process.env.PROPOSAL_PG_URL,
        max,
        // Keep idle connections short — this feature runs a small burst every
        // 5 minutes, not steady traffic. No reason to hold sockets open.
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => {
        logger.error(`ProposalReview pgClient pool error: ${err && err.message ? err.message : err}`);
    });
    return pool;
}

/**
 * Extract the Upwork job token from a task name. Tasks usually contain a URL
 * like `https://www.upwork.com/jobs/~022061197431416346310`; we want the digits
 * after the `~`. Returns the raw token string, or null if no token present.
 *
 *   "Build a Shopify checkout (https://...~022061197431416346310)"  → "022061197431416346310"
 *   "Plain task name with no link"                                  → null
 */
function extractToken(taskName) {
    if (typeof taskName !== 'string') return null;
    const m = taskName.match(/~([0-9a-zA-Z]+)/);
    return m ? m[1] : null;
}

/**
 * Look up a job by the ~token extracted from a task name. The `jobId` column
 * sometimes stores the token with a leading "02" prefix and sometimes without,
 * so we try both candidates in one round-trip.
 *
 * Returns the matching row (object) or null if not found.
 *
 * @param {string} token  Raw digits after `~`, e.g. "022061197431416346310".
 */
async function findJobByToken(token) {
    if (!token || typeof token !== 'string') return null;
    const candidates = [token];
    if (token.startsWith('02') && token.length > 2) {
        candidates.push(token.slice(2));
    } else {
        candidates.push(`02${token}`);
    }
    const sql = 'SELECT * FROM "Jobs" WHERE "jobId" = ANY($1::text[]) LIMIT 1';
    const client = await getPool().connect();
    try {
        const result = await client.query(sql, [candidates]);
        return (result.rows && result.rows[0]) || null;
    } finally {
        client.release();
    }
}

/**
 * Smoke helper: verify the connection itself works without touching the Jobs
 * table. Useful for startup diagnostics.
 */
async function ping() {
    const client = await getPool().connect();
    try {
        const r = await client.query('SELECT 1 AS ok');
        return r.rows[0] && r.rows[0].ok === 1;
    } finally {
        client.release();
    }
}

async function close() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

module.exports = {
    isConfigured,
    extractToken,
    findJobByToken,
    ping,
    close,
};
