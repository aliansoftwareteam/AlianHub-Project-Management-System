// Milestone controller split by concern under ./controller/*.
// Re-exports every handler under the same module path so routes.js and
// any external consumer keep working unchanged. See issue #164.

module.exports = {
    ...require('./controller/helpers'),
    ...require('./controller/crud'),
    ...require('./controller/status'),
    ...require('./controller/query'),
};
