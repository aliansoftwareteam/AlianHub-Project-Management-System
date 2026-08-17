/**
 * Main Chat — conversation engine.
 *
 * The Main Chat module owns its own UI (see the components in this folder), but
 * NOT its own business logic: message baking, persistence and storage upload are
 * imported from the existing comment helpers, so chat and task comments keep
 * writing exactly the same documents through exactly the same endpoints. Nothing
 * in views/Projects/Comments is modified.
 *
 * What lives here is only the orchestration the chat surface needs:
 *   - paginated history load (oldest-first list, newest at the bottom)
 *   - socket room join/leave + live insert/update
 *   - optimistic send (text and files) with a pending -> sent -> failed lifecycle
 *   - delete
 *
 * Conversation shape, mirroring the existing behaviour exactly:
 *   one-to-one  -> default chat project, taskId = the DM task id, sprintId = its sprint
 *   channel     -> normal chat project, taskId = "default",     sprintId = the channel id
 */
import { ref, computed } from 'vue';
import * as env from '@/config/env';
import { apiRequest } from '@/services';
import { generateFileName } from '@/utils/storageQueryBuild.js';
import taskClass from '@/utils/TaskOperations';
import {
    bakeMessage,
    sendMessage as persistMessage,
    uploadToWasabi,
    deleteFromWasabi,
    checkFile,
    renderFiles,
} from '@/views/Projects/Comments/helper';

const BATCH = 25;

// Typing presence. HEARTBEAT throttles what we send; IDLE decides when we say we have
// stopped; EXPIRY is the receiver's own safety net, so a "typing…" cannot stick if the
// sender's tab closes mid-sentence. EXPIRY must exceed HEARTBEAT or a steady typist
// would flicker.
const TYPING_HEARTBEAT = 2000;
const TYPING_IDLE = 2500;
const TYPING_EXPIRY = 5000;

