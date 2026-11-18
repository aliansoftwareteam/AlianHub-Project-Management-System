const hostingMode = require('../../Config/hostingMode');
const routes = require('./routes');

const PUBLIC_CONFIG_KEY = 'instance:public-config';

let listening = false;

/* The login page reads the lifecycle from the public config, which is cached for a minute. */
function followLifecycle() {
    if (listening) return;
    listening = true;
    const socketEmitter = require('../../event/socketEventEmitter');
    const { LIFECYCLE_EVENT } = require('../../socket/controller/instanceSocket');
    socketEmitter.on(`instance:${LIFECYCLE_EVENT}`, () => require('../../Config/config').myCache.del(PUBLIC_CONFIG_KEY));
}

exports.init = (app) => {
    routes.init(app);
    if (hostingMode.isManaged()) followLifecycle();
};
