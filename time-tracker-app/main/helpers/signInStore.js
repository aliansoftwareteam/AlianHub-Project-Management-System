// CommonJS, so the repository's jest run can load it without the Electron toolchain.

const nodeCrypto = require('crypto');

const TTL_MS = 10 * 60 * 1000;

/* One browser sign-in at a time, held in the main process so it outlives the window reload that
 * switching to the workspace it signed in to causes. The verifier never leaves here until the
 * window takes the code for the workspace it is now on. */
const createSignInStore = ({ normalise, now = Date.now, ttlMs = TTL_MS, randomBytes = nodeCrypto.randomBytes } = {}) => {
  let pending = null;
  let arrived = null;
  const fresh = (entry) => entry && now() - entry.at < ttlMs;

  const begin = (workspace = null) => {
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(24).toString('base64url');
    pending = { state, verifier, workspace: workspace || null, at: now() };
    arrived = null;
    return { state, challenge: nodeCrypto.createHash('sha256').update(verifier).digest('base64url') };
  };

  /* A link nobody here asked for is someone else's. A link without a state comes from a server
   * older than the finder, and is only taken for a sign-in that already named its workspace. */
  const receive = ({ code, userId, state, workspace } = {}) => {
    const entry = pending;
    if (!fresh(entry) || !code) return false;
    if (state ? state !== entry.state : !entry.workspace) return false;
    let target = entry.workspace;
    if (!target) {
      const normalised = normalise(workspace);
      if (!normalised.ok) return false;
      target = normalised.url;
    }
    pending = null;
    arrived = { code: String(code), userId: String(userId || ''), verifier: entry.verifier, workspace: target, at: now() };
    return true;
  };

  const peek = () => {
    if (!fresh(arrived)) {
      arrived = null;
      return null;
    }
    return { workspace: arrived.workspace };
  };

  const take = (workspace) => {
    if (!fresh(arrived) || arrived.workspace !== workspace) return null;
    const { code, userId, verifier } = arrived;
    arrived = null;
    return { code, userId, verifier };
  };

  const drop = () => {
    arrived = null;
  };

  return { begin, receive, peek, take, drop };
};

const authorizeParams = (link) => {
  const params = new URLSearchParams(String(link || '').split('?').slice(1).join('?'));
  return { code: params.get('code'), userId: params.get('client_id'), state: params.get('state'), workspace: params.get('workspace') };
};

module.exports = { TTL_MS, createSignInStore, authorizeParams };