/** Same escaping the comment composer applies, so stored text matches. */
function escapeMessage(text = '') {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function idOf(msg = {}) {
    return msg._id ? String(msg._id) : (msg.id ? String(msg.id) : '');
}

export function useMainChatConversation(options) {
    const {
        socket,
        companyId,
        userId,
        // () => ({ projectId, sprintId, taskId, folderId, isDefaultProject })
        target,
        // () => [userId, ...] — conversation participants who should be notified
        participants = () => [],
        // () => ({ [userId]: 'all_activity' | 'ignore' }) — project watcher prefs
        watcherPrefs = () => ({}),
        // () => ({ id, Employee_Name, companyOwnerId }) — the sender
        currentUser = () => ({}),
    } = options;

    const messages = ref([]);
    const loading = ref(false);
    const loadingOlder = ref(false);
    const hasMore = ref(true);
    const totalLoaded = ref(0);

    let joinedRoom = '';
    // Our own 'connect' handler, kept so detach() can remove exactly it.
    let rejoinRoom = null;

    // userId -> timestamp of their most recent "typing" signal.
    const typingUsers = ref({});
    let typingSentAt = 0;
    let typingIdleTimer = null;
    let typingSweeper = null;
    let tempSeq = 0;

    const ctx = computed(() => target() || {});

    /* ------------------------------------------------------------------ *
     * identity helpers
     * ------------------------------------------------------------------ */

    // Mirrors getRoomName() in the comment component: a task-scoped room when we
    // have both a sprint and a task, otherwise the project room.
    function roomName() {
        const { projectId, sprintId, taskId } = ctx.value;
        const sid = socket && socket.value ? socket.value.id : '';
        if (sprintId && taskId) {
            return `comments_${projectId}_${sprintId}_${taskId}**${sid}`;
        }
        return `comments_project_${projectId}**${sid}`;
    }

    /**
     * The `objId` envelope the comments API expects. Channels post with a bare
     * `taskId: "default"` (not inside objId) — that asymmetry is deliberate and
     * matches the existing writer.
     */
    function messageEnvelope() {
        const { projectId, sprintId, taskId, folderId } = ctx.value;
        const envelope = { objId: { projectId }, project: true };

        if (!taskId) return envelope;

        envelope.objId.sprintId = sprintId;
        envelope.project = false;

        if (taskId === 'default') {
            envelope.taskId = 'default';
        } else {
            envelope.objId.taskId = taskId;
        }
        if (folderId) envelope.objId.folderId = folderId;

        return envelope;
    }

    function decorate(doc) {
        return { ...doc, sent: doc.userId === userId.value };
    }

    /* ------------------------------------------------------------------ *
     * history
     * ------------------------------------------------------------------ */

    function fetchPage() {
        const { projectId, sprintId, taskId, isDefaultProject } = ctx.value;
        const url = `${env.API_COMMENTS}/get-paginated-messages`
            + `?projectId=${projectId}`
            + `&taskId=${taskId}`
            + `&sprintId=${sprintId}`
            + `&isDefault=${!!isDefaultProject}`
            + `&mainChat=true`
            + `&skipValue=${totalLoaded.value}`
            + `&batchLimit=${BATCH}`;

        return apiRequest('get', url).then((response) => {
            const rows = (response && response.data && response.data.data) || [];
            return rows;
        });
    }

    /** First load for a conversation: newest batch, rendered oldest-first. */
    async function load() {
        messages.value = [];
        totalLoaded.value = 0;
        hasMore.value = true;
        loading.value = true;
        try {
            const rows = await fetchPage();
            // The endpoint returns newest-first; the transcript reads oldest-first.
            messages.value = rows.slice().reverse().map(decorate);
            totalLoaded.value = rows.length;
            hasMore.value = rows.length >= BATCH;
        } catch (error) {
            console.error('MainChat: load history failed', error);
        } finally {
            loading.value = false;
        }
    }

    /** Older page, prepended. Callers restore scroll anchoring themselves. */
    async function loadOlder() {
        if (loadingOlder.value || !hasMore.value || loading.value) return;
        loadingOlder.value = true;
        try {
            const rows = await fetchPage();
            const fresh = rows
                .filter((row) => !messages.value.some((m) => idOf(m) === idOf(row)))
                .slice()
                .reverse()
                .map(decorate);
            messages.value = [...fresh, ...messages.value];
            totalLoaded.value += rows.length;
            hasMore.value = rows.length >= BATCH;
        } catch (error) {
            console.error('MainChat: load older failed', error);
        } finally {
            loadingOlder.value = false;
        }
    }

    /* ------------------------------------------------------------------ *
     * live updates
     * ------------------------------------------------------------------ */

    function upsert(doc) {
        if (!doc) return;
        const key = idOf(doc);
        const at = messages.value.findIndex((m) => idOf(m) === key);
        if (at > -1) {
            messages.value[at] = { ...messages.value[at], ...decorate(doc) };
            return;
        }
        // A message we sent optimistically comes back over the socket: settle the
        // pending row instead of appending a duplicate.
        //
        // Match on mediaOriginalName, NOT mediaName: the placeholder carries the
        // local preview name while the stored document carries the generated
        // storage filename, so mediaName never matched and every upload appeared
        // twice until a reload. mediaOriginalName is the user's file name and is
        // identical on both sides (and empty for text, so text still matches).
        const pendingAt = messages.value.findIndex((m) => (
            m.isSending
            && m.userId === doc.userId
            && (m.message || '') === (doc.message || '')
            && (m.mediaOriginalName || '') === (doc.mediaOriginalName || '')
        ));
        if (pendingAt > -1) {
            messages.value[pendingAt] = decorate(doc);
            return;
        }
        messages.value.push(decorate(doc));
        totalLoaded.value += 1;
    }

    /**
     * Pull anything that arrived while we were not listening.
     *
     * Re-joining a room only restores FUTURE events — messages sent while the socket
     * was away are gone. And the socket goes away far more often than it looks: App.vue
     * emits `disconnectNameSpace` whenever the tab is HIDDEN, and the server responds by
     * removing the socket's rooms and force-disconnecting it. Switching to another
     * window — exactly what you do to send from a second account — takes the reader
     * offline, so the message they were waiting for was never delivered to them.
     *
     * The endpoint's `tabLeaveTime` filter returns everything updated since a moment and
     * ignores the page limit, which is what makes this a catch-up rather than a page.
     * Safe to call at any time: upsert() is keyed on _id, so re-receiving a message we
     * already hold just refreshes it.
     */
    async function catchUp() {
        const { projectId, sprintId, taskId, isDefaultProject } = ctx.value;
        if (!projectId || !sprintId || !taskId) return;

        const newest = messages.value[messages.value.length - 1];
        const stamp = newest && newest.createdAt ? new Date(newest.createdAt).getTime() : NaN;
        // No transcript yet (or an unparseable date): look back a few minutes rather
        // than asking for the entire history.
        const since = Number.isNaN(stamp) ? Date.now() - 5 * 60 * 1000 : stamp;

        const url = `${env.API_COMMENTS}/get-paginated-messages`
            + `?projectId=${projectId}`
            + `&taskId=${taskId}`
            + `&sprintId=${sprintId}`
            + `&isDefault=${!!isDefaultProject}`
            + `&mainChat=true`
            + `&skipValue=0`
            + `&batchLimit=${BATCH}`
            + `&tabLeaveTime=${since}`;

        try {
            const response = await apiRequest('get', url);
            const rows = (response && response.data && response.data.data) || [];
            // Newest-first from the endpoint; apply oldest-first so order is preserved.
            rows.slice().reverse().forEach((row) => upsert(row));
        } catch (error) {
            console.error('MainChat: catch-up failed', error);
        }
    }

    /* ------------------------------------------------------------------ *
     * typing presence
     *
     * Transient and socket-only: nothing is written, and a lost signal costs nothing
     * because every entry expires on a timer. That timer is the important part — it is
     * what stops a "typing…" from sticking forever when the other person closes their
     * tab mid-sentence and the "stopped" signal never arrives.
     * ------------------------------------------------------------------ */

    /** The room name without the socket-id suffix — what the server indexes on. */
    function roomPrefix() {
        const { projectId, sprintId, taskId } = ctx.value;
        if (sprintId && taskId) return `comments_${projectId}_${sprintId}_${taskId}`;
        return `comments_project_${projectId}`;
    }

    function sendTypingSignal(typing) {
        if (!socket || !socket.value) return;
        const { projectId, sprintId, taskId } = ctx.value;
        if (!projectId || !sprintId || !taskId) return;

        socket.value.emit('commentTyping', {
            roomPrefix: roomPrefix(),
            userId: userId.value,
            typing: !!typing,
        });
    }

    /**
     * Called on every keystroke, so it must not emit on every keystroke.
     *
     * One "started" per TYPING_HEARTBEAT while the user keeps going — enough to refresh
     * the receiver's expiry — and one "stopped" once they pause for TYPING_IDLE.
     */
    function setTyping(active) {
        if (!active) {
            clearTimeout(typingIdleTimer);
            typingIdleTimer = null;
            if (typingSentAt) {
                typingSentAt = 0;
                sendTypingSignal(false);
            }
            return;
        }

        const now = Date.now();
        if (!typingSentAt || now - typingSentAt > TYPING_HEARTBEAT) {
            typingSentAt = now;
            sendTypingSignal(true);
        }

        clearTimeout(typingIdleTimer);
        typingIdleTimer = setTimeout(() => setTyping(false), TYPING_IDLE);
    }

    /** Drop anyone whose signal has gone stale. */
    function sweepTyping() {
        const cutoff = Date.now() - TYPING_EXPIRY;
        const next = {};
        let changed = false;

        Object.keys(typingUsers.value).forEach((id) => {
            if (typingUsers.value[id] > cutoff) next[id] = typingUsers.value[id];
            else changed = true;
        });

        if (changed) typingUsers.value = next;
        if (!Object.keys(next).length && typingSweeper) {
            clearInterval(typingSweeper);
            typingSweeper = null;
        }
    }

    function onTypingSignal(data) {
        if (!data || data.roomPrefix !== roomPrefix()) return;
        // Our own signal, arriving from another tab of ours.
        if (!data.userId || data.userId === userId.value) return;

        const next = { ...typingUsers.value };
        if (data.typing) next[data.userId] = Date.now();
        else delete next[data.userId];
        typingUsers.value = next;

        if (Object.keys(next).length && !typingSweeper) {
            typingSweeper = setInterval(sweepTyping, 1000);
        }
    }

    function resetTyping() {
        clearTimeout(typingIdleTimer);
        typingIdleTimer = null;
        if (typingSweeper) {
            clearInterval(typingSweeper);
            typingSweeper = null;
        }
        typingSentAt = 0;
        typingUsers.value = {};
    }

    /** Subscribe to this conversation's room under the CURRENT socket id. */
    function joinConversationRoom() {
        if (!socket || !socket.value) return;
        joinedRoom = roomName();
        socket.value.emit('joinCommentRoom', { roomName: joinedRoom, socketId: socket.value.id });
    }

    function attach() {
        if (!socket || !socket.value) return;
        detach();
        joinConversationRoom();

        socket.value.on('commentInsert', (data) => upsert(data && data.fullDocument));
        socket.value.on('commentUpdate', (data) => upsert(data && data.fullDocument));
        socket.value.on('commentDelete', (data) => upsert(data && data.fullDocument));
        socket.value.on('commentReplace', (data) => upsert(data && data.fullDocument));
        socket.value.on('commentTyping', onTypingSignal);

        /*
         * Re-join whenever the connection comes back.
         *
         * Socket.IO reuses the same Socket object across a reconnect, so the listeners
         * above survive — but the CONNECTION is new: it gets a fresh id, and the server
         * clears the socket's room memberships. The room we registered under the old id
         * no longer contains us, and the server's delivery check is exactly
         * `socket.rooms.has(roomName)` — so nothing arrives.
         *
         * The room name also embeds the socket id, so it has to be rebuilt, not reused.
         *
         * This is why live delivery appeared to work only after switching conversation
         * or reloading: both call attach() again, which re-joined under the new id. A
         * dropped connection (a dev-server restart, a network blip, laptop sleep) left
         * the open conversation silently deaf until then.
         */
        // Re-join AND catch up: the reconnect restores the subscription, the catch-up
        // recovers whatever was sent while we were disconnected.
        rejoinRoom = () => {
            joinConversationRoom();
            catchUp();
        };
        socket.value.on('connect', rejoinRoom);
    }

    function detach() {
        if (!socket || !socket.value) return;

        // Tell the room we stopped before we go, so we do not leave a "typing…" behind
        // on someone else's screen waiting for the expiry to clear it.
        setTyping(false);
        resetTyping();

        ['commentInsert', 'commentUpdate', 'commentDelete', 'commentReplace', 'commentTyping']
            .forEach((event) => socket.value.off(event));

        // Pass the handler: a bare off('connect') would take out every other
        // component's reconnect logic on this shared socket, not just ours.
        if (rejoinRoom) {
            socket.value.off('connect', rejoinRoom);
            rejoinRoom = null;
        }

        if (joinedRoom) {
            socket.value.emit('leaveCommentRoom', joinedRoom);
            joinedRoom = '';
        }
    }

    /* ------------------------------------------------------------------ *
     * unread counts + notifications
     *
     * Ported from the shared comment component so the new surface keeps the
     * recipient side working: without these the message still saves, but the
     * other person gets no unread badge and no push notification.
     * ------------------------------------------------------------------ */

    /** Drop anyone who muted this project; add anyone watching all activity. */
    function resolveRecipients() {
        const prefs = watcherPrefs() || {};
        const out = [];

        Object.keys(prefs).forEach((uid) => {
            if (prefs[uid] === 'all_activity') out.push(uid);
        });
        (participants() || []).forEach((uid) => {
            if (prefs[uid] !== 'ignore') out.push(uid);
        });

        return [...new Set(out)].filter((uid) => uid && uid !== userId.value);
    }

    /** Bump the unread counter for everyone else in the conversation. */
    function bumpUnread() {
        const { projectId, sprintId, taskId } = ctx.value;
        const userIds = resolveRecipients();
        if (!userIds.length) return;

        const payload = taskId
            ? { companyId: companyId.value, key: 2, projectId, userIds, taskId, sprintId, prevCount: 0 }
            : { companyId: companyId.value, key: 1, projectId, userIds };

        apiRequest('post', env.UPDATE_UNREADREAD_COMMENTS_COUNT, payload)
            .catch((error) => console.error('MainChat: unread bump failed', error));
    }

    /** Web-push for a chat message, mirroring the existing chat notification. */
    function pushNotification(doc) {
        const recipients = resolveRecipients();
        if (!recipients.length) return;

        const { projectId, sprintId, taskId } = ctx.value;
        const sender = currentUser() || {};

        apiRequest('post', env.SEND_FCM, {
            message: doc.message || doc.mediaOriginalName || '',
            companyId: companyId.value,
            userIdArray: recipients,
            key: 'message_create',
            type: 'chat',
            senderUserDetail: {
                id: sender.id || sender._id,
                Employee_Name: sender.Employee_Name,
                companyOwnerId: sender.companyOwnerId,
            },
            actionUrl: `${companyId.value}/chat/${projectId}/${taskId && taskId !== 'default' ? taskId : sprintId}`,
        }).catch((error) => console.error('MainChat: push notification failed', error));
    }

    /**
     * Keep the conversation list's preview in step.
     *
     * The sidebar row shows the DM task's own `message` / `lastMessage` fields — a
     * denormalised copy the SENDER maintains, not something derived from the comments.
     * Only Comments.vue was doing this, so anything sent from this module left the row
     * showing whatever was there before, and a conversation only ever used here showed
     * no preview or date at all.
     *
     * Channels are skipped deliberately: their row is a sprint, not a task, and taskId
     * is the literal string "default", which the endpoint would try to cast to an
     * ObjectId. Same guard Comments.vue applies.
     */
    function touchConversationPreview(doc) {
        const { taskId, isDefaultProject } = ctx.value;
        if (!doc || !isDefaultProject || !taskId || taskId === 'default') return;

        taskClass.updateLastMessageTime({
            taskId,
            companyId: companyId.value,
            msgObj: doc,
        }).catch((error) => console.error('MainChat: last-message update failed', error));
    }

    function announce(doc) {
        if (!doc) return;
        bumpUnread();
        pushNotification(doc);
        touchConversationPreview(doc);
    }

    /**
     * Clear MY unread for this conversation. Skipped when the tab is in the
     * background, matching the existing behaviour — being on the page but not
     * looking at it should not mark things read.
     *
     * Returns whether the write was actually issued, so the caller can keep the
     * local counter store in step with what the server was told.
     */
    function markRead() {
        const { projectId, sprintId, taskId } = ctx.value;
        if (!projectId) return false;
        if (typeof document !== 'undefined' && document.hasFocus && !document.hasFocus()) return false;

        apiRequest('post', env.UPDATE_UNREADREAD_COMMENTS_COUNT, {
            companyId: companyId.value,
            projectId,
            userIds: [userId.value],
            read: true,
            key: taskId ? 2 : 1,
            ...(taskId ? { taskId } : {}),
            ...(sprintId ? { sprintId } : {}),
            messageCount: 0,
            prevCount: 0,
        }).catch((error) => console.error('MainChat: mark read failed', error));

        return true;
    }

    /* ------------------------------------------------------------------ *
     * sending
     * ------------------------------------------------------------------ */

    function pendingRow(patch) {
        tempSeq += 1;
        const row = {
            tempId: `pending_${tempSeq}`,
            userId: userId.value,
            sent: true,
            isSending: true,
            failed: false,
            type: 'text',
            message: '',
            createdAt: new Date().toISOString(),
            ...patch,
        };
        messages.value.push(row);
        return row;
    }

    /**
     * Replace a placeholder with the stored document.
     *
     * Idempotent on purpose: the socket echo and the HTTP response race, and
     * either can land first. If the echo already inserted this document, the
     * placeholder is dropped rather than filled — otherwise the same message
     * ends up in the list twice.
     */
    function settle(tempId, doc) {
        const pendingAt = messages.value.findIndex((m) => m.tempId === tempId);
        const existingAt = messages.value.findIndex((m) => idOf(m) === idOf(doc));

        if (existingAt > -1 && existingAt !== pendingAt) {
            if (pendingAt > -1) messages.value.splice(pendingAt, 1);
            const at = messages.value.findIndex((m) => idOf(m) === idOf(doc));
            if (at > -1) messages.value[at] = decorate(doc);
            return;
        }

        if (pendingAt === -1) return;
        messages.value[pendingAt] = { ...decorate(doc), tempId: undefined, isSending: false, failed: false };
    }

    function markFailed(tempId) {
        const at = messages.value.findIndex((m) => m.tempId === tempId);
        if (at === -1) return;
        messages.value[at] = { ...messages.value[at], isSending: false, failed: true };
    }

    /**
     * Build + persist one message. `reply` is the message being answered (or {}).
     * Returns the stored document.
     */
    async function persist(draft, reply = {}) {
        const baked = await bakeMessage({
            messageData: { ...draft, reply, userId: userId.value },
            edited: false,
        });
        const envelope = messageEnvelope();
        const payload = {
            ...baked,
            ...envelope,
            objId: envelope.objId,
            message: escapeMessage(baked.message || ''),
        };
        return persistMessage({ messageData: payload, edited: false });
    }

    async function sendText(text, reply = {}) {
        const body = (text || '').trim();
        if (!body) return;

        const row = pendingRow({
            message: body,
            type: 'text',
            hasReply: !!(reply && Object.keys(reply).length),
            reply_message: reply && reply.message ? reply.message : '',
            reply_userId: reply && reply.userId ? reply.userId : '',
        });

        try {
            const doc = await persist({ message: body, type: 'text' }, reply);
            settle(row.tempId, doc);
            announce(doc);
        } catch (error) {
            console.error('MainChat: send failed', error);
            markFailed(row.tempId);
        }
    }

    /** Re-send a row that previously failed, keeping its position. */
    async function retry(row) {
        if (!row || !row.tempId) return;
        const at = messages.value.findIndex((m) => m.tempId === row.tempId);
        if (at > -1) messages.value[at] = { ...messages.value[at], isSending: true, failed: false };
        try {
            const doc = await persist({ message: row.message, type: row.type || 'text' }, {});
            settle(row.tempId, doc);
            announce(doc);
        } catch (error) {
            console.error('MainChat: retry failed', error);
            markFailed(row.tempId);
        }
    }

    /**
     * Validate + upload files, then post one message per file. Progress is
     * coarse (pending -> sent) because the storage helper does not report bytes;
     * the row shows an indeterminate bar while it is in flight.
     */
    async function sendFiles(fileList, allowedExtensions = []) {
        const incoming = Array.from(fileList || []);
        if (!incoming.length) return;

        let checked = [];
        try {
            checked = await checkFile(incoming, allowedExtensions);
        } catch (error) {
            console.error('MainChat: file rejected', error);
            return;
        }

        for (const file of checked) {
            let rendered;
            try {
                rendered = await renderFiles(
                    { data: file.data, name: file.name, mediaOriginalName: file.name, fileType: file.fileType },
                    userId.value,
                );
            } catch (error) {
                console.error('MainChat: could not read file', error);
                continue;
            }

            const row = pendingRow({
                type: file.fileType,
                mediaName: rendered.mediaName || file.name,
                mediaOriginalName: file.name,
                mediaSize: file.data ? file.data.size : 0,
                mediaURL: rendered.mediaURL || '',
                isUploading: true,
            });

            try {
                const { projectId, sprintId, taskId } = ctx.value;
                const storedName = generateFileName(file.name, env.STORAGE_TYPE);
                const path = taskId
                    ? `Project/${projectId}/${sprintId}/${taskId}/Comments/${storedName}`
                    : `Project/${projectId}/Comments/${storedName}`;

                const url = await uploadToWasabi(file.data, path, companyId.value);
                const doc = await persist({
                    message: '',
                    type: file.fileType,
                    mediaURL: url,
                    mediaName: storedName,
                    mediaOriginalName: file.name,
                    mediaSize: file.data ? file.data.size : 0,
                }, {});
                settle(row.tempId, doc);
                announce(doc);
            } catch (error) {
                console.error('MainChat: upload failed', error);
                markFailed(row.tempId);
            }
        }
    }

    /* ------------------------------------------------------------------ *
     * message actions (parity with the existing comment menu)
     * ------------------------------------------------------------------ */

    /** Toggle an emoji reaction. Same endpoint and payload the comment UI uses. */
    async function toggleReaction(message, emoji) {
        if (!message || !message._id) return;
        const sender = currentUser() || {};
        try {
            const response = await apiRequest('post', '/api/v2/reactions', {
                targetType: 'comment',
                targetId: message._id,
                emoji,
                isProjectComment: message.project === true,
                userData: { id: sender.id, Employee_Name: sender.Employee_Name },
            });
            if (response && response.data && response.data.status) {
                const at = messages.value.findIndex((m) => idOf(m) === idOf(message));
                if (at > -1) {
                    messages.value[at] = {
                        ...messages.value[at],
                        reactions: (response.data.data && response.data.data.reactions) || [],
                    };
                }
            }
        } catch (error) {
            console.error('MainChat: reaction failed', error);
        }
    }

    /** Pin / unpin. `timestamps: false` so pinning does not bump updatedAt. */
    async function togglePin(message) {
        if (!message || !message._id) return false;
        const pinned = message.pinnedMessage === undefined ? true : !message.pinnedMessage;
        try {
            await apiRequest('put', env.API_COMMENTS, {
                id: message._id,
                data: { pinnedMessage: pinned },
                isProjectComment: message.project,
                options: { timestamps: false },
            });
            const at = messages.value.findIndex((m) => idOf(m) === idOf(message));
            if (at > -1) messages.value[at] = { ...messages.value[at], pinnedMessage: pinned };
            return pinned;
        } catch (error) {
            console.error('MainChat: pin failed', error);
            return message.pinnedMessage;
        }
    }

    /**
     * Mark the conversation unread from `message` onwards — the count is how many
     * messages sit at or after it, which is what the existing menu item sends.
     */
    async function markUnreadFrom(message) {
        const { projectId, sprintId, taskId } = ctx.value;
        const index = messages.value.findIndex((m) => idOf(m) === idOf(message));
        if (index === -1 || !projectId) return 0;
        const count = messages.value.length - index;

        try {
            const response = await apiRequest('post', env.UPDATE_UNREADREAD_COMMENTS_COUNT, {
                companyId: companyId.value,
                projectId,
                userIds: [userId.value],
                set: true,
                key: taskId ? 2 : 1,
                ...(taskId ? { taskId } : {}),
                ...(sprintId ? { sprintId } : {}),
                messageCount: count,
                prevCount: 0,
            });

            // A refused write can still answer 200 — don't report success on one.
            if (response && response.data && response.data.status === false) {
                console.error('MainChat: mark unread refused', response.data);
                return 0;
            }
        } catch (error) {
            console.error('MainChat: mark unread failed', error);
            return 0;
        }

        // The count the server now holds, so the caller can mirror it locally.
        return count;
    }

    /** Edit the text of an existing message (goes through the PUT edit path). */
    async function editText(message, text) {
        const body = (text || '').trim();
        if (!message || !message._id || !body) return;

        const previous = message.message;
        const at = messages.value.findIndex((m) => idOf(m) === idOf(message));
        if (at > -1) messages.value[at] = { ...messages.value[at], message: escapeMessage(body) };

        try {
            await persistMessage({
                messageData: { ...message, message: escapeMessage(body) },
                edited: true,
            });

            // Only when the edited message is still the newest — editing something
            // further back must not overwrite the preview with older text.
            const newest = messages.value[messages.value.length - 1];
            if (newest && idOf(newest) === idOf(message)) {
                touchConversationPreview({ ...message, message: escapeMessage(body) });
            }
        } catch (error) {
            console.error('MainChat: edit failed', error);
            if (at > -1) messages.value[at] = { ...messages.value[at], message: previous };
        }
    }

    /** Soft-delete, matching the existing comment delete (and storage cleanup). */
    async function removeMessage(msg) {
        if (!msg || !msg._id) return;
        try {
            await apiRequest('put', env.API_COMMENTS, {
                id: msg._id,
                data: { isDeleted: true },
                isProjectComment: msg.project,
            });
            const at = messages.value.findIndex((m) => idOf(m) === idOf(msg));
            if (at > -1) messages.value[at] = { ...messages.value[at], isDeleted: true };

            // If the newest message just went, the list preview would otherwise keep
            // quoting text that no longer exists. Same substitution Comments.vue makes.
            const newest = messages.value[messages.value.length - 1];
            if (newest && idOf(newest) === idOf(msg)) {
                touchConversationPreview({ ...msg, type: 'text', message: 'general.message_deleted' });
            }

            if (msg.type !== 'text' && msg.type !== 'link' && msg.mediaURL) {
                deleteFromWasabi(msg.mediaURL, companyId.value)
                    .catch((error) => console.error('MainChat: media cleanup failed', error));
            }
        } catch (error) {
            console.error('MainChat: delete failed', error);
        }
    }

    return {
        messages,
        loading,
        loadingOlder,
        hasMore,
        load,
        loadOlder,
        catchUp,
        typingUsers,
        setTyping,
        attach,
        detach,
        sendText,
        sendFiles,
        retry,
        removeMessage,
        markRead,
        toggleReaction,
        togglePin,
        markUnreadFrom,
        editText,
    };
}
