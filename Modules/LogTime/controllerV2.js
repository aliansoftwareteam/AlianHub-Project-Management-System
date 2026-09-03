// LogTime controller V2 split by concern under ./controllerV2/*.
// Re-exports every handler/util under the same module path so existing
// callers (Modules/LogTime/routes.js, Tasks/helpers/taskMongo/*, etc.)
// keep working unchanged. See issue #164.

module.exports = {
    ...require('./controllerV2/helpers'),
    ...require('./controllerV2/manualLogtime'),
    ...require('./controllerV2/tracker'),
    ...require('./controllerV2/capture'),
    ...require('./controllerV2/timelog'),
    ...require('./controllerV2/webTimer'),
};
