import { ref, computed, readonly } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

/**
 * Audio / video calling for main chat (AHE-3839).
 *
 * One call at a time, one engine for the whole app. It is a module-level singleton rather
 * than per-component state because an incoming call has to be answerable from wherever the
 * user happens to be — not only when the conversation that rang them is on screen.
 *
 * Media is peer-to-peer: the two browsers connect directly and the server only carries the
 * offer, the answer and ICE candidates. Nothing to record, nothing to store, nothing that
 * leaves a self-hoster's network.
 *
 *   idle → outgoing → connecting → active → idle        (caller)
 *   idle → incoming → connecting → active → idle        (callee)
 */

const STATE = { IDLE: 'idle', OUTGOING: 'outgoing', INCOMING: 'incoming', CONNECTING: 'connecting', ACTIVE: 'active' };

const state = ref(STATE.IDLE);
const callId = ref('');
const chatId = ref('');
const media = ref('audio');            // 'audio' | 'video'
const peerUserId = ref('');
const errorMessage = ref('');
const micOn = ref(true);
const camOn = ref(true);
const hasTurn = ref(true);             // assume yes until told otherwise
const startedAt = ref(0);
const localStream = ref(null);
const remoteStream = ref(null);
const isSharing = ref(false);
const shareStream = ref(null);     // what the local preview shows while sharing
// The far side's mic/camera. Assume on until told otherwise, so a peer whose browser
// never sends state is shown normally rather than permanently "camera off".
const peerCamOn = ref(true);
const peerMicOn = ref(true);
const peerSharing = ref(false);

let pc = null;                         // RTCPeerConnection
let socketRef = null;
let boundSocket = null;                // so listeners are bound exactly once per socket
let iceServers = [];
// Candidates can arrive before the remote description is set; applying one then throws.
let pendingCandidates = [];
// The camera track, parked while the screen is being shared so it can be put back.
let cameraTrack = null;
// The transceiver carrying our outgoing video — the camera on a video call, an empty slot
// on an audio one. Kept so screen sharing has something to swap into either way.
let videoTx = null;

const isSupported = () => typeof navigator !== 'undefined'
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function'
    && typeof window.RTCPeerConnection === 'function';

// getUserMedia only exists in a secure context. On plain HTTP the API is simply absent,
// which reads as "your browser is broken" unless we name the real reason.
const isSecure = () => (typeof window !== 'undefined')
    && (window.isSecureContext || ['localhost', '127.0.0.1'].includes(window.location.hostname));

const emit = (event, payload) => { if (socketRef && socketRef.value) socketRef.value.emit(event, payload); };

const stopStream = (streamRef) => {
    if (streamRef.value) {
        streamRef.value.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* already stopped */ } });
        streamRef.value = null;
    }
};

/**
 * Share the screen instead of the camera.
 *
 * Swaps the track on the existing sender rather than adding a second one. replaceTrack
 * needs no renegotiation — no new offer, no answer, nothing for the other side to do —
 * so the switch is instant and cannot fail halfway. Adding a track would mean a fresh
 * offer/answer round trip, and a call that has to renegotiate mid-flight is a call that
 * can break mid-flight.
 */
/**
 * The sender that carries our outgoing video.
 *
 * Held from when the connection was built rather than searched for. On an audio call the
 * slot exists but its track is null, so any search that matches on `track.kind === video`
 * would miss precisely the case screen sharing needs.
 */
const videoSender = () => (videoTx && videoTx.sender)
    || (pc && pc.getSenders().find((s) => s.track && s.track.kind === 'video'))
    || null;

/**
 * Take the video transceiver the offer created, and make sure we are allowed to send on it.
 *
 * Run by the ANSWERER right after setRemoteDescription. The offer carries a video m-line,
 * which creates a transceiver on this side; on an audio call it arrives with no track of
 * ours attached. Its direction may be 'recvonly' from our point of view, which would let
 * us receive their screen but silently drop ours — the exact asymmetry where the caller's
 * share is visible and the callee's is not. Setting it to sendrecv before building the
 * answer is what makes sharing work in both directions.
 */
