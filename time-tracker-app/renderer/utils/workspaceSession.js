// CommonJS, so the repository's jest run can load it without the Next.js toolchain.

/* The rest of the app reads the signed-in session from these keys, so each workspace keeps its own
 * copy aside and the one being switched to is put back in their place. */
const SESSION_KEYS = ['token', 'refreshToken', 'userId', 'companyId'];
const keyFor = (url) => `workspaceSession:${url}`;

const stashSession = (storage, url) => {
  if (!url) return;
  const session = Object.fromEntries(SESSION_KEYS.map((key) => [key, storage.getItem(key)]).filter(([, value]) => value !== null));
  if (Object.keys(session).length) storage.setItem(keyFor(url), JSON.stringify(session));
  else storage.removeItem(keyFor(url));
};

const restoreSession = (storage, url) => {
  let session = {};
  try {
    session = JSON.parse(storage.getItem(keyFor(url)) || '{}') || {};
  } catch {
    session = {};
  }
  SESSION_KEYS.forEach((key) => {
    if (typeof session[key] === 'string') storage.setItem(key, session[key]);
    else storage.removeItem(key);
  });
};

const forgetSession = (storage, url) => storage.removeItem(keyFor(url));

module.exports = { SESSION_KEYS, stashSession, restoreSession, forgetSession };
