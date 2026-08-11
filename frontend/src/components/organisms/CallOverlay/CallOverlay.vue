<template>
    <!-- Mounted once at the app root, not inside the chat panel: a call has to be
         answerable wherever the user happens to be, and an incoming ring that only
         appears when the right conversation is open is a missed call. -->
    <Teleport to="body">
        <!-- Ringing: a compact card, so it interrupts without taking the screen. -->
        <div v-if="isIncoming" class="call-ring">
            <div class="call-ring__who">
                <CallAvatar :name="peerName" :image="peerImage" :size="40" />
                <div class="call-ring__text">
                    <span class="call-ring__name">{{ peerName }}</span>
                    <span class="call-ring__sub">{{ media === 'video' ? $t('call.incoming_video') : $t('call.incoming_audio') }}</span>
                </div>
            </div>
            <div class="call-ring__actions">
                <button type="button" class="call-btn call-btn--decline" :title="$t('call.decline')" @click="rejectCall">
                    <CallIcon name="hangup" />
                </button>
                <button type="button" class="call-btn call-btn--accept" :title="$t('call.accept')" @click="acceptCall">
                    <CallIcon :name="media === 'video' ? 'video' : 'phone'" />
                </button>
            </div>
        </div>

        <!-- Connected or dialling: the full window. -->
        <div v-else-if="isBusy" class="call-win" :class="{ 'call-win--audio': !hasPicture, 'call-win--max': maximized }">
            <div class="call-win__head">
                <div class="call-win__id">
                    <span class="call-win__name">{{ peerName }}</span>
                    <span class="call-win__status">{{ statusLabel }}</span>
                </div>
                <!-- Only worth offering once there is something to look at — which now
                     includes an audio call that someone is sharing a screen into. -->
                <button
                    v-if="hasPicture"
                    type="button"
                    class="call-win__expand"
                    :title="maximized ? $t('call.restore') : $t('call.maximize')"
                    @click="maximized = !maximized"
                ><CallIcon :name="maximized ? 'collapse' : 'expand'" :size="15" /></button>
            </div>

            <div class="call-win__stage">
                <!-- Remote first: it is the person you are talking to. -->
                <video
                    v-show="showRemoteVideo"
                    ref="remoteVideo"
                    class="call-win__remote"
                    autoplay
                    playsinline
                ></video>
                <!-- Their camera being off is a state worth showing, not a black frame.
                     A disabled track still sends, so without this the other side just
                     looks broken. -->
                <div v-if="!showRemoteVideo" class="call-win__avatar">
                    <CallAvatar :name="peerName" :image="peerImage" :size="maximized ? 140 : 96" />
                </div>
                <!-- Their mic, on the stage where their face is — the same place Meet
                     puts it, because that is where you are already looking. -->
                <span v-if="isActive && !peerMicOn" class="call-win__badge" :title="$t('call.peer_muted')">
                    <CallIcon name="micOff" :size="13" />
                </span>
                <!-- Muted, or the local mic feeds back into the local speakers. -->
                <video
                    v-show="showLocalVideo"
                    ref="localVideo"
                    class="call-win__local"
                    autoplay
                    playsinline
                    muted
                ></video>
                <!-- Your own tile when your camera is off, in the same spot the preview
                     occupies, so the corner does not just go black. Only when there is a
                     picture on the stage — on a plain audio call the whole window is
                     already the two of you, and a corner tile adds nothing. -->
                <div v-if="hasPicture && !showLocalVideo" class="call-win__local call-win__local--off">
                    <CallAvatar :name="myName" :image="myImage" :size="maximized ? 56 : 38" />
                </div>
                <!-- Audio calls get a real audio element rather than riding on a hidden
                     video one. A display:none <video> is not a reliable place to put
                     sound — this is the element that actually has to make noise. -->
                <audio ref="remoteAudio" autoplay></audio>
            </div>

            <p v-if="!hasTurn && !isActive" class="call-win__warn">{{ $t('call.no_turn_warning') }}</p>

            <div class="call-win__actions">
                <button type="button" class="call-btn" :class="{ 'call-btn--off': !micOn }" :title="micOn ? $t('call.mute') : $t('call.unmute')" @click="toggleMic">
                    <CallIcon :name="micOn ? 'mic' : 'micOff'" />
                </button>
                <button v-if="media === 'video'" type="button" class="call-btn" :class="{ 'call-btn--off': !camOn }" :title="camOn ? $t('call.camera_off') : $t('call.camera_on')" @click="toggleCam">
                    <CallIcon :name="camOn ? 'video' : 'videoOff'" />
                </button>
                <!-- Available on audio calls too: createPeer reserves a video slot even
                     when there is no camera, so there is always something to swap into. -->
                <button type="button" class="call-btn" :class="{ 'call-btn--on': isSharing }" :title="isSharing ? $t('call.stop_share') : $t('call.share_screen')" @click="toggleShare">
                    <CallIcon :name="isSharing ? 'screenOff' : 'screen'" />
                </button>
                <button type="button" class="call-btn call-btn--decline" :title="$t('call.hang_up')" @click="hangUp">
                    <CallIcon name="hangup" />
                </button>
            </div>
        </div>

        <!-- Why the last call did not happen. Dismissible, and never on top of a live call. -->
        <div v-else-if="errorMessage" class="call-toast" @click="errorMessage = ''">{{ errorMessage }}</div>
    </Teleport>
