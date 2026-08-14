const crypto = require('crypto');
const {
    joinRoom,
    leaveRoom,
    upsertRoom,
    removeRoom,
    findRoomsByPrefix,
} = require('../helper');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');

/**
 * Call signalling for main chat (AHE-3839).
 *
 * WebRTC needs two peers to exchange an offer, an answer and a trickle of ICE candidates
 * before media can flow. This carries those messages and nothing else — no audio or video
 * ever passes through the server. That is the whole point of the peer-to-peer approach:
 * a self-hoster's media never leaves the two browsers.
 *
 * ── Reaching a person, not a socket ────────────────────────────────────────────────
 * Every client joins `call_<companyId>_<userId>**<socketId>` on connect, so one person
 * with three tabs open has three entries under the same prefix. Ringing looks the prefix
 * up and rings all of them; the first to answer wins and the rest are told to stop. Any
 * other design leaves a call answered on the laptop still ringing on the phone.
 *
 * ── Identity ───────────────────────────────────────────────────────────────────────
 * The caller is ALWAYS `socket.user.uid` from the verified JWT, and the callee is ALWAYS
 * derived from the conversation's own participant list. Neither is ever read from the
 * payload. A caller-supplied callee id would let anyone ring anyone in the company, and a
 * caller-supplied caller id would let them do it wearing somebody else's name. This is
 * the same rule the HTTP side already follows (see Modules/MainChats — AHE-3834).
 *
 * ── State ──────────────────────────────────────────────────────────────────────────
 * Calls live in memory for their lifetime, which is right for a signalling handshake
 * measured in seconds. NOTE: that makes this single-node. Behind more than one Node
 * process, two participants may land on different instances and never find each other —
 * see the ops note at the bottom of the calling plan.
 */

const RING_TIMEOUT_MS = 45000;   // unanswered after this = missed
const MEDIA = new Set(['audio', 'video']);

// callId -> { callId, companyId, chatId, media, from, to, state, startedAt, answeredAt,
//             timer, callerSocketId, calleeSocketId }
const calls = new Map();
// A person can only be in one call at a time; this keeps ring collisions honest.
const activeByUser = new Map();  // `${companyId}:${userId}` -> callId

const callRoomPrefix = (companyId, userId) => `call_${companyId}_${userId}`;
const userKey = (companyId, userId) => `${companyId}:${userId}`;

/**
 * The company this socket is really allowed to act in.
 *
 * The namespace name is chosen by the client (`/userid_<companyId>_<userId>`), so it is a
 * request, not a fact. The JWT's audience is the fact — it lists the companies the token
 * was actually issued for. Cross-checking the two is what stops a logged-in user from
 * connecting to another tenant's namespace and ringing its members.
 */
const resolveCompanyId = (socket) => {
    const match = /^\/userid_([^_]+)_/.exec(socket.nsp && socket.nsp.name ? socket.nsp.name : '');
    if (!match) return '';
    const claimed = match[1];
    const aud = socket.user && socket.user.aud;
    const allowed = Array.isArray(aud) ? aud.map(String) : String(aud || '').split(',');
    return allowed.some((c) => c.trim() === claimed) ? claimed : '';
};

const emitToUser = (companyId, userId, event, payload) => {
    const rooms = findRoomsByPrefix(callRoomPrefix(companyId, userId));
    rooms.forEach((entry) => {
        entry.namespace.to(entry.roomName).emit(event, payload);
    });
    return rooms.length;
};

const emitToSocketOwner = (socket, event, payload) => socket.emit(event, payload);

const clearCall = (call) => {
    if (!call) return;
    if (call.timer) clearTimeout(call.timer);
    calls.delete(call.callId);
    activeByUser.delete(userKey(call.companyId, call.from));
    activeByUser.delete(userKey(call.companyId, call.to));
};

/**
 * Resolve the conversation and the person on the other end of it.
 *
 * The lookup itself is the authorisation: the filter demands that the CALLER is one of the
 * conversation's assignees, so a chat they are not part of simply does not come back. The
 * callee is then whichever assignee is not the caller — never a value from the payload.
 */
const resolvePeer = async (companyId, callerUid, chatId) => {
    const chat = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{
            _id: chatId,
            mainChat: true,
            AssigneeUserId: callerUid,
            deletedStatusKey: 0,
        }, { _id: 1, AssigneeUserId: 1, ProjectID: 1, sprintId: 1 }],
    }, 'findOne').catch((e) => {
        logger.error(`callSocket chat lookup failed: ${e && e.message ? e.message : e}`);
        return null;
    });
    if (!chat) return null;
    const parties = (Array.isArray(chat.AssigneeUserId) ? chat.AssigneeUserId : [])
        .map(String).filter(Boolean);
    const peer = parties.find((p) => p !== String(callerUid));
    // A conversation with only one distinct party is a note to self, not a call.
    if (!peer) return null;
    return { peer, projectId: String(chat.ProjectID || ''), sprintId: String(chat.sprintId || '') };
};