const adoptVideoTransceiver = () => {
    if (!pc || videoTx) return;
    const tx = pc.getTransceivers().find((t) => {
        const rk = t.receiver && t.receiver.track && t.receiver.track.kind;
        const sk = t.sender && t.sender.track && t.sender.track.kind;
        return rk === 'video' || sk === 'video';
    });
    if (!tx) return;
    videoTx = tx;
    if (tx.direction !== 'sendrecv') {
        try { tx.direction = 'sendrecv'; } catch (e) { /* fixed by the browser */ }
    }
};

const startScreenShare = async () => {
    if (!pc || isSharing.value) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        errorMessage.value = 'This browser cannot share the screen.';
        return;
    }
    // In a video call the sender already carries the camera; in an audio call it is the
    // empty slot reserved in createPeer, whose track is null — so match on the
    // transceiver, not on a track that may not be there yet.
    const sender = videoSender();
    if (!sender) { errorMessage.value = 'Screen sharing is not available on this call.'; return; }

    let display;
    try {
        display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch (e) {
        // Cancelling the picker is a normal outcome, not a failure to report.
        return;
    }

    const track = display.getVideoTracks()[0];
    if (!track) return;
    cameraTrack = sender.track;
    await sender.replaceTrack(track);
    shareStream.value = display;
    isSharing.value = true;
    sendMediaState();

    // The browser draws its own "Stop sharing" bar; ending it there must end it here too,
    // or the UI keeps claiming to share a screen that is already gone.
    track.onended = () => { stopScreenShare(); };
};

const stopScreenShare = async () => {
    if (!isSharing.value) return;
    isSharing.value = false;
    sendMediaState();
    // Put the camera back on a video call; on an audio call there was never one, so the
    // slot goes back to sending nothing (replaceTrack(null) is how that is said).
    const sender = videoSender();
    if (sender) {
        try { await sender.replaceTrack(cameraTrack || null); } catch (e) { /* call already gone */ }
    }
    cameraTrack = null;
    if (shareStream.value) {
        shareStream.value.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* stopped */ } });
        shareStream.value = null;
    }
};

const toggleShare = () => (isSharing.value ? stopScreenShare() : startScreenShare());

const teardown = () => {
    if (pc) {
        // Drop the handlers before closing: a closing connection still fires state events,
        // and a late onconnectionstatechange would reset a call that has already started.
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        try { pc.close(); } catch (e) { /* already closed */ }
        pc = null;
    }
    stopStream(localStream);
    stopStream(shareStream);
    remoteStream.value = null;
    isSharing.value = false;
    cameraTrack = null;
    videoTx = null;
    peerCamOn.value = true;
    peerMicOn.value = true;
    peerSharing.value = false;
    pendingCandidates = [];
    callId.value = '';
    chatId.value = '';
    peerUserId.value = '';
    startedAt.value = 0;
    micOn.value = true;
    camOn.value = true;
    state.value = STATE.IDLE;
};

const loadIceServers = async () => {
    try {
        const res = await apiRequest('get', `${env.CALL_ICE_CONFIG}`);
        const d = (res && res.data && res.data.data) || {};
        iceServers = Array.isArray(d.iceServers) ? d.iceServers : [];
        hasTurn.value = d.hasTurn !== false;
    } catch (e) {
        // A missing relay config is not fatal — most networks connect without one.
        iceServers = [];
        hasTurn.value = false;
    }
};

const getMedia = async (kind) => {
    const constraints = kind === 'video'
        ? { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } }
        : { audio: true, video: false };
    return navigator.mediaDevices.getUserMedia(constraints);
};

