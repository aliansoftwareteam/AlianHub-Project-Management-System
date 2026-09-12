const { Server } = require('socket.io');
const {taskSocketHandler} = require('./controller/taskSocket');
const {chatSocketHandler} = require('./controller/chatSocket');
const {commentSocketHandler} = require('./controller/commentSocket');
const {companiesSocketHandler} = require('./controller/companiesSocket');
const {userNotificationCountHandler} = require('./controller/userNotificationCount');
const {generalReminderSocketHandler} = require('./controller/generalReminderSocket');
const {callSocketHandler} = require('./controller/callSocket');
const { instrument } = require('@socket.io/admin-ui');
const jwt = require('jsonwebtoken');
const { resolveAccessSession } = require('../Config/jwt');
const logger = require('../Config/loggerConfig');
const { corsOriginDelegate } = require('../utils/cors.js');
const { removeRoom, removeBySocket } = require('./helper');
exports.changeStreams = [];
const EventEmitter = require('events');
exports.emitter = new EventEmitter();
// SOCKET-PERFORMANCE-PLAN #1 (Phase 2): the linear `exports.rooms = []`
// global array has been replaced by the Map-based index in socket/helper.js.
// Every controller now goes through upsertRoom / removeRoom / findRoomsByPrefix.
// The index is accessed via the helper module — there's no global array to
// scan anymore.

/**
 * Build the @socket.io/admin-ui config from env (BUG-004 / #58 fix).
 *
 * The previous code hardcoded `username: "alian"` and a committed bcrypt
 * hash with `mode: "development"` — anyone with the repo could compute the
 * hash offline (or read it from the source) and reach the admin namespace.
 *
 * New behaviour:
 *   - Both SOCKETIO_ADMIN_USERNAME and SOCKETIO_ADMIN_PASSWORD_HASH must be
 *     set, non-empty, and non-whitespace. Otherwise the admin UI is
 *     disabled entirely (default-off).
 *   - `mode` follows NODE_ENV — "production" enables TLS-only protection
 *     on the admin namespace.
 *
 * Exported for the regression test at .claude/tests/test-bug-004.js.
 */
exports.getAdminUiConfig = (env = process.env) => {
    const username = typeof env.SOCKETIO_ADMIN_USERNAME === 'string'
        ? env.SOCKETIO_ADMIN_USERNAME.trim() : '';
    const passwordHash = typeof env.SOCKETIO_ADMIN_PASSWORD_HASH === 'string'
        ? env.SOCKETIO_ADMIN_PASSWORD_HASH.trim() : '';
    if (!username || !passwordHash) return null;
    return {
        auth: { type: 'basic', username, password: passwordHash },
        namespaceName: '/admin',
        mode: env.NODE_ENV === 'production' ? 'production' : 'development',
    };
};

/**
 * The session behind a socket's access token.
 *
 * A socket used to be judged on the token signature alone, so a tab that had logged out —
 * or whose token had since expired — kept receiving every event it was subscribed to. The
 * session is resolved through the same `resolveAccessSession` the HTTP middleware uses, so
 * a logout that deletes the session row and drops its cache entry ends the socket too.
 *
 * Cost: a cache hit for the life of the cached session (10 minutes, the HTTP TTL), one
 * Mongo read after that — not a read per event. Logging out deletes the cache entry, so
 * the very next event from that socket reaches Mongo, finds nothing and closes it.
 */
const sessionOf = async (payload) => {
    if (!payload) return { ok: false };
    if (Number.isFinite(payload.exp) && payload.exp * 1000 <= Date.now()) return { ok: false };
    try {
        return await resolveAccessSession(payload);
    } catch (error) {
        logger.error(`Socket session lookup error ${error.message || error}`);
        return { ok: false };
    }
};

exports.initSocket = (server) => {

    let io = new Server(server, {
        // CORS — BUG-003 / #57. Replace `origin: '*'` (which combined with
        // `credentials: true` let any origin open an authenticated websocket
        // as the logged-in user) with the same env-driven allow-list used by
        // the Express HTTP layer (see utils/cors.js).
        cors: {
            origin: corsOriginDelegate,
            methods: ['GET', 'POST'],
            credentials: true,
        },
    });
    const userNamespace = io.of(/^\/userid_\w+$/);
    userNamespace.use(async (socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) {
            return next(new Error('Authentication error: Token not provided'));
        }
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            return next(new Error('Authentication error: Invalid token'));
        }
        const session = await sessionOf(decoded);
        if (!session.ok) {
            return next(new Error('Authentication error: Session has ended'));
        }
        socket.user = decoded;
        next();
    });
    const adminUiConfig = exports.getAdminUiConfig();
    if (adminUiConfig) {
        instrument(io, adminUiConfig);
        logger.info(`Socket.io admin UI enabled at /admin (mode=${adminUiConfig.mode})`);
    } else {
        logger.info('Socket.io admin UI disabled — set SOCKETIO_ADMIN_USERNAME and SOCKETIO_ADMIN_PASSWORD_HASH to enable.');
    }

    userNamespace.on('connection', (socket) => {
        const {userRole} = socket.handshake.query;
        socket.customData = {userRole};
        const namespace = socket.nsp;

        // A handshake only proves the session was live when the socket opened. Every event
        // re-checks it, so a socket whose session has since ended is closed on its next one.
        socket.use((_event, next) => {
            sessionOf(socket.user).then((session) => {
                if (session.ok) {
                    next();
                    return;
                }
                next(new Error('Session has ended'));
                socket.disconnect(true);
            });
        });

        // SOCKET-PERFORMANCE-PLAN #4 (Phase 1) + #1 (Phase 2): auto-purge
        // every entry for this socket from the room index when the socket
        // disconnects. `removeBySocket` uses the bySocket reverse index
        // (Set<roomName>) so cleanup is O(rooms-per-socket), not O(n) over
        // the whole index.
        socket.on('disconnect', () => {
            removeBySocket(socket);
        });

        // SOCKET-PERFORMANCE-PLAN #1 (Phase 2): explicit client-driven
        // namespace disconnect. Behaviourally identical to the original
        // recursive `countFunction` — for every room in this adapter whose
        // name encodes the target socket id, remove the index entry. Then
        // forcibly close the target socket. The recursion in the previous
        // version was synchronous busy-work; a plain forEach over
        // `adapter.rooms` is equivalent and easier to follow.
        socket.on('disconnectNameSpace', (id) => {
            socket.adapter.rooms.forEach((_, roomName) => {
                if (roomName.includes(id)) {
                    removeRoom(roomName);
                }
            });
            namespace.sockets.get(id)?.disconnect(true);
        });

        socket.on('getRoomList', (socketId, callback) => {
            let roomsArray = [];
            socket.adapter.rooms.forEach((_, roomName) => {
                if (roomName.includes("**") && roomName.includes(socketId)) {
                    roomsArray.push(roomName)
                }
            })
            callback(roomsArray);
        });
        taskSocketHandler({socket, namespace});
        chatSocketHandler({socket, namespace});
        userNotificationCountHandler({socket, namespace});
        generalReminderSocketHandler({socket, namespace});
        commentSocketHandler({socket, namespace});
        companiesSocketHandler({socket, namespace});
        callSocketHandler({socket, namespace});
    });
    
};

