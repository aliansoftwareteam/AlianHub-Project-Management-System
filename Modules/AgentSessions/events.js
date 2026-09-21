const socketEmitter = require('../../event/socketEventEmitter');
const { publicView } = require('./rules');

const MODULE = 'agentSession';

/* socket/controller/agentSessionSocket.js relays this to the task's detail room, to the people who can open the task. */
const emitSession = (session) => {
    if (!session) return;
    socketEmitter.emit('update', {
        type: 'update',
        module: MODULE,
        companyId: String(session.companyId),
        data: { taskId: String(session.taskId), session: publicView(session) },
        actor: { kind: 'agent' },
        depth: 1,
    });
};

module.exports = { MODULE, emitSession };
