const { SCHEMA_TYPE } = require('../../Config/schemaType');
const logger = require('../../Config/loggerConfig');
const { myCache } = require('../../Config/config');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const rolePlaybooks = require('./rolePlaybooks');

const BODY_MAX = 30000;
/* removeCache clears this process only and nothing carries it to other instances, so another instance may read
 * a text up to this long after it was saved or restored. */
const CACHE_SECONDS = 60;
const cacheKeyOf = (companyId) => `rolePlaybookOverrides:${companyId}`;

const keyOf = (blueprint, slug) => `${blueprint}/${slug}`;

/* The company's edited texts as a Map of 'blueprint/slug' to text; a role not in it reads as its built-in text. */
const forCompany = async (companyId) => {
    const key = cacheKeyOf(companyId);
    const hit = myCache.get(key);
    if (hit) return new Map(hit);
    let rows;
    try {
        rows = (await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.ROLE_PLAYBOOK_OVERRIDES, data: [{}, { key: 1, body: 1 }] }, 'find')) || [];
    } catch (e) {
        logger.error(`role playbook overrides: ${e.message}`);
        return new Map();
    }
    const pairs = rows.filter((row) => row && row.key && row.body).map((row) => [String(row.key), String(row.body)]);
    myCache.set(key, pairs, CACHE_SECONDS);
    return new Map(pairs);
};

const apply = (role, overrides) => {
    const body = overrides && overrides.get(keyOf(role.blueprint, role.slug));
    return body ? Object.freeze({ ...role, body }) : role;
};

const applyAll = (roles, overrides) => (overrides && overrides.size ? roles.map((role) => apply(role, overrides)) : roles);

const findFor = async (companyId, blueprint, slug) => {
    const role = rolePlaybooks.find(blueprint, slug);
    return role ? apply(role, await forCompany(companyId)) : null;
};

const validated = (given) => {
    if (typeof given !== 'string') return { error: 'The playbook text must be text.' };
    const body = given.replace(/\r\n/g, '\n').trim();
    if (!body) return { error: 'The playbook text cannot be empty. Restore the built-in text instead.' };
    if (body.length > BODY_MAX) return { error: `The playbook text can be at most ${BODY_MAX} characters.` };
    return { body };
};

const clear = (companyId) => removeCache(cacheKeyOf(companyId));

/* Answers the role as it reads afterwards with what it read before, or the reason nothing was saved. */
const save = async (companyId, blueprint, slug, text, updatedBy) => {
    const built = rolePlaybooks.find(blueprint, slug);
    if (!built) return { error: 'Role not found.', status: 404 };
    const check = validated(text);
    if (check.error) return { error: check.error, status: 400 };
    const from = apply(built, await forCompany(companyId)).body;
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.ROLE_PLAYBOOK_OVERRIDES,
        data: [{ key: keyOf(blueprint, slug) }, { $set: { body: check.body, updatedBy: String(updatedBy) } }, { upsert: true, returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    clear(companyId);
    return { role: built, from, to: check.body };
};

const restore = async (companyId, blueprint, slug) => {
    const built = rolePlaybooks.find(blueprint, slug);
    if (!built) return { error: 'Role not found.', status: 404 };
    const from = apply(built, await forCompany(companyId)).body;
    await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.ROLE_PLAYBOOK_OVERRIDES, data: [{ key: keyOf(blueprint, slug) }] }, 'deleteOne');
    clear(companyId);
    return { role: built, from, to: built.body };
};

rolePlaybooks.useOverrides(async (companyId, role) => (await forCompany(companyId)).get(keyOf(role.blueprint, role.slug)) || null);

module.exports = { BODY_MAX, CACHE_SECONDS, keyOf, forCompany, apply, applyAll, findFor, save, restore, clear };
