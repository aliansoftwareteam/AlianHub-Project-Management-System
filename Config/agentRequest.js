const { AsyncLocalStorage } = require('async_hooks');

/* A request an agent makes for a person runs inside this mark, so the shared chat checks hold the agent to its own
 * rule without every caller threading the request through: a direct message is never an agent's to read or write,
 * and a channel only when its token was given chat by name. Only work done as that person is held: a teammate's
 * notice worked out in the same request is not. Kept free of dependencies so any of those checks can require it. */

const storage = new AsyncLocalStorage();

const runForAgentOf = (uid, { chat }, fn) => storage.run({ uid: String(uid || ''), chat: chat === true }, fn);

const agentOf = (uid) => {
    const store = storage.getStore();
    return store && store.uid === String(uid || '') ? store : null;
};

/* The person's own rule asked from inside their agent's request: whether they may still open a thing. It answers
 * yes or no for a check; nothing the agent is kept from is read for it this way. */
const asThePerson = (fn) => storage.exit(fn);

module.exports = { runForAgentOf, agentOf, asThePerson };
