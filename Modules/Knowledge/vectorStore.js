const { assertAdapter } = require('./adapters/contract');
const { createDatabaseVectorAdapter } = require('./adapters/vector');

// Where vectors are searched and told about writes. The in-database adapter is the default,
// since it needs nothing beyond the tenant database; a hosted store is another adapter of
// the same contract, chosen here once it exists. Tests swap in the in-memory adapter.

let active = null;

const current = () => {
    if (!active) active = createDatabaseVectorAdapter();
    return active;
};

const use = (adapter) => {
    active = assertAdapter(adapter);
    return active;
};

const reset = () => { active = null; };

module.exports = { current, use, reset };