</template>

<script setup>
import { ref, computed, watch, inject, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import { useCall } from '@/composable/useCall';
import { useGetterFunctions } from '@/composable';
import CallAvatar from './CallAvatar.vue';
import CallIcon from './CallIcon.vue';

const socket = inject('$socket');
const myUserId = inject('$userId');
const { getUser } = useGetterFunctions();
useStore();

const {
    state, media, peerUserId, errorMessage, micOn, camOn, hasTurn, startedAt,
    localStream, remoteStream, shareStream, isSharing,
    peerCamOn, peerMicOn, peerSharing,
    isIncoming, isBusy, isActive, isOutgoing,
    bindSocket, acceptCall, rejectCall, hangUp, toggleMic, toggleCam, toggleShare, STATE,
} = useCall();

// Purely presentational, so it stays here rather than in the call engine.
const maximized = ref(false);

const remoteVideo = ref(null);
const remoteAudio = ref(null);
const localVideo = ref(null);
const elapsed = ref(0);
let ticker = null;

const nameOf = (u) => (u && (u.Employee_Name || `${u.Employee_FName || ''} ${u.Employee_LName || ''}`.trim())) || '';

const peerUser = computed(() => (peerUserId.value ? getUser(peerUserId.value) : null));
const peerName = computed(() => nameOf(peerUser.value) || '—');
const peerImage = computed(() => (peerUser.value && peerUser.value.Employee_profileImageURL) || '');

const me = computed(() => (myUserId && myUserId.value ? getUser(myUserId.value) : null));
const myName = computed(() => nameOf(me.value) || '—');
const myImage = computed(() => (me.value && me.value.Employee_profileImageURL) || '');

// Show the remote picture when there is one: their camera on a video call, or their
// screen — which can happen on an audio call too, since sharing is allowed there.
const showRemoteVideo = computed(() => isActive.value
    && (peerSharing.value || (media.value === 'video' && peerCamOn.value)));
// Sharing keeps the self-view alive even with the camera off — the screen is the video.
const showLocalVideo = computed(() => isSharing.value || (media.value === 'video' && camOn.value));
// An audio call is a narrow window until a screen turns up in it.
const hasPicture = computed(() => showRemoteVideo.value || showLocalVideo.value);

const statusLabel = computed(() => {
    if (isActive.value) {
        const m = Math.floor(elapsed.value / 60);
        const s = elapsed.value % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    if (isOutgoing.value) return 'Ringing…';
    if (state.value === STATE.CONNECTING) return 'Connecting…';
    return '';
});

// The socket is created after login and replaced on a company switch, so bind on both.
watch(socket, (s) => { if (s) bindSocket(socket); }, { immediate: true });

/**
 * Attach the streams to their elements.
 *
 * srcObject is a property, not an attribute, so it cannot be bound in the template. This
 * runs on every relevant change because the elements do not exist until the window has
 * rendered — the stream is often ready before there is anywhere to put it.
 *
 * The remote stream goes to exactly ONE element: the video for a video call, the audio
 * element otherwise. Attaching it to both would play the same voice twice.
 */
const attachStreams = async () => {
    await nextTick();
    // While sharing, the self-view shows the screen — otherwise you cannot tell what the
    // other person is actually seeing, which is how people share the wrong window.
    if (localVideo.value) localVideo.value.srcObject = shareStream.value || localStream.value || null;

    // The remote stream goes wherever it can be seen AND heard. Once a picture is on
    // screen that is the <video> element, which plays the audio too; until then it is the
    // <audio> element. Keyed on what is actually visible rather than on the call type,
    // because a screen shared into an audio call puts a picture on an audio call.
    const remote = remoteStream.value || null;
    const useVideo = showRemoteVideo.value;
    if (remoteVideo.value) remoteVideo.value.srcObject = useVideo ? remote : null;
    if (remoteAudio.value) remoteAudio.value.srcObject = useVideo ? null : remote;

    // Autoplay can be refused. Say so rather than presenting a silent call as a working
    // one — a muted call with no explanation is indistinguishable from a broken one.
    const target = useVideo ? remoteVideo.value : remoteAudio.value;
    if (target && remote) {
        try { await target.play(); } catch (e) { errorMessage.value = 'Click anywhere to allow audio playback.'; }
    }
};

watch(localStream, attachStreams);
watch(remoteStream, attachStreams);
watch(shareStream, attachStreams);
watch(isBusy, (busy) => { if (busy) attachStreams(); else maximized.value = false; });
// The window changes size, so the elements re-lay-out and need re-attaching.
watch(maximized, attachStreams);
// A hidden <video> is given a null srcObject, so the moment one becomes visible — the
// far side turning a camera on, or starting to share into an audio call — the stream has
// to be put back. Without this the element appears with nothing in it and stays black.
watch(showRemoteVideo, attachStreams);
watch(showLocalVideo, attachStreams);

/**
 * Clear the failure toast on its own after a few seconds.
 *
 * It reports something that has already finished — the call did not connect, they
 * declined — so it needs to be read, not acknowledged. Making someone click it leaves a
 * stale message sitting over the UI until they notice it. Clicking still dismisses it
 * early. The timer restarts on each new message so a second one gets its full time.
 */
const ERROR_VISIBLE_MS = 3000;
let errorTimer = null;
watch(errorMessage, (msg) => {
    clearTimeout(errorTimer);
    if (!msg) return;
    errorTimer = setTimeout(() => { errorMessage.value = ''; }, ERROR_VISIBLE_MS);
});

watch(isActive, (active) => {
    clearInterval(ticker);
    if (!active) { elapsed.value = 0; return; }
    ticker = setInterval(() => {
        elapsed.value = startedAt.value ? Math.round((Date.now() - startedAt.value) / 1000) : 0;
    }, 1000);
});

// A ringing call must survive a page the user is leaving; a live one must not outlive it.
const warnOnUnload = (e) => { if (isBusy.value) { e.preventDefault(); e.returnValue = ''; } };
onMounted(() => window.addEventListener('beforeunload', warnOnUnload));
onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', warnOnUnload);
    clearInterval(ticker);
    clearTimeout(errorTimer);
});
</script>

