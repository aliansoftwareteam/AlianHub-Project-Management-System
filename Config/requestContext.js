const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

const run = (store, fn) => storage.run(store, fn);
const get = () => storage.getStore() || null;
const requestId = () => (storage.getStore() || {}).id || '';

module.exports = { run, get, requestId };
