const apiBase = () => String(process.env.APIURL || '').replace(/\/+$/, '');
const callbackPath = (provider) => `/api/v1/connector-oauth/${provider}/callback`;
/* A hosted instance's app returns to the shared sign-in service, which forwards to this instance's own callback. */
const redirectUri = (provider, app) => (app && app.redirectUri ? app.redirectUri : `${apiBase()}${callbackPath(provider)}`);

module.exports = { apiBase, callbackPath, redirectUri };