/**
 * Leave a line in the conversation so the call shows up where people look for history.
 *
 * Written by the server, once, when the call ends — not by whichever client hung up. The
 * client that ends a call is often the one whose tab just closed, and two clients writing
 * it would put the same line in the chat twice.
 *
 * Sent as an ordinary text message on purpose: the chat already renders those, so call
 * history appears with no client change. A dedicated `call` message type would look
 * better and is the natural follow-up.
 */
const postCallMessage = async (call, text) => {
    if (!call.projectId || !call.chatId) return;
    await MongoDbCrudOpration(call.companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: {
            message: text,
            userId: call.from,
            type: 'text',
            projectId: call.projectId,
            project: false,
            taskId: call.chatId,
            sprintId: call.sprintId,
            mediaURL: '', mediaName: '', mediaSize: 0,
            isDeleted: false, hasReply: false, mentionIds: [],
            replyMessageId: '', reply_id: '', reply_message: '', reply_type: '',
            reply_mediaName: '', reply_mediaURL: '', reply_mediaSize: 0,
            reply_mediaOriginalName: '', reply_createdAt: 0, reply_userId: '',
            createdAt: new Date(), updatedAt: new Date(),
        },
    }, 'save').catch((e) => {
        // History is a nicety; never let it take the call down with it.
        logger.error(`callSocket history write failed: ${e && e.message ? e.message : e}`);
    });
};

const durationText = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m ? `${m}m ${s}s` : `${s}s`;
};

const endCall = (call, reason, endedByUid) => {
    if (!call || call.state === 'ended') return;
    const durationSec = call.answeredAt ? Math.round((Date.now() - call.answeredAt) / 1000) : 0;
    call.state = 'ended';
    const payload = { callId: call.callId, reason, durationSec, endedBy: endedByUid || null };
    emitToUser(call.companyId, call.from, 'call:ended', payload);
    emitToUser(call.companyId, call.to, 'call:ended', payload);
    const label = call.media === 'video' ? 'Video call' : 'Call';
    postCallMessage(call, `${label} · ${durationText(durationSec)}`);
    clearCall(call);
};

/** The party on the other side of a call from `uid`, or '' if uid is not in it. */
const otherParty = (call, uid) => {
    if (String(call.from) === String(uid)) return call.to;
    if (String(call.to) === String(uid)) return call.from;
    return '';
};

