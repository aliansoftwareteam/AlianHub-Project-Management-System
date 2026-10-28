const socketEmitter = require('../../event/socketEventEmitter');

const LIFECYCLE_EVENT = 'INSTANCE_LIFECYCLE_CHANGED';
const SUPPORT_EVENT = 'INSTANCE_SUPPORT_ACCESS_CHANGED';

let everyone = null;

/* An instance-wide fact, so every signed-in socket hears it whatever company its namespace names. */
const relay = (event) => (payload) => {
    if (everyone) everyone.emit(event, payload);
};

socketEmitter.on(`instance:${LIFECYCLE_EVENT}`, relay(LIFECYCLE_EVENT));
socketEmitter.on(`instance:${SUPPORT_EVENT}`, relay(SUPPORT_EVENT));

const attach = (parentNamespace) => { everyone = parentNamespace; };

const broadcast = (event, payload) => socketEmitter.emit(`instance:${event}`, payload);

module.exports = { LIFECYCLE_EVENT, SUPPORT_EVENT, attach, broadcast };
