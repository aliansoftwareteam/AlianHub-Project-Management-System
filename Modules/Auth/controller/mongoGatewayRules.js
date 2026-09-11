const { dbCollections } = require('../../../Config/collections');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const MAX_RESULTS = 500;

const deepFreeze = (value) => {
    Object.values(value).forEach((child) => {
        if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
    });
    return Object.freeze(value);
};

/* Every shape the shipped clients send. A new caller gets a dedicated endpoint, not a row here. */
const GATEWAY_ALLOWLIST = deepFreeze({
    company: {
        [dbCollections.TIMESHEET]: {
            aggregate: { stages: ['$match', '$group'] },
        },
    },
    global: {},
});

const CREDENTIAL_COLLECTIONS = deepFreeze([
    dbCollections.USER_AUTH,
    dbCollections.SESSIONS,
    dbCollections.RESET_ATTEMPT,
    dbCollections.API_TOKENS,
    dbCollections.API_ACTIVITY_LOGS,
    dbCollections.WASABICREDENTIALS,
    dbCollections.INTEGRATION_CONNECTIONS,
    dbCollections.CLOUD_STORAGE_CONNECTIONS,
    dbCollections.SSO_CONFIGS,
    dbCollections.SCIM_CONFIGS,
    dbCollections.WEBHOOKS,
    dbCollections.EMAIL_INBOXES,
    dbCollections.CALENDAR_FEEDS,
    dbCollections.PUBLIC_SHARES,
    dbCollections.PUBLIC_SHARE_INDEX,
    dbCollections.GLOBALSETTING,
    dbCollections.INSTANCE_SETTINGS,
]);

const SERVER_SIDE_EVALUATION = deepFreeze(['$where', '$function', '$accumulator']);
const UNSAFE_KEYS = deepFreeze(['__proto__', 'constructor', 'prototype']);
const SECRET_KEY_PATTERN = /password|passwd|secret|token|api[-_]?key|private[-_]?key|credential/i;

const refuse = (statusCode, message) => ({ ok: false, statusCode, message });

const findForbiddenKey = (value) => {
    if (Array.isArray(value)) {
        for (const item of value) {
            const hit = findForbiddenKey(item);
            if (hit) return hit;
        }
        return null;
    }
    if (!value || typeof value !== 'object') return null;
    for (const key of Object.keys(value)) {
        if (SERVER_SIDE_EVALUATION.includes(key) || UNSAFE_KEYS.includes(key)) return key;
        const hit = findForbiddenKey(value[key]);
        if (hit) return hit;
    }
    return null;
};

const checkAggregate = (dataObj, rule) => {
    const [pipeline, ...options] = dataObj;
    if (!Array.isArray(pipeline) || options.length) {
        return refuse(400, 'aggregate takes exactly one pipeline array.');
    }
    for (const stage of pipeline) {
        const names = stage && typeof stage === 'object' && !Array.isArray(stage) ? Object.keys(stage) : [];
        if (names.length !== 1 || !rule.stages.includes(names[0])) {
            return refuse(403, `Pipeline stage ${names.join(',') || 'unknown'} is not allowed; allowed stages are ${rule.stages.join(', ')}.`);
        }
    }
    return { ok: true, dataObj: [[...pipeline, { $limit: MAX_RESULTS }]] };
};

const METHOD_CHECKS = deepFreeze({ aggregate: checkAggregate });

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * Decides whether a gateway request may run. `companyId` is the company the session was
 * verified against; a request may only name that company's database or `global`.
 * Returns `{ ok: true, dbName, collection, methodName, dataObj }` or `{ ok: false, statusCode, message }`.
 */
const checkGatewayRequest = (body, { companyId }) => {
    const { dbName, collection, methodName, dataObj } = body || {};
    if (typeof dbName !== 'string' || !dbName) return refuse(400, 'dbName is missing');
    if (typeof collection !== 'string' || !collection) return refuse(400, 'collection is missing');
    if (typeof methodName !== 'string' || !methodName) return refuse(400, 'methodName is missing');
    if (!Array.isArray(dataObj)) return refuse(400, 'dataObj must be an array');

    if (!OBJECT_ID_PATTERN.test(String(companyId || ''))) return refuse(401, 'A company session is required.');
    const bodyCompanyId = body.companyId || body.CompanyId;
    if (bodyCompanyId && String(bodyCompanyId) !== String(companyId)) {
        return refuse(403, 'companyId does not match your session company.');
    }

    let scope;
    if (dbName === dbCollections.GLOBAL) scope = 'global';
    else if (dbName === String(companyId)) scope = 'company';
    else return refuse(403, 'dbName must be your own company database.');

    if (CREDENTIAL_COLLECTIONS.includes(collection)) {
        return refuse(403, `The ${collection} collection holds credentials and is never available here.`);
    }
    if (methodName === 'mapReduce') return refuse(403, 'mapReduce is not allowed.');

    const methods = hasOwn(GATEWAY_ALLOWLIST[scope], collection) ? GATEWAY_ALLOWLIST[scope][collection] : null;
    if (!methods) return refuse(403, `The ${collection} collection is not available in the ${scope} database.`);
    if (!hasOwn(methods, methodName)) return refuse(403, `${methodName} is not allowed on ${collection}.`);

    const forbiddenKey = findForbiddenKey(dataObj);
    if (forbiddenKey) return refuse(403, `The ${forbiddenKey} operator is not allowed.`);

    const checked = METHOD_CHECKS[methodName](dataObj, methods[methodName]);
    if (!checked.ok) return checked;
    return { ok: true, dbName, collection, methodName, dataObj: checked.dataObj };
};

const stripSecrets = (value) => {
    if (Array.isArray(value)) return value.map(stripSecrets);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !SECRET_KEY_PATTERN.test(key))
        .map(([key, child]) => [key, stripSecrets(child)]));
};

const toPlainResult = (result) => (result === undefined ? null : stripSecrets(JSON.parse(JSON.stringify(result))));

module.exports = {
    GATEWAY_ALLOWLIST,
    CREDENTIAL_COLLECTIONS,
    MAX_RESULTS,
    checkGatewayRequest,
    stripSecrets,
    toPlainResult,
};
