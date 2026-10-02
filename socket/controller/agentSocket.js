const { toCompanyRoom } = require('../roomAccess');
const socketEmitter = require('../../event/socketEventEmitter');

const EVENT = 'agentsChanged';
const APPLIED_CHANGE = 'change';
const REMEMBERED_RUNS = 2000;

const lastStatus = new Map();

/* A working run is patched on every step and every spend. Only a change of status moves what the
 * live surfaces show, and telling every browser of each patch would cost more than the poll it replaces. */
const runMoved = (companyId, run) => {
    if (!run || !run._id) return false;
    const key = `${companyId}:${run._id}`;
    const status = String(run.status || '');
    if (lastStatus.get(key) === status) return false;
    lastStatus.delete(key);
    lastStatus.set(key, status);
    if (lastStatus.size > REMEMBERED_RUNS) lastStatus.delete(lastStatus.keys().next().value);
    return true;
};

const worthTelling = (companyId, data) => {
    if (data.kind === 'run') return runMoved(companyId, data.run);
    if (['proposal', 'claim', 'policy'].includes(data.kind)) return true;
    if (data.kind === 'agent') return Boolean(data.pausedAll || data.deleted || data.paused || data.agent);
    return false;
};

/* What a person's own connected agent applied goes to that person's sockets alone, with the id they read it by. */
const tellThePerson = (companyId, { userId, auditId }) => {
    const person = String(userId || '');
    if (!person || !auditId) return undefined;
    return toCompanyRoom(companyId, (entry) => entry.socket.emit(EVENT, { kind: APPLIED_CHANGE, companyId, auditId: String(auditId) }), (identity) => String(identity.uid) === person);
};

/* Only the fact of a change is sent; each client reads again through the API, which decides what it may see. */
const relay = (change) => {
    const companyId = String((change && change.companyId) || '');
    const data = (change && change.data) || {};
    if (companyId && data.kind === APPLIED_CHANGE) return tellThePerson(companyId, data);
    if (!companyId || !worthTelling(companyId, data)) return undefined;
    return toCompanyRoom(companyId, (entry) => entry.namespace.to(entry.roomName).emit(EVENT, { kind: data.kind }));
};

socketEmitter.on('agent:update', relay);

module.exports = { EVENT, relay, forget: () => lastStatus.clear() };