exports.callSocketHandler = ({ socket, namespace }) => {
    const uid = String((socket.user && socket.user.uid) || '');
    const companyId = resolveCompanyId(socket);

    // No verified identity or a namespace this token has no claim to: register nothing.
    // The handler stays inert rather than half-wired.
    if (!uid || !companyId) return;

    const myPrefix = callRoomPrefix(companyId, uid);
    const roomName = `${myPrefix}**${socket.id}`;
    joinRoom(socket, roomName);
    upsertRoom({ roomName, socketId: socket.id, namespace, socket });

    /** Start a call: authorise, register, ring every device the callee has open. */
    socket.on('call:invite', async ({ chatId, media } = {}) => {
        try {
            const kind = MEDIA.has(media) ? media : 'audio';
            if (!chatId) return emitToSocketOwner(socket, 'call:error', { code: 'BAD_REQUEST', message: 'chatId is required.' });

            if (activeByUser.has(userKey(companyId, uid))) {
                return emitToSocketOwner(socket, 'call:error', { code: 'BUSY_SELF', message: 'You are already on a call.' });
            }

            const resolved = await resolvePeer(companyId, uid, chatId);
            if (!resolved) {
                // Same answer whether the chat does not exist or the caller is not in it —
                // telling them apart would confirm which conversations exist.
                return emitToSocketOwner(socket, 'call:error', { code: 'NOT_ALLOWED', message: 'Conversation not available.' });
            }
            const { peer, projectId, sprintId } = resolved;

            if (activeByUser.has(userKey(companyId, peer))) {
                return emitToSocketOwner(socket, 'call:error', { code: 'BUSY_PEER', message: 'They are already on a call.' });
            }

            const callId = crypto.randomUUID();
            const call = {
                callId,
                companyId,
                chatId: String(chatId),
                projectId,
                sprintId,
                media: kind,
                from: uid,
                to: peer,
                state: 'ringing',
                startedAt: Date.now(),
                answeredAt: null,
                callerSocketId: socket.id,
                calleeSocketId: null,
                timer: null,
            };
            calls.set(callId, call);
            activeByUser.set(userKey(companyId, uid), callId);
            activeByUser.set(userKey(companyId, peer), callId);

            const reached = emitToUser(companyId, peer, 'call:incoming', {
                callId, chatId: call.chatId, media: kind, from: uid,
            });

            if (!reached) {
                // Nobody home. Fail immediately rather than ringing out for 45 seconds.
                emitToSocketOwner(socket, 'call:unavailable', { callId, reason: 'offline' });
                clearCall(call);
                return;
            }

            // `to` so the caller can show who they are ringing. They cannot be told this
            // from their own side: the client only knows the conversation, and the peer is
            // resolved here.
            emitToSocketOwner(socket, 'call:ringing', { callId, devices: reached, to: peer });
            call.timer = setTimeout(() => {
                const live = calls.get(callId);
                if (!live || live.state !== 'ringing') return;
                emitToUser(companyId, peer, 'call:cancelled', { callId, reason: 'timeout' });
                emitToUser(companyId, uid, 'call:missed', { callId, chatId: call.chatId });
                postCallMessage(live, 'Missed call');
                clearCall(live);
            }, RING_TIMEOUT_MS);
        } catch (error) {
            logger.error(`call:invite failed: ${error && error.message ? error.message : error}`);
            emitToSocketOwner(socket, 'call:error', { code: 'SERVER_ERROR', message: 'Could not start the call.' });
        }
    });

    /** Answer. First device to get here wins; the rest are told to stop ringing. */
    socket.on('call:accept', ({ callId } = {}) => {
        const call = calls.get(callId);
        if (!call || String(call.to) !== uid) return;
        if (call.state !== 'ringing') return;   // already answered, cancelled or timed out

        call.state = 'active';
        call.answeredAt = Date.now();
        call.calleeSocketId = socket.id;
        if (call.timer) { clearTimeout(call.timer); call.timer = null; }

        // Silence this person's other devices before anything else.
        findRoomsByPrefix(callRoomPrefix(companyId, uid)).forEach((entry) => {
            if (entry.socketId === socket.id) return;
            entry.namespace.to(entry.roomName).emit('call:takenElsewhere', { callId });
        });

        emitToUser(companyId, call.from, 'call:accepted', { callId, by: uid });
        emitToSocketOwner(socket, 'call:accepted', { callId, by: uid });
    });

    socket.on('call:reject', ({ callId, reason } = {}) => {
        const call = calls.get(callId);
        if (!call || String(call.to) !== uid || call.state !== 'ringing') return;
        findRoomsByPrefix(callRoomPrefix(companyId, uid)).forEach((entry) => {
            if (entry.socketId === socket.id) return;
            entry.namespace.to(entry.roomName).emit('call:takenElsewhere', { callId });
        });
        emitToUser(companyId, call.from, 'call:rejected', { callId, reason: reason || 'declined' });
        clearCall(call);
    });

    /** Caller gives up before it was answered. */
    socket.on('call:cancel', ({ callId } = {}) => {
        const call = calls.get(callId);
        if (!call || String(call.from) !== uid || call.state !== 'ringing') return;
        emitToUser(companyId, call.to, 'call:cancelled', { callId, reason: 'cancelled' });
        clearCall(call);
    });

    /** Either party hangs up a connected call. */
    socket.on('call:end', ({ callId } = {}) => {
        const call = calls.get(callId);
        if (!call || !otherParty(call, uid)) return;
        endCall(call, 'hangup', uid);
    });

    /**
     * Relay one signalling message to the other party.
     *
     * The sender must be in this call, and the destination is derived from the call rather
     * than from the message — otherwise this becomes an open relay for pushing arbitrary
     * payloads at any user in the company.
     */
    socket.on('call:signal', ({ callId, kind, payload } = {}) => {
        const call = calls.get(callId);
        if (!call) return;
        const peer = otherParty(call, uid);
        if (!peer) return;
        // 'state' carries mic/camera on-off. It has to travel out-of-band because a
        // disabled track keeps sending — black frames and silence — so the far side
        // cannot tell "camera off" from "dark room" by looking at the media alone.
        if (!['offer', 'answer', 'ice', 'state'].includes(kind)) return;
        emitToUser(companyId, peer, 'call:signal', { callId, kind, payload, from: uid });
    });

    /**
     * A dropped socket ends the call it was in — but only if this was the device actually
     * on the call. Closing a second tab must not hang up a call running in the first.
     */
    socket.on('disconnect', () => {
        removeRoom(roomName);
        leaveRoom(socket, roomName);

        const callId = activeByUser.get(userKey(companyId, uid));
        if (!callId) return;
        const call = calls.get(callId);
        if (!call) return;

        if (call.state === 'ringing') {
            if (String(call.from) === uid && call.callerSocketId === socket.id) {
                emitToUser(companyId, call.to, 'call:cancelled', { callId, reason: 'caller_disconnected' });
                clearCall(call);
            }
            // A ringing callee's tab closing is not an answer — their other devices keep
            // ringing, and the timeout still governs.
            return;
        }

        const onThisDevice = (String(call.from) === uid && call.callerSocketId === socket.id)
            || (String(call.to) === uid && call.calleeSocketId === socket.id);
        if (onThisDevice) endCall(call, 'disconnected', uid);
    });
};

// Exposed for tests and diagnostics — never mutate these from outside.
exports.__internals = { calls, activeByUser, resolveCompanyId, callRoomPrefix };
