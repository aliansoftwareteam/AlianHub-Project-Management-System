const apiBase = () => String(process.env.APIURL || '').replace(/\/+$/, '');
const callbackPath = (provider) => `/api/v1/connector-oauth/${provider}/callback`;
const redirectUri = (provider) => `${apiBase()}${callbackPath(provider)}`;

module.exports = { apiBase, callbackPath, redirectUri };