<style scoped>
/* These three are teleported to <body>, which puts them OUTSIDE #app — and #app is where
   the app's font-family lives. Without restating it here the text falls back to the
   browser's default serif, which is why every teleported surface has to set its own. */
.call-ring,
.call-win,
.call-toast {
    font-family: 'Roboto', sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

/* Ringing card — bottom right, above everything, small enough to ignore for a moment. */
.call-ring {
    position: fixed; right: 20px; bottom: 20px; z-index: 3000;
    display: flex; align-items: center; gap: 18px;
    padding: 14px 16px; border-radius: 14px;
    background: #fff; box-shadow: 0 12px 34px rgba(23, 30, 52, .22);
    animation: call-ring-in .18s ease-out;
}
@keyframes call-ring-in { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } }
.call-ring__who { display: flex; align-items: center; gap: 11px; }
.call-ring__text { display: flex; flex-direction: column; }
.call-ring__name { font-size: 13.5px; font-weight: 600; color: #1e2436; }
.call-ring__sub { font-size: 11.5px; color: #7b8496; }
.call-ring__actions { display: flex; gap: 9px; }

/* In-call window. */
.call-win {
    position: fixed; right: 20px; bottom: 20px; z-index: 3000;
    width: 340px; border-radius: 14px; overflow: hidden;
    background: #171e2e; color: #fff;
    box-shadow: 0 16px 40px rgba(23, 30, 52, .32);
    display: flex; flex-direction: column;
}
.call-win--audio { width: 280px; }
/* Maximised: fills the viewport bar a margin, so it reads as a window rather than as the
   browser having gone fullscreen. The stage takes the slack, which is the only thing
   worth enlarging. */
.call-win--max {
    right: 24px; bottom: 24px; left: 24px; top: 24px;
    width: auto; max-height: none;
}
.call-win--max .call-win__stage { flex: 1 1 auto; min-height: 0; }
.call-win--max .call-win__remote { max-height: none; height: 100%; }
.call-win--max .call-win__local { width: 190px; height: 132px; right: 16px; bottom: 16px; }
.call-win__head { padding: 12px 14px 8px; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.call-win__id { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.call-win__expand {
    flex: none; width: 26px; height: 26px;
    display: inline-flex; align-items: center; justify-content: center;
    border: none; border-radius: 6px; background: transparent;
    color: #97a1b5; cursor: pointer; transition: background .12s ease, color .12s ease;
}
.call-win__expand:hover { background: #2b3448; color: #fff; }
.call-win__name { font-size: 13.5px; font-weight: 600; }
.call-win__status { font-size: 11.5px; color: #97a1b5; font-variant-numeric: tabular-nums; }
.call-win__stage { position: relative; background: #0f1421; min-height: 150px; display: flex; align-items: center; justify-content: center; }
.call-win--audio .call-win__stage { min-height: 120px; }
.call-win__remote { width: 100%; max-height: 240px; object-fit: cover; display: block; background: #0f1421; }
.call-win__avatar { padding: 22px 0; }
/* Picture-in-picture, deliberately small: the point of the window is the other person. */
.call-win__local {
    position: absolute; right: 10px; bottom: 10px;
    width: 84px; height: 62px; object-fit: cover;
    border-radius: 8px; border: 2px solid rgba(255, 255, 255, .18); background: #0f1421;
}
.call-win__local--off { display: flex; align-items: center; justify-content: center; }
/* Their mic state, pinned to the stage. Top-left so it never collides with the
   self-view in the opposite corner. */
.call-win__badge {
    position: absolute; left: 10px; top: 10px;
    width: 26px; height: 26px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    background: rgba(214, 69, 80, .92); color: #fff;
}
.call-win__warn { margin: 0; padding: 8px 14px; font-size: 11px; color: #f0b46b; background: rgba(240, 180, 107, .1); }
.call-win__actions { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 12px; }

.call-btn {
    width: 42px; height: 42px; border: none; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    background: #2b3448; color: #fff; cursor: pointer;
    transition: background .12s ease, transform .08s ease;
}
.call-btn:hover { background: #384360; }
.call-btn:active { transform: scale(.94); }
.call-btn--off { background: #4a5268; color: #c4cbd9; }
/* Sharing is a state worth seeing at a glance — it is the one control that keeps
   broadcasting after you have looked away from the window. */
.call-btn--on { background: #2f7de1; }
.call-btn--on:hover { background: #2a6ec8; }
.call-btn--accept { background: #22a06b; }
.call-btn--accept:hover { background: #1c8a5b; }
.call-btn--decline { background: #d64550; }
.call-btn--decline:hover { background: #bb3a44; }
/* The ringing card sits on white, so its buttons need their own resting colour. */
.call-ring .call-btn { box-shadow: 0 2px 8px rgba(23, 30, 52, .18); }

.call-toast {
    position: fixed; right: 20px; bottom: 20px; z-index: 3000;
    max-width: 300px; padding: 11px 14px; border-radius: 10px;
    background: #1e2436; color: #fff; font-size: 12.5px; cursor: pointer;
    box-shadow: 0 10px 26px rgba(23, 30, 52, .22);
}
</style>
