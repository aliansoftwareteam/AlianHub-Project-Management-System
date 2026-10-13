const helmet = require('helmet');
const contentSecurityPolicy = require('./contentSecurityPolicy');

// helmet's own policy stays off: contentSecurityPolicy.js builds ours from the instance's configuration.
const HELMET_OPTIONS = {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
};

const install = (app, env = process.env) => {
    const policy = contentSecurityPolicy.middleware(env);
    if (env.HELMET_ENABLED !== 'false') app.use(helmet(HELMET_OPTIONS));
    if (policy) app.use(policy);
};

module.exports = { install };
