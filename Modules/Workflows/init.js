const routes = require('./routes');

// The routes are registered whatever the flag says; every handler answers 503
// while WORKFLOW_ENGINE is off, so a client gets "not running" rather than the
// 404 of a path that does not exist.
exports.init = (app) => {
    routes.init(app);
};
