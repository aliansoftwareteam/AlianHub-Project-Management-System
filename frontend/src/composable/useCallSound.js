import { ref } from 'vue';

/**
 * Call tones (AHE-3839).
 *
 * Synthesised with the Web Audio API rather than played from an audio file. That is a
 * licensing decision as much as a technical one: shipping a ringtone in an AGPL-3.0 repo
 * means shipping something we hold redistribution rights to, and most "free ringtone"
 * downloads are not that. A generated tone has no such question, adds no binary, never
 * 404s, and loops without a seam.
 *
 * ── The autoplay problem ────────────────────────────────────────────────────────────
 * Browsers refuse to start audio on a page the user has not interacted with — which is
 * exactly an incoming call, since not touching the tab is why you need the ring. An
 * AudioContext may be CREATED at any time but starts suspended, and only a real user
 * gesture can resume it. So the first click or keypress anywhere in the app unlocks it
 * for the rest of the session. Anyone who has been using AlianHub has clicked something;
 * the case that stays silent is a tab loaded and never touched.
 */

const STORAGE_KEY = 'alianhub.callSound';
const muted = ref((() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'off'; } catch (e) { return false; }
})());

let ctx = null;
let loopTimer = null;

const ensureCtx = () => {
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    // Created before a gesture, a context starts suspended and stays silent until resumed.
    if (ctx.state === 'suspended') ctx.resume().catch(() => { /* still locked */ });
    return ctx;
};

/** Unlock on the first real gesture, then get out of the way. */
if (typeof window !== 'undefined') {
    const unlock = () => {
        ensureCtx();
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
}

/**
 * One pulse: a chord held for `duration`, faded in and out.
 *
 * The ramps are not decoration. Starting or stopping a sine at full amplitude produces a
 * step in the waveform, which is heard as a click at the start and end of every ring.
 */
const pulse = (freqs, duration, level) => {
    const c = ensureCtx();
    if (!c || c.state !== 'running') return;
    const now = c.currentTime;
    const gain = c.createGain();
    gain.connect(c.destination);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.02);
    gain.gain.setValueAtTime(level, now + Math.max(0.05, duration - 0.05));
    gain.gain.linearRampToValueAtTime(0, now + duration);

    freqs.forEach((f) => {
        const osc = c.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f;
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + duration + 0.02);
    });
};

const stop = () => {
    clearInterval(loopTimer);
    loopTimer = null;
};

const startLoop = (freqs, duration, level, everyMs) => {
    stop();
    if (muted.value) return;
    pulse(freqs, duration, level);
    loopTimer = setInterval(() => pulse(freqs, duration, level), everyMs);
};

// 440 + 480 Hz is the tone pair a desk phone rings on; two frequencies beat against each
// other and carry better than one, which is why telephones have always used a pair.
const startIncoming = () => startLoop([440, 480], 1.1, 0.16, 3000);
// The caller's own ringback: same cadence, quieter, so it reads as "still trying" rather
// than as another call coming in.
const startRingback = () => startLoop([440, 480], 1.0, 0.07, 3000);

/** Two notes rising — the call is up. */
const connected = () => {
    if (muted.value) return;
    pulse([523.25], 0.09, 0.12);
    setTimeout(() => pulse([659.25], 0.12, 0.12), 100);
};

/** Two notes falling — it is over. */
const ended = () => {
    if (muted.value) return;
    pulse([523.25], 0.09, 0.1);
    setTimeout(() => pulse([392], 0.14, 0.1), 100);
};

const setMuted = (value) => {
    muted.value = !!value;
    try { localStorage.setItem(STORAGE_KEY, muted.value ? 'off' : 'on'); } catch (e) { /* storage blocked */ }
    if (muted.value) stop();
};

const toggleMuted = () => setMuted(!muted.value);

export function useCallSound() {
    return { muted, startIncoming, startRingback, stop, connected, ended, setMuted, toggleMuted };
}