/**
 * @param {boolean} isOfferer  true for the side that creates the offer.
 *
 * Only the OFFERER reserves the spare video slot. The answerer must not: an
 * addTransceiver on the answering side does not reliably associate with the video m-line
 * already in the offer, so it can end up sending on a transceiver the offerer never
 * negotiated — which looks exactly like "their screen share works, mine doesn't". The
 * answerer instead adopts the transceiver the offer brings with it (see the offer
 * handler), which is what already makes video calls work in both directions: there, both
 * sides get their video transceiver from addTrack.
 */
const createPeer = (isOfferer) => {
    pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (e) => {
        if (e.candidate) emit('call:signal', { callId: callId.value, kind: 'ice', payload: e.candidate });
    };

    pc.ontrack = (e) => {
        // Take the stream the sender attached (addTrack was given one), not a stream we
        // build here. Assigning an EMPTY MediaStream to the element and then adding
        // tracks to it is a race: the element can latch on to it while it still has no
        // tracks and then never play. Using e.streams[0] means the object already has
        // its tracks by the time it reaches the element.
        const incoming = (e.streams && e.streams[0]) || null;
        if (incoming) {
            remoteStream.value = incoming;
            return;
        }
        // A NEW MediaStream, not the existing one mutated in place. Reassigning the same
        // object to the ref is not a change as far as Vue is concerned, so the watcher
        // that attaches it to the element would never fire and the track would arrive
        // with nowhere to go.
        const merged = new MediaStream(remoteStream.value ? remoteStream.value.getTracks() : []);
        merged.addTrack(e.track);
        remoteStream.value = merged;
    };

    // Loud on purpose. When a call connects but nobody can hear anything, the answer is
    // almost always in these two lines, and without them there is nothing to go on.
    pc.oniceconnectionstatechange = () => {
        if (pc) console.info('[call] ice:', pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
        if (!pc) return;
        console.info('[call] connection:', pc.connectionState);
        if (pc.connectionState === 'connected') {
            state.value = STATE.ACTIVE;
            if (!startedAt.value) startedAt.value = Date.now();
            // Announce our starting state. Someone who muted before the call connected
            // would otherwise be shown as unmuted until they touched a control.
            sendMediaState();
        } else if (['failed', 'closed'].includes(pc.connectionState)) {
            // 'failed' after ICE has exhausted its candidates is the no-relay case.
            if (state.value !== STATE.IDLE) {
                errorMessage.value = hasTurn.value
                    ? 'The call could not connect.'
                    : 'The call could not connect. This network needs a TURN relay, which is not configured.';
            }
            hangUp();
        }
    };

    localStream.value.getTracks().forEach((track) => pc.addTrack(track, localStream.value));

    // An audio call has no video track, so there would be no sender to swap when someone
    // wants to share their screen — sharing would need a mid-call renegotiation, and a
    // call that renegotiates mid-flight is a call that can break mid-flight. Reserving an
    // empty video slot now makes sharing the same instant replaceTrack in both kinds of
    // call. It costs one extra m-line in the SDP and nothing at runtime.
    const localVideoTrack = localStream.value.getVideoTracks()[0] || null;
    videoTx = localVideoTrack
        ? pc.getTransceivers().find((t) => t.sender && t.sender.track === localVideoTrack) || null
        : null;
    if (!videoTx && isOfferer) {
        try {
            // `streams` matters: without it the far side receives a video track that
            // belongs to no MediaStream, so e.streams is empty and the track never joins
            // the stream their <video> is bound to. Naming the same stream as the audio
            // means both tracks arrive together, in one object.
            videoTx = pc.addTransceiver('video', { direction: 'sendrecv', streams: [localStream.value] });
        } catch (e) {
            videoTx = null;
        }
    }
};

const flushPendingCandidates = async () => {
    const queued = pendingCandidates;
    pendingCandidates = [];
    for (const c of queued) {
        try { await pc.addIceCandidate(c); } catch (e) { /* candidate no longer applies */ }
    }
};

/** Ring someone in a conversation. `kind` is 'audio' or 'video'. */
const startCall = async (conversationId, kind = 'audio') => {
    errorMessage.value = '';
    if (state.value !== STATE.IDLE) return;
    if (!isSecure()) { errorMessage.value = 'Calling needs a secure (HTTPS) connection.'; return; }
    if (!isSupported()) { errorMessage.value = 'This browser cannot make calls.'; return; }

    try {
        await loadIceServers();
        localStream.value = await getMedia(kind);
    } catch (e) {
        errorMessage.value = e && e.name === 'NotAllowedError'
            ? 'Microphone and camera access was blocked.'
            : 'No microphone or camera was found.';
        return;
    }

    chatId.value = String(conversationId);
    media.value = kind;
    state.value = STATE.OUTGOING;
    emit('call:invite', { chatId: chatId.value, media: kind });
};

/** Answer the call currently ringing. */
const acceptCall = async () => {
    if (state.value !== STATE.INCOMING) return;
    try {
        await loadIceServers();
        localStream.value = await getMedia(media.value);
    } catch (e) {
        errorMessage.value = e && e.name === 'NotAllowedError'
            ? 'Microphone and camera access was blocked.'
            : 'No microphone or camera was found.';
        emit('call:reject', { callId: callId.value, reason: 'no_media' });
        teardown();
        return;
    }
    state.value = STATE.CONNECTING;
    emit('call:accept', { callId: callId.value });
};

const rejectCall = () => {
    if (state.value !== STATE.INCOMING) return;
    emit('call:reject', { callId: callId.value, reason: 'declined' });
    teardown();
};

/** Hang up, whatever stage we are at — the server works out what that means. */
const hangUp = () => {
    if (state.value === STATE.IDLE) return;
    if (state.value === STATE.OUTGOING) emit('call:cancel', { callId: callId.value });
    else if (state.value === STATE.INCOMING) emit('call:reject', { callId: callId.value, reason: 'declined' });
    else emit('call:end', { callId: callId.value });
    teardown();
};

/**
 * Tell the other side what our mic and camera are doing.
 *
 * A disabled track is not a stopped track — it keeps sending black frames and silence.
 * So "camera off" has to be said out loud; the far side cannot infer it from the media,
 * and without this it just sees a black rectangle and assumes the call is broken.
 */
const sendMediaState = () => {
    if (!callId.value) return;
    emit('call:signal', {
        callId: callId.value,
        kind: 'state',
        payload: { camOn: camOn.value, micOn: micOn.value, sharing: isSharing.value },
    });
};

const toggleMic = () => {
    if (!localStream.value) return;
    micOn.value = !micOn.value;
    localStream.value.getAudioTracks().forEach((t) => { t.enabled = micOn.value; });
    sendMediaState();
};

const toggleCam = () => {
    if (!localStream.value) return;
    camOn.value = !camOn.value;
    localStream.value.getVideoTracks().forEach((t) => { t.enabled = camOn.value; });
    sendMediaState();
};

/**
 * Bind the socket listeners. Safe to call repeatedly — App re-creates the socket on a
 * company switch, and binding twice would double every event.
 */
const bindSocket = (socket) => {
    socketRef = socket;
    const s = socket && socket.value;
    if (!s || boundSocket === s) return;
    boundSocket = s;

    s.on('call:incoming', ({ callId: id, chatId: cid, media: kind, from }) => {
        // Already busy: let the server's own busy check stand, but never let a second
        // ring overwrite the call in progress.
        if (state.value !== STATE.IDLE) return;
        callId.value = id;
        chatId.value = String(cid || '');
        media.value = kind === 'video' ? 'video' : 'audio';
        peerUserId.value = String(from || '');
        state.value = STATE.INCOMING;
    });

    s.on('call:ringing', ({ callId: id, to }) => {
        callId.value = id;
        // Who we are ringing. Only the server knows — the caller picked a conversation,
        // not a person — so without this the outgoing window has no name to show.
        if (to) peerUserId.value = String(to);
    });

    // The caller creates the offer once the callee has picked up — not before, so the
    // media only starts flowing to someone who actually answered.
    s.on('call:accepted', async ({ callId: id, by }) => {
        if (state.value !== STATE.OUTGOING) return;
        callId.value = id;
        peerUserId.value = String(by || '');
        state.value = STATE.CONNECTING;
        try {
            createPeer(true);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            emit('call:signal', { callId: id, kind: 'offer', payload: offer });
        } catch (e) {
            errorMessage.value = 'Could not start the connection.';
            hangUp();
        }
    });

    s.on('call:signal', async ({ callId: id, kind, payload }) => {
        if (!id || id !== callId.value) return;
        try {
            if (kind === 'offer') {
                if (!pc) createPeer(false);
                await pc.setRemoteDescription(new RTCSessionDescription(payload));
                await flushPendingCandidates();
                adoptVideoTransceiver();
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                emit('call:signal', { callId: id, kind: 'answer', payload: answer });
            } else if (kind === 'answer') {
                if (!pc) return;
                await pc.setRemoteDescription(new RTCSessionDescription(payload));
                await flushPendingCandidates();
            } else if (kind === 'state') {
                const p = payload || {};
                peerCamOn.value = p.camOn !== false;
                peerMicOn.value = p.micOn !== false;
                peerSharing.value = p.sharing === true;
            } else if (kind === 'ice') {
                const candidate = new RTCIceCandidate(payload);
                // Before the remote description exists there is nothing to attach a
                // candidate to, so hold it rather than throwing it away.
                if (pc && pc.remoteDescription && pc.remoteDescription.type) await pc.addIceCandidate(candidate);
                else pendingCandidates.push(candidate);
            }
        } catch (e) {
            errorMessage.value = 'The connection failed.';
            hangUp();
        }
    });

    s.on('call:rejected', () => { errorMessage.value = 'Call declined.'; teardown(); });
    s.on('call:cancelled', () => { teardown(); });
    s.on('call:unavailable', () => { errorMessage.value = 'They are not online.'; teardown(); });
    s.on('call:missed', () => { errorMessage.value = 'No answer.'; teardown(); });
    s.on('call:takenElsewhere', () => { teardown(); });
    s.on('call:ended', () => { teardown(); });
    s.on('call:error', ({ message }) => {
        // Surface the server's own words — a generic failure here is undiagnosable.
        errorMessage.value = message || 'The call failed.';
        teardown();
    });
};

export function useCall() {
    return {
        // state
        state: readonly(state),
        callId: readonly(callId),
        chatId: readonly(chatId),
        media: readonly(media),
        peerUserId: readonly(peerUserId),
        errorMessage,
        micOn: readonly(micOn),
        camOn: readonly(camOn),
        hasTurn: readonly(hasTurn),
        startedAt: readonly(startedAt),
        localStream,
        remoteStream,
        shareStream,
        isSharing: readonly(isSharing),
        peerCamOn: readonly(peerCamOn),
        peerMicOn: readonly(peerMicOn),
        peerSharing: readonly(peerSharing),
        // derived
        isIdle: computed(() => state.value === STATE.IDLE),
        isIncoming: computed(() => state.value === STATE.INCOMING),
        isOutgoing: computed(() => state.value === STATE.OUTGOING),
        isBusy: computed(() => state.value !== STATE.IDLE),
        isActive: computed(() => state.value === STATE.ACTIVE),
        // actions
        bindSocket,
        startCall,
        acceptCall,
        rejectCall,
        hangUp,
        toggleMic,
        toggleCam,
        toggleShare,
        stopScreenShare,
        isSupported,
        isSecure,
        STATE,
    };
}
