const ID = /^[a-z][a-z0-9_]{0,39}$/;
const URL_KEYS = Object.freeze(['authorizeUrl', 'tokenUrl', 'revokeUrl']);
const CREDENTIAL_KEYS = Object.freeze(['clientId', 'clientSecret', 'client_id', 'client_secret']);
const PKCE = Object.freeze(['S256']);

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const isTextList = (value) => Array.isArray(value) && value.length > 0 && value.every(isText);

const hostOf = (url) => {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' ? parsed.hostname : null;
    } catch (e) {
        return null;
    }
};

const authProblems = (auth, hosts) => {
    if (!isPlainObject(auth)) return ['auth is missing'];
    const problems = [];
    URL_KEYS.forEach((key) => {
        if (key === 'revokeUrl' && auth[key] === undefined) return;
        const host = hostOf(auth[key]);
        if (!host) problems.push(`auth.${key} is not an https URL`);
        else if (!hosts.includes(host)) problems.push(`auth.${key} host ${host} is not in egressHosts`);
    });
    if (auth.pkce != null && !PKCE.includes(auth.pkce)) problems.push('auth.pkce must be S256 or empty');
    if (auth.extraParams !== undefined && !(isPlainObject(auth.extraParams) && Object.values(auth.extraParams).every((v) => typeof v === 'string'))) {
        problems.push('auth.extraParams must map names to strings');
    }
    if (auth.baseScopes !== undefined && !(Array.isArray(auth.baseScopes) && auth.baseScopes.every(isText))) problems.push('auth.baseScopes must be a list of scopes');
    CREDENTIAL_KEYS.filter((key) => auth[key] !== undefined).forEach((key) => problems.push(`auth.${key} must not be in the definition`));
    return problems;
};

const productProblems = (products) => {
    if (!isPlainObject(products) || !Object.keys(products).length) return ['products is empty'];
    return Object.entries(products)
        .filter(([name, scopes]) => !ID.test(name) || !isTextList(scopes))
        .map(([name]) => `product ${name} needs a lower-case name and at least one scope`);
};

/* Returns every problem, so one startup log line can name them all. */
const validate = (definition) => {
    if (!isPlainObject(definition)) return ['the file does not export an object'];
    const hosts = isTextList(definition.egressHosts) ? definition.egressHosts : [];
    const problems = [];
    if (!ID.test(String(definition.id || ''))) problems.push('id must be lower-case letters, digits and _');
    if (!isText(definition.name)) problems.push('name is missing');
    if (!hosts.length) problems.push('egressHosts is empty');
    problems.push(...authProblems(definition.auth, hosts));
    problems.push(...productProblems(definition.products));
    if (typeof definition.readAccount !== 'function') problems.push('readAccount is not a function');
    if (definition.rateLimit !== undefined && !(isPlainObject(definition.rateLimit) && Array.isArray(definition.rateLimit.statuses) && definition.rateLimit.statuses.every(Number.isInteger))) {
        problems.push('rateLimit.statuses must be a list of HTTP statuses');
    }
    if (definition.deadGrantErrors !== undefined && !(Array.isArray(definition.deadGrantErrors) && definition.deadGrantErrors.every(isText))) {
        problems.push('deadGrantErrors must be a list of error codes');
    }
    return problems;
};

module.exports = { validate };
