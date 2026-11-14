const fs = require('fs');
const path = require('path');
const logger = require('../../Config/loggerConfig');
const { named } = require('../Agents/connectors/flag');
const { validate } = require('./validate');
const hosted = require('./hostedSignIn');

const LOG = '[connectors]';
const SIGN_IN = Object.freeze({ OAUTH: 'oauth', TOKEN: 'token' });
const PROVIDERS_DIR = path.join(__dirname, 'providers');

const instanceApp = (id) => {
    const prefix = `CONNECTOR_${id.toUpperCase()}_CLIENT_`;
    return !!(String(process.env[`${prefix}ID`] || '').trim() && String(process.env[`${prefix}SECRET`] || '').trim());
};

// A definition is one object shared by every request, so a caller that pushes onto `products.calendar`
// would change the scopes asked for everyone after it.
const deepFreeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
};

const readDefinitions = (dir) => {
    const found = new Map();
    if (!fs.existsSync(dir)) return found;
    fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'index.js')))
        .forEach((entry) => {
            let definition;
            try {
                definition = require(path.join(dir, entry.name, 'index.js'));
            } catch (e) {
                logger.error(`${LOG} provider ${entry.name} skipped: its file failed to load (${e.message})`);
                return;
            }
            const problems = validate(definition);
            if (definition && definition.id !== entry.name) problems.push(`id ${definition.id} does not match its folder ${entry.name}`);
            if (problems.length) {
                logger.error(`${LOG} provider ${entry.name} skipped: ${problems.join('; ')}`);
                return;
            }
            found.set(definition.id, deepFreeze(definition));
        });
    return found;
};

/* Takes the definition itself, so a custom server's (built from its row, not read from providers/) is asked the same way. */
const scopesIn = (definition, products = []) => {
    const { id } = definition;
    if (!Array.isArray(products)) throw new TypeError(`products for ${id} must be a list of product names`);
    const unknown = products.filter((product) => !Object.prototype.hasOwnProperty.call(definition.products, product));
    if (unknown.length) throw new Error(`${id} has no product ${unknown.join(', ')}`);
    const ticked = Object.keys(definition.products).filter((product) => products.includes(product));
    return [...new Set([...(definition.auth.baseScopes || []), ...ticked.flatMap((product) => definition.products[product])])];
};

const createRegistry = ({ dir = PROVIDERS_DIR } = {}) => {
    let cached = null;
    const definitions = () => {
        if (!cached) cached = readDefinitions(dir);
        return cached;
    };

    const list = () => [...definitions().values()];
    const get = (id) => definitions().get(String(id || '')) || null;

    /* How a person can sign in to this provider on this install: through an OAuth app (the company's, the instance's,
     * or one the server registers for itself), or by pasting a token of their own. */
    const signIns = (id, { companyApps = [] } = {}) => {
        const definition = get(id);
        if (!definition) return [];
        const oauth = instanceApp(id) || companyApps.includes(id) || hosted.offers(id) || definition.auth.registration === 'dynamic';
        return [...(oauth ? [SIGN_IN.OAUTH] : []), ...(definition.auth.personalToken === true ? [SIGN_IN.TOKEN] : [])];
    };
    const isOffered = (id, options) => !!get(id) && named().includes(id) && signIns(id, options).length > 0;
    const offered = (options) => list().filter((definition) => isOffered(definition.id, options));
    /* The providers CONNECTORS names; the connector routes exist only while there is one. */
    const switchedOn = () => list().map((definition) => definition.id).filter((id) => named().includes(id));

    const scopesFor = (id, products = []) => {
        const definition = get(id);
        if (!definition) throw new Error(`unknown connector provider ${id}`);
        return scopesIn(definition, products);
    };

    return { list, get, isOffered, offered, switchedOn, scopesFor, scopesIn, signIns, SIGN_IN };
};

module.exports = { ...createRegistry(), createRegistry, scopesIn, SIGN_IN };
