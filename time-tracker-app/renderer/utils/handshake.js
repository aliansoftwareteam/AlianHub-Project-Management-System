// CommonJS, so the repository's jest run can load it without the Next.js toolchain.

const HANDSHAKE_PATH = '/api/v2/tracker/handshake';
const HANDSHAKE_TIMEOUT_MS = 10000;

const versionParts = (version) => String(version || '').split('-')[0].split('.').map((n) => Number(n) || 0);

const compareVersions = (a, b) => {
  const [x, y] = [versionParts(a), versionParts(b)];
  for (let i = 0; i < 3; i += 1) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  }
  return 0;
};

/* A server without the route, a proxy's error page and an unrelated site all answer something
 * that is not an AlianHub handshake; only no answer at all means the address could not be reached. */
const interpretHandshake = ({ data, error } = {}, appVersion) => {
  if (error && !error.response) return { outcome: 'unreachable' };
  const body = data && typeof data === 'object' ? data.data : null;
  if (error || !body || body.app !== 'alianhub' || !body.tracker) return { outcome: 'notAlianHub' };
  const workspace = { name: String(body.name || ''), logoUrl: String(body.logoUrl || ''), managed: Boolean(body.managed) };
  if (body.tracker.minVersion && appVersion && compareVersions(appVersion, body.tracker.minVersion) < 0) {
    return { outcome: 'tooOld', minVersion: String(body.tracker.minVersion), workspace };
  }
  if (body.tracker.enabled !== true) return { outcome: 'disabled', workspace };
  return { outcome: 'ok', workspace };
};

const runHandshake = async (url, appVersion, get) => {
  try {
    const res = await get(`${url}${HANDSHAKE_PATH}`, { timeout: HANDSHAKE_TIMEOUT_MS });
    return interpretHandshake({ data: res && res.data }, appVersion);
  } catch (error) {
    return interpretHandshake({ error }, appVersion);
  }
};

module.exports = { HANDSHAKE_PATH, compareVersions, interpretHandshake, runHandshake };
