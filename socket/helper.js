// SOCKET-PERFORMANCE-PLAN Phase 2.
//
// Phase 2 replaces the linear `socketRef.rooms` array (Phase 1 left it
// alone) with a Map-based index keyed by room prefix. Lookups inside
// every event handler go from O(n) substring scans over the whole
// global array to O(1) by-prefix retrieval.
//
// Room-name convention (unchanged from before — every controller already
// builds names this way):
//   `<prefix>**<socketId>`
//
// where `<prefix>` is the part the handler cares about — e.g.
// `project_sprint_<pid>_<sid>`, `taskDetail_<tid>`, `comments_<pid>_<sid>_<tid>`,
// `comments_project_<pid>`, `chat_<pid>_<uid>`, `selected_companies_<id>`,
// `userIdNotification_<uid>`.
//
// Indexes:
//   byPrefix : prefix -> Map<roomName, entry>   (handler lookups, O(1))
//   bySocket : socket -> Set<roomName>           (disconnect cleanup, O(rooms-per-socket))
//
// upsertRoom / removeRoom / removeBySocket keep both structures in sync.
// upsertRoom is idempotent: re-joining the same room replaces the entry
// rather than appending — which solves SOCKET-PERFORMANCE-PLAN #7
// (duplicate entries on tab refresh / reconnect that previously caused
// events to fire multiple times for the same room).

exports.joinRoom = (soket, roomName) => {
    soket.join(roomName);
};

exports.leaveRoom = (soket, roomName) => {
    soket.leave(roomName);
};

const extractPrefix = (roomName) => {
    const idx = roomName.indexOf('**');
    return idx === -1 ? roomName : roomName.slice(0, idx);
};

const byPrefix = new Map();
const bySocket = new Map();

const upsertRoom = (entry) => {
    if (!entry || !entry.roomName || !entry.socket) return;
    const prefix = extractPrefix(entry.roomName);
    let prefixMap = byPrefix.get(prefix);
    if (!prefixMap) {
        prefixMap = new Map();
        byPrefix.set(prefix, prefixMap);
    }
    // Idempotent: if a stale entry under the same roomName exists, replace
    // it so the latest namespace/socket reference wins. Same-key Map.set
    // is the natural dedup primitive.
    prefixMap.set(entry.roomName, entry);

    let socketRooms = bySocket.get(entry.socket);
    if (!socketRooms) {
        socketRooms = new Set();
        bySocket.set(entry.socket, socketRooms);
    }
    socketRooms.add(entry.roomName);
};

const removeRoom = (roomName) => {
    if (!roomName) return;
    const prefix = extractPrefix(roomName);
    const prefixMap = byPrefix.get(prefix);
    if (!prefixMap) return;
    const entry = prefixMap.get(roomName);
    if (!entry) return;
    prefixMap.delete(roomName);
    if (prefixMap.size === 0) {
        byPrefix.delete(prefix);
    }
    const socketRooms = bySocket.get(entry.socket);
    if (socketRooms) {
        socketRooms.delete(roomName);
        if (socketRooms.size === 0) {
            bySocket.delete(entry.socket);
        }
    }
};

const removeBySocket = (socket) => {
    if (!socket) return;
    const socketRooms = bySocket.get(socket);
    if (!socketRooms) return;
    for (const roomName of socketRooms) {
        const prefix = extractPrefix(roomName);
        const prefixMap = byPrefix.get(prefix);
        if (prefixMap) {
            prefixMap.delete(roomName);
            if (prefixMap.size === 0) {
                byPrefix.delete(prefix);
            }
        }
    }
    bySocket.delete(socket);
};

const findRoomsByPrefix = (prefix) => {
    const prefixMap = byPrefix.get(prefix);
    if (!prefixMap) return [];
    return Array.from(prefixMap.values());
};

const findRoomsByPrefixes = (...prefixes) => {
    const seen = new Set();
    const out = [];
    for (const prefix of prefixes) {
        if (!prefix) continue;
        const prefixMap = byPrefix.get(prefix);
        if (!prefixMap) continue;
        for (const [roomName, entry] of prefixMap) {
            if (!seen.has(roomName)) {
                seen.add(roomName);
                out.push(entry);
            }
        }
    }
    return out;
};

exports.upsertRoom = upsertRoom;
exports.removeRoom = removeRoom;
exports.removeBySocket = removeBySocket;
exports.findRoomsByPrefix = findRoomsByPrefix;
exports.findRoomsByPrefixes = findRoomsByPrefixes;
exports.extractPrefix = extractPrefix;

// Snapshot accessor for tests / diagnostics — never mutate the returned
// array, the index lives in the Maps above.
exports.getRoomCount = () => {
    let count = 0;
    for (const prefixMap of byPrefix.values()) count += prefixMap.size;
    return count;
};

// Diagnostic-only internals. Tests can poke at these to assert invariants;
// runtime code should use the named exports above.
exports.__internals = { byPrefix, bySocket };
