const EventEmitter = require('events');

// SOCKET-PERFORMANCE-PLAN #2: emit module-scoped events alongside the
// generic ones so listeners can subscribe selectively.
//
// Before: every `socketEmitter.emit('update', { module: 'task', ... })`
// fan-out woke up all 5 socket handlers (task, chat, comment, companies,
// userNotification) and the notification middleware. Each handler then ran
// the expensive socketRef.rooms.filter() before checking changeData.module
// and exiting early. With many concurrent task updates this dominated CPU.
//
// After: we still emit the legacy event name (keeps any unknown listener
// working), AND we emit `<module>:<event>` (e.g. `task:update`,
// `comments:insert`, `userIdNotification:update`). Socket controllers
// subscribe to the namespaced form so only the relevant handler runs.
class NamespacedEmitter extends EventEmitter {
    emit(eventName, payload, ...rest) {
        const legacy = super.emit(eventName, payload, ...rest);
        if (payload && typeof payload === 'object' && typeof payload.module === 'string') {
            super.emit(`${payload.module}:${eventName}`, payload, ...rest);
        }
        return legacy;
    }
}

const socketEmitter = new NamespacedEmitter();
// Plenty of headroom — we register several listeners per module by design,
// and the default 10-listener warning is misleading here.
socketEmitter.setMaxListeners(50);
module.exports = socketEmitter;
