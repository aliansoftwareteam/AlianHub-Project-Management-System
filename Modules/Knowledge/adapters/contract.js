// What every retrieval backend answers to, lexical or vector: a search under the caller's
// filter, and the four writes the indexer and erasure tell it about.

const ADAPTER_METHODS = ['search', 'upsert', 'tombstone', 'erase', 'stats'];

const assertAdapter = (adapter) => {
    const missing = ADAPTER_METHODS.filter((method) => !adapter || typeof adapter[method] !== 'function');
    if (missing.length) throw new Error(`knowledge adapter ${adapter && adapter.name ? adapter.name : '(unnamed)'} is missing ${missing.join(', ')}`);
    return adapter;
};

module.exports = { ADAPTER_METHODS, assertAdapter };
