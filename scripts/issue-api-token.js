/**
 * Admin script: issue a personal API token (PAT) for a user.
 *
 * Usage (from the repo root, .env must be configured):
 *   node scripts/issue-api-token.js <companyId> <userIdOrEmail> "<token name>" [scopes] [expiresInDays]
 *
 * Examples:
 *   node scripts/issue-api-token.js 64a1... rashesh@aliansoftware.net "MCP — Rashesh laptop"
 *   node scripts/issue-api-token.js 64a1... 64b2... "CI read-only" read 90
 *
 * scopes: comma-separated from {read,write}; omit for full access.
 * The raw token is printed ONCE and never stored — only its sha256 hash.
 */
require('dotenv').config();

const mongoose = require('mongoose');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { generateToken, hashToken, tokenPrefixOf, validateCreateInput } = require('../Modules/ApiTokens/helpers/apiTokenRules');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const fail = (message) => {
    console.error(`\nERROR: ${message}\n`);
    process.exit(1);
};

const main = async () => {
    const [companyId, userRef, name, scopesArg, expiresArg] = process.argv.slice(2);

    if (!companyId || !userRef || !name) {
        fail('Usage: node scripts/issue-api-token.js <companyId> <userIdOrEmail> "<token name>" [scopes] [expiresInDays]');
    }
    if (!OBJECT_ID_PATTERN.test(companyId)) {
        fail('companyId must be a 24-char hex ObjectId.');
    }

    const scopes = scopesArg ? scopesArg.split(',').map((scope) => scope.trim()).filter(Boolean) : [];
    const expiresInDays = expiresArg ? Number(expiresArg) : undefined;
    const check = validateCreateInput({ name, scopes, expiresInDays });
    if (!check.valid) {
        fail(check.reason);
    }

    // Resolve the user from the global users collection (by id or email)
    // and confirm membership of the target company.
    const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = userRef.includes('@')
        // Case-insensitive exact match — emails are stored as entered.
        ? { Employee_Email: { $regex: `^${escapeRegex(userRef.trim())}$`, $options: 'i' } }
        : OBJECT_ID_PATTERN.test(userRef)
            ? { _id: new mongoose.Types.ObjectId(userRef) }
            : null;
    if (!filter) {
        fail('userIdOrEmail must be a 24-char hex ObjectId or an email address.');
    }

    const user = await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: dbCollections.USERS,
        data: [filter],
    }, 'findOne');
    if (!user || !user._id) {
        fail(`No user found for "${userRef}".`);
    }
    const assigned = Array.isArray(user.AssignCompany) ? user.AssignCompany : [user.AssignCompany];
    if (!assigned.map(String).includes(String(companyId))) {
        fail(`User ${user.Employee_Email || user._id} is not a member of company ${companyId}.`);
    }

    const rawToken = generateToken();
    const doc = {
        name: String(name).trim(),
        tokenHash: hashToken(rawToken),
        prefix: tokenPrefixOf(rawToken),
        scopes,
        userId: String(user._id),
        active: true,
    };
    if (expiresInDays) {
        doc.expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    }

    const created = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.API_TOKENS, data: doc }, 'save');

    console.log('\n────────────────────────────────────────────────────────');
    console.log('  API token created — copy it now, it is NOT shown again');
    console.log('────────────────────────────────────────────────────────');
    console.log(`  Token:     ${rawToken}`);
    console.log(`  Token id:  ${created._id}`);
    console.log(`  User:      ${user.Employee_Name || ''} <${user.Employee_Email || ''}> (${user._id})`);
    console.log(`  Company:   ${companyId}`);
    console.log(`  Scopes:    ${scopes.length ? scopes.join(', ') : '(full access)'}`);
    console.log(`  Expires:   ${doc.expiresAt ? doc.expiresAt.toISOString() : 'never'}`);
    console.log('────────────────────────────────────────────────────────');
    console.log('\nSmoke test:');
    console.log(`  curl -H "Authorization: Bearer ${rawToken.slice(0, 12)}..." -H "companyid: ${companyId}" \\`);
    console.log('       https://<your-host>/api/v2/api-tokens/me\n');
    process.exit(0);
};

main().catch((error) => fail(error.message || String(error)));
