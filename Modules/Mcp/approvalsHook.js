const path = require('path');

const MODULE_PATH = path.join(__dirname, '..', 'OAuthServer', 'approvals');

/* Only resolving the file itself decides that slice S3's module is absent. Once the file resolves, any
 * error loading it (a missing dependency names this file in its require stack too) is thrown, so the
 * caller refuses rather than reading a broken module as no module. */
const load = (modulePath = MODULE_PATH) => {
    let resolved;
    try {
        resolved = require.resolve(modulePath);
    } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND') return null;
        throw error;
    }
    return require(resolved);
};

module.exports = { MODULE_PATH, load };
