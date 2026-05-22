/**
 * SOCKET-PERFORMANCE-PLAN Phase 2 — room index regression tests.
 *
 * Covers:
 *   - upsertRoom is idempotent on (roomName) — Fix #7
 *   - findRoomsByPrefix returns exactly the entries with that prefix — Fix #1
 *   - findRoomsByPrefixes dedups across multiple prefixes — Fix #1
 *   - removeRoom cleans both byPrefix and bySocket indexes
 *   - removeBySocket purges every entry for a given socket — Fix #4 (Phase 1)
 *   - prefix extraction handles roomNames with no `**` delimiter
 */

const helper = require('../socket/helper');

// Re-require for each test to get a fresh module-level index. Jest gives
// each `test()` a fresh require cache by default? No — Jest reuses modules
// inside a single test file. So we manually reset the indexes before each
// test.
beforeEach(() => {
    const { byPrefix, bySocket } = helper.__internals;
    byPrefix.clear();
    bySocket.clear();
});

const makeSocket = (id) => ({ id, rooms: new Set() });

test('upsertRoom inserts a new entry', () => {
    const socket = makeSocket('sock1');
    helper.upsertRoom({
        roomName: 'project_sprint_A_B**sock1',
        socketId: 'sock1',
        socket,
        namespace: {},
    });
    expect(helper.getRoomCount()).toBe(1);
    expect(helper.findRoomsByPrefix('project_sprint_A_B')).toHaveLength(1);
});

test('upsertRoom is idempotent on (roomName) — replaces, not duplicates', () => {
    const socket = makeSocket('sock1');
    const entry = {
        roomName: 'taskDetail_X**sock1',
        socketId: 'sock1',
        socket,
        namespace: { name: 'first' },
    };
    helper.upsertRoom(entry);
    helper.upsertRoom({ ...entry, namespace: { name: 'second' } });

    const rooms = helper.findRoomsByPrefix('taskDetail_X');
    expect(rooms).toHaveLength(1);
    expect(rooms[0].namespace.name).toBe('second'); // most recent wins
});

test('findRoomsByPrefix returns only matching prefix entries', () => {
    const socket = makeSocket('sock1');
    helper.upsertRoom({ roomName: 'taskDetail_X**sock1', socketId: 'sock1', socket, namespace: {} });
    helper.upsertRoom({ roomName: 'taskDetail_Y**sock1', socketId: 'sock1', socket, namespace: {} });
    helper.upsertRoom({ roomName: 'project_sprint_A_B**sock1', socketId: 'sock1', socket, namespace: {} });

    expect(helper.findRoomsByPrefix('taskDetail_X')).toHaveLength(1);
    expect(helper.findRoomsByPrefix('taskDetail_Y')).toHaveLength(1);
    expect(helper.findRoomsByPrefix('project_sprint_A_B')).toHaveLength(1);
    expect(helper.findRoomsByPrefix('nonexistent')).toHaveLength(0);
});

test('findRoomsByPrefixes dedups across overlapping lookups', () => {
    const socket = makeSocket('sock1');
    // Same roomName accidentally requested under two prefixes (defensive).
    helper.upsertRoom({ roomName: 'taskDetail_X**sock1', socketId: 'sock1', socket, namespace: {} });
    helper.upsertRoom({ roomName: 'taskDetail_Y**sock1', socketId: 'sock1', socket, namespace: {} });

    const out = helper.findRoomsByPrefixes('taskDetail_X', 'taskDetail_Y', 'taskDetail_X');
    expect(out).toHaveLength(2);
    const names = out.map(r => r.roomName).sort();
    expect(names).toEqual(['taskDetail_X**sock1', 'taskDetail_Y**sock1']);
});

test('removeRoom clears both indexes', () => {
    const socket = makeSocket('sock1');
    helper.upsertRoom({ roomName: 'comments_a_b_c**sock1', socketId: 'sock1', socket, namespace: {} });
    expect(helper.getRoomCount()).toBe(1);

    helper.removeRoom('comments_a_b_c**sock1');
    expect(helper.getRoomCount()).toBe(0);
    expect(helper.findRoomsByPrefix('comments_a_b_c')).toHaveLength(0);

    const { bySocket } = helper.__internals;
    expect(bySocket.has(socket)).toBe(false);
});

test('removeBySocket purges every entry for a socket', () => {
    const sockA = makeSocket('A');
    const sockB = makeSocket('B');
    helper.upsertRoom({ roomName: 'project_sprint_1_2**A', socketId: 'A', socket: sockA, namespace: {} });
    helper.upsertRoom({ roomName: 'taskDetail_X**A',         socketId: 'A', socket: sockA, namespace: {} });
    helper.upsertRoom({ roomName: 'taskDetail_X**B',         socketId: 'B', socket: sockB, namespace: {} });
    expect(helper.getRoomCount()).toBe(3);

    helper.removeBySocket(sockA);
    expect(helper.getRoomCount()).toBe(1);
    expect(helper.findRoomsByPrefix('project_sprint_1_2')).toHaveLength(0);
    expect(helper.findRoomsByPrefix('taskDetail_X')).toHaveLength(1);
    expect(helper.findRoomsByPrefix('taskDetail_X')[0].socketId).toBe('B');
});

test('extractPrefix handles roomNames without `**` delimiter', () => {
    expect(helper.extractPrefix('plain_room')).toBe('plain_room');
    expect(helper.extractPrefix('taskDetail_X**sock1')).toBe('taskDetail_X');
});

test('upsertRoom ignores malformed entries (no crash)', () => {
    helper.upsertRoom(null);
    helper.upsertRoom({});
    helper.upsertRoom({ roomName: 'x' }); // no socket
    expect(helper.getRoomCount()).toBe(0);
});
