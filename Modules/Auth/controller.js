// Auth controller split by concern under ./controller/*.
// Re-exports every handler under the same module path so routes.js,
// Company/controller.js, CheckInstallStep/createCompany.js, and Auth/controller/createUser.js
// keep working unchanged. See issue #164.

module.exports = {
    ...require('./controller/authHelpers'),
    ...require('./controller/register'),
    ...require('./controller/loginSession'),
    ...require('./controller/password'),
    ...require('./controller/twoFactor'),
    ...require('./controller/magicLink'),
};
