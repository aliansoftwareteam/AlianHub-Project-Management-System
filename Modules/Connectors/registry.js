const fs = require('fs');
const path = require('path');
const logger = require('../../Config/loggerConfig');
const { named } = require('../Agents/connectors/flag');
const { validate } = require('./validate');

const LOG = '[connectors]';
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

const createRegistry = ({ dir = PROVIDERS_DIR } = {}) => {
    let cached = null;
    const definitions = () => {
        if (!cached) cached = readDefinitions(dir);
        return cached;
    };

    const list = () => [...definitions().values()];
    const get = (id) => definitions().get(String(id || '')) || null;

    const isOffered = (id, { companyApps = [] } = {}) => !!get(id) && named().includes(id) && (instanceApp(id) || companyApps.includes(id));
    const offered = (options) => list().filter((definition) => isOffered(definition.id, options));

    const scopesFor = (id, products = []) => {
        const definition = get(id);
        if (!definition) throw new Error(`unknown connector provider ${id}`);
        if (!Array.isArray(products)) throw new TypeError(`products for ${id} must be a list of product names`);
        const unknown = products.filter((product) => !Object.prototype.hasOwnProperty.call(definition.products, product));
        if (unknown.length) throw new Error(`${id} has no product ${unknown.join(', ')}`);
        const ticked = Object.keys(definition.products).filter((product) => products.includes(product));
        return [...new Set([...(definition.auth.baseScopes || []), ...ticked.flatMap((product) => definition.products[product])])];
    };

    return { list, get, isOffered, offered, scopesFor };
};

module.exports = { ...createRegistry(), createRegistry };
