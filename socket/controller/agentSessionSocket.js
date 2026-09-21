const { findRoomsByPrefixes } = require('../helper');
const socketEmitter = require('../../event/socketEventEmitter');
const { verifyCompanyMembership } = require('../../Config/jwt');
const logger = require('../../Config/loggerConfig');

const EVENT = 'taskDetail_agentSession';
const DECISION_TTL_MS = 10 * 1000;
const decisions = new Map();

const cached = (key, now) => {
    const hit = decisions.get(key);
    if (hit && hit.until > now) return hit.allowed;
    decisions.delete(key);
    return undefined;
};

/* joinTaskDetail admits any live session to any task's room, so the relay decides per socket: the user the socket's
 * verified token names must belong to the workspace and be able to open the task. */
const mayReceive = async (companyId, uid, task, now = Date.now()) => {
    if (!uid || !task) return false;
    const key = `${companyId}:${uid}:${task._id}`;
    const hit = cached(key, now);
    if (hit !== undefined) return hit;
    const { canOpenTask } = require('../../Modules/AgentSessions/access');
    const allowed = Boolean(await verifyCompanyMembership(String(uid), String(companyId))) && await canOpenTask(companyId, uid, task);
    decisions.set(key, { allowed, until: now + DECISION_TTL_MS });
    return allowed;
};

const relay = async (change) => {
    const taskId = change && change.data && change.data.taskId;
    if (!taskId || !change.companyId) return 0;
    const rooms = findRoomsByPrefixes(`taskDetail_${taskId}`);
    if (!rooms.length) return 0;
    const { taskOf } = require('../../Modules/AgentSessions/access');
    const task = await taskOf(change.companyId, taskId);
    let sent = 0;
    for (const entry of rooms) {
        if (!entry.socket.rooms.has(entry.roomName)) continue;
        const uid = entry.socket.user && entry.socket.user.uid;
        // eslint-disable-next-line no-await-in-loop
        if (!(await mayReceive(change.companyId, uid, task))) continue;
        // A room name carries the socket id the client sent, so another socket can share it; only this one was checked.
        entry.socket.emit(EVENT, change.data.session);
        sent += 1;
    }
    return sent;
};

const onChange = (change) => relay(change).catch((error) => logger.error(`agent session relay: ${error.message}`));

let registered = false;

const registerWhenOn = (env = process.env) => {
    if (!require('../../Modules/AgentSessions/config').isOn(env)) return false;
    if (!registered) socketEmitter.on('agentSession:update', onChange);
    registered = true;
    return true;
};

module.exports = { EVENT, relay, mayReceive, registerWhenOn, resetDecisions: () => decisions.clear() };
