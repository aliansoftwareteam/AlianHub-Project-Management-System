const ENV_KEY = 'CONNECTORS_CUSTOM';
const OFF = ['off', 'false', '0', 'no', 'none'];

const asked = () => !OFF.includes(String(process.env.CONNECTORS_CUSTOM || '').trim().toLowerCase());

/* On unless switched off, and only while the connector module itself runs: a catalog connector named in CONNECTORS
 * (so the member-removal hook and the daily sweep end custom connections too), tokens kept by handle, and a run that
 * read outside content routed to approval. Read on every call, like the module's other switches. */
const on = () => {
    if (!asked()) return false;
    const { named } = require('../Agents/connectors/flag');
    const names = named();
    if (!names.length || !require('./registry').list().some((definition) => names.includes(definition.id))) return false;
    return require('../../Config/secrets').storeConfig().on && require('../Agents/taint').enabled();
};

module.exports = { ENV_KEY, asked, on };
