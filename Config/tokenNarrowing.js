const { AsyncLocalStorage } = require('async_hooks');

/* A request made with a token narrowed to some projects runs inside that list, so the shared project
 * checks honour it without every caller threading the token through. Only work done as the token's
 * own person is narrowed: a teammate's notification computed in the same request is not. Kept free of
 * dependencies so any of those checks can require it. */

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const storage = new AsyncLocalStorage();

// An empty list is a token that is not narrowed, as the MCP tools read it.
const isNarrowed = (token) => Boolean(token) && Array.isArray(token.projectIds) && token.projectIds.length > 0;

const listOf = (token) => token.projectIds.map((id) => String(id).toLowerCase()).filter((id) => OBJECT_ID.test(id));

const runNarrowed = (token, fn) => (isNarrowed(token)
    ? storage.run({ uid: String(token.userId || ''), projectIds: listOf(token) }, fn)
    : fn());

const narrowingFor = (uid) => {
    const store = storage.getStore();
    return store && store.uid === String(uid || '') ? store.projectIds : null;
};

const allowsProject = (uid, projectId) => {
    const list = narrowingFor(uid);
    return !list || list.includes(String(projectId || '').toLowerCase());
};

module.exports = { isNarrowed, runNarrowed, narrowingFor, allowsProject };
