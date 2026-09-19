const { AsyncLocalStorage } = require('async_hooks');

/* The workspace an agent fetch belongs to travels here, so the page audit and a
 * skill's gather need not thread a company id through every call to safeFetch. */

const ENV_KEY = 'AGENT_EGRESS_ALLOWLIST';

const storage = new AsyncLocalStorage();

const isOn = () => String(process.env.AGENT_EGRESS_ALLOWLIST || '').trim().toLowerCase() === 'true';

const run = (store, fn) => storage.run(store, fn);
const get = () => storage.getStore() || null;

module.exports = { ENV_KEY, isOn, run, get };
