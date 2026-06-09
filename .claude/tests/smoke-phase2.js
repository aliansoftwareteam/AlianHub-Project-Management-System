/**
 * Phase 2 end-to-end smoke test (run via `node .claude/tests/smoke-phase2.js`).
 *
 * Sets up a fake socket subscribed to a sprint room, emits a task:update
 * via the real emitter, and asserts the handler routes through the new
 * Map-based index and calls namespace.to(roomName).emit(...) exactly once.
 *
 * Why this isn't a Jest test: the controllers register listeners on
 * import (module side-effects). Jest's per-file module isolation would
 * make this test deterministic, but it would also reset the listeners
 * between tests in unhelpful ways. Easier to run as a one-shot smoke.
 */

const assert = require('assert');
const socketEmitter = require('../../event/socketEventEmitter');
const helper = require('../../socket/helper');

// Importing the controller registers its `task:update` listener against
// the emitter. Same for the others — chat subscribes to `task:update`
// too, so its listener will also see the event but bail because
// `mainChat !== true`.
require('../../socket/controller/taskSocket');
require('../../socket/controller/chatSocket');
require('../../socket/controller/commentSocket');
require('../../socket/controller/companiesSocket');
require('../../socket/controller/userNotificationCount');

let emitCount = 0;
let lastEmit = null;

const fakeSocket = {
    id: 'sock-1',
    rooms: new Set(['project_sprint_PROJ_SPR**sock-1']),
};
const fakeNamespace = {
    name: '/userid_user1',
    to(roomName) {
        return {
            emit(eventName, payload) {
                emitCount += 1;
                lastEmit = { roomName, eventName, payload };
            },
        };
    },
};

helper.upsertRoom({
    roomName: 'project_sprint_PROJ_SPR**sock-1',
    socketId: 'sock-1',
    socket: fakeSocket,
    namespace: fakeNamespace,
});

socketEmitter.emit('update', {
    type: 'update',
    module: 'task',
    data: {
        _id: 'task-1',
        ProjectID: 'PROJ',
        sprintId: 'SPR',
        AssigneeUserId: [],
        mainChat: false,
    },
    updatedFields: { TaskName: 'changed' },
});

assert.strictEqual(emitCount, 1, `expected exactly 1 emit, got ${emitCount}`);
assert.strictEqual(lastEmit.roomName, 'project_sprint_PROJ_SPR**sock-1');
assert.strictEqual(lastEmit.eventName, 'taskUpdate');
assert.deepStrictEqual(lastEmit.payload.updatedFields, { TaskName: 'changed' });

// Now test that an irrelevant module event doesn't trigger the task handler.
emitCount = 0;
socketEmitter.emit('update', {
    type: 'update',
    module: 'companies',
    data: { data: { _id: 'doesnt-matter' } },
});
assert.strictEqual(emitCount, 0, `task handler must ignore companies events, got ${emitCount} emits`);

// Disconnect cleanup.
helper.removeBySocket(fakeSocket);
assert.strictEqual(helper.getRoomCount(), 0, 'removeBySocket should empty the index');

emitCount = 0;
socketEmitter.emit('update', {
    type: 'update',
    module: 'task',
    data: { _id: 'task-1', ProjectID: 'PROJ', sprintId: 'SPR', AssigneeUserId: [], mainChat: false },
});
assert.strictEqual(emitCount, 0, 'no emit after socket disconnected');

console.log('Phase 2 smoke test: OK');
process.exit(0);
