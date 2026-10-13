const { AsyncLocalStorage } = require('async_hooks');

/* The workspace a model call belongs to travels here, so providers that read
 * their key at call time can resolve that workspace's own key without every
 * caller threading a company id. Set by the request middleware for authed
 * requests, by the agent engine for runs, and by queue jobs for their tenant;
 * cron, CLIs and unauthenticated requests run without one and read the
 * instance keys, exactly as before. */

const ENV_KEY = 'TENANT_PROVIDER_KEYS';
const FLAG_ON = ['on', 'true', '1', 'yes'];

const storage = new AsyncLocalStorage();

const flagOn = () => FLAG_ON.includes(String(process.env.TENANT_PROVIDER_KEYS || '').trim().toLowerCase());

const run = (store, fn) => storage.run(store, fn);
const get = () => storage.getStore() || null;

const companyIdOf = (store) => {
    const id = String((store || get() || {}).companyId || '');
    return /^[a-f0-9]{24}$/i.test(id) ? id : null;
};

/* Express middleware form: runs the rest of the request inside the verified tenant. */
const middleware = (req, res, next) => run(
    { companyId: req.uid ? String(req.headers['companyid'] || '') || null : null },
    () => next(),
);

module.exports = { ENV_KEY, flagOn, run, get, companyIdOf, middleware };
