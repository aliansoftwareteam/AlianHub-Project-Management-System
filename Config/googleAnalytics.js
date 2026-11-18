const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/;

const SCRIPT_SOURCES = ['https://www.googletagmanager.com'];
const CONNECT_SOURCES = ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com'];

let warned = false;

/* Optional by design: a malformed id switches analytics off with one warning instead of stopping the server. */
const measurementIdOf = (env = process.env) => {
    const value = String(env.GA_MEASUREMENT_ID || '').trim().toUpperCase();
    if (!value) return '';
    if (MEASUREMENT_ID.test(value)) return value;
    if (!warned) {
        warned = true;
        try {
            require('./loggerConfig').warn(`GA_MEASUREMENT_ID is "${value}"; a GA4 id looks like G-XXXXXXXXXX. Google Analytics stays off.`);
        } catch {
            // The logger is unavailable in some scripts; analytics is optional, so say nothing.
        }
    }
    return '';
};

const cspSourcesOf = (env = process.env) => (measurementIdOf(env)
    ? { 'script-src': SCRIPT_SOURCES, 'connect-src': CONNECT_SOURCES }
    : {});

module.exports = { measurementIdOf, cspSourcesOf };
