<template>
    <!--
        Whether this developer's paired computer can actually do any work: is a runner
        connected, and is Claude Code on it signed in.

        Signing in used to mean opening a terminal and typing /login, which most people
        will never know to do. The runner is already on their machine, so it can open
        the browser for them — this is the button that asks it to.

        Two shapes of the same thing:
          banner — only appears when something is wrong (the chat window)
          row    — always states where things stand (settings, where you came to check)
    -->
    <div v-if="variant === 'row' || notice" class="cas" :class="[`cas--${variant}`, `is-${tone}`]">
        <span v-if="variant === 'row'" class="cas__dot" :class="`is-${tone}`"></span>
        <div class="cas__text">
            <div class="cas__head">{{ head }}</div>
            <div class="cas__sub">{{ sub }}</div>
            <a v-if="state.signInUrl && !state.loggedIn" :href="state.signInUrl" target="_blank" rel="noopener" class="cas__link">
                {{ state.signInUrl }}
            </a>
        </div>
        <button
            v-if="canSignIn"
            class="cas__btn"
            :disabled="signingIn"
            @click="signIn()"
        >{{ signingIn ? $t('DevAgent.signing_in') : $t('DevAgent.sign_in') }}</button>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, defineProps } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';

defineProps({
    // 'banner' stays silent when all is well; 'row' always reports.
    variant: { type: String, default: 'banner' },
});

const { t } = useI18n();
const toast = useToast();

const BASE = '/api/v2/dev-agent';
const POLL_MS = 4000;

const state = ref({ online: false, loggedIn: false, authMethod: 'unknown', signInPending: false, signInUrl: '' });
const loaded = ref(false);
const signingIn = ref(false);
let timer = null;

const load = async () => {
    try {
        const body = (await apiRequest('get', `${BASE}/runner-state`))?.data;
        if (body && body.status && body.data) {
            state.value = { ...state.value, ...body.data };
            // The browser flow finished elsewhere — stop showing the spinner.
            if (state.value.loggedIn) signingIn.value = false;
        }
    } catch (e) {
        // Keep the last known answer rather than flickering between states.
    } finally {
        loaded.value = true;
    }
};

/* Only three things can be true, and each needs a different sentence. Silence is the
 * fourth: a connected, signed-in machine is not worth a banner. */
const notice = computed(() => {
    if (!loaded.value) return null;
    if (!state.value.online) return 'offline';
    if (!state.value.loggedIn) return 'signedout';
    return null;
});

const tone = computed(() => {
    if (!loaded.value) return 'idle';
    if (!state.value.online) return 'warn';
    return state.value.loggedIn ? 'ok' : 'warn';
});

const methodLabel = computed(() => {
    const m = String(state.value.authMethod || '');
    if (m === 'claudeai') return t('DevAgent.method_subscription');
    if (m === 'console') return t('DevAgent.method_console');
    return m && m !== 'unknown' ? m : '';
});

const head = computed(() => {
    if (!loaded.value) return t('DevAgent.checking');
    if (!state.value.online) return t('DevAgent.no_computer_head');
    if (!state.value.loggedIn) return t('DevAgent.not_signed_in_head');
    return t('DevAgent.signed_in_head');
});

const sub = computed(() => {
    if (!loaded.value) return '';
    if (!state.value.online) return t('DevAgent.no_computer_sub');
    if (!state.value.loggedIn) {
        return state.value.signInPending ? t('DevAgent.sign_in_pending') : t('DevAgent.not_signed_in_sub');
    }
    return methodLabel.value
        ? `${t('DevAgent.signed_in_sub')} · ${methodLabel.value}`
        : t('DevAgent.signed_in_sub');
});

// Only offer it when there is a machine to open a browser on.
const canSignIn = computed(() => loaded.value && state.value.online && !state.value.loggedIn);

const signIn = async () => {
    if (signingIn.value) return;
    signingIn.value = true;
    try {
        const body = (await apiRequest('post', `${BASE}/auth-login`, {}))?.data;
        if (body && body.status === false) {
            toast.error(body.statusText || t('DevAgent.sign_in_failed'), { position: 'top-right', duration: 6000 });
            signingIn.value = false;
            return;
        }
        toast.success(t('DevAgent.sign_in_opening'), { position: 'top-right', duration: 4000 });
        await load();
    } catch (e) {
        toast.error((e && e.message) || t('DevAgent.sign_in_failed'), { position: 'top-right', duration: 6000 });
        signingIn.value = false;
    }
};

/* Polls rather than waits for an event, so signing out in a terminal is reflected
 * here too — the runner re-reads the CLI and the status follows within seconds. */
onMounted(() => { load(); timer = setInterval(load, POLL_MS); });
onBeforeUnmount(() => { if (timer) { clearInterval(timer); timer = null; } });
</script>

<style scoped>
.cas {
    display: flex;
    align-items: center;
    gap: 14px;
}
.cas__text { flex: 1; min-width: 0; }
.cas__head { font-size: 13px; font-weight: 500; }
.cas__sub { font-size: 12px; margin-top: 2px; line-height: 1.45; }
.cas__link { display: block; font-size: 11.5px; color: #2f3990; margin-top: 5px; word-break: break-all; }
.cas__btn {
    flex: 0 0 auto;
    border: 0;
    border-radius: 8px;
    background: #2f3a8f;
    color: #fff;
    font-family: inherit;
    font-size: 12.5px;
    padding: 8px 16px;
    cursor: pointer;
}
.cas__btn:hover:not(:disabled) { background: #26307a; }
.cas__btn:disabled { opacity: .55; cursor: default; }

/* banner — the chat window, only when something needs doing */
.cas--banner {
    padding: 11px 14px;
    border: 1px solid #e6d3a3;
    border-radius: 10px;
    background: #fdf8ec;
}
.cas--banner .cas__head { color: #7a5c14; }
.cas--banner .cas__sub { color: #8a7440; }

/* row — settings, where the point is to state the position either way */
.cas--row {
    padding: 12px 14px;
    border: 1px solid #e9eaf2;
    border-radius: 10px;
    background: #fafbff;
}
.cas--row .cas__head { color: #1f2333; }
.cas--row .cas__sub { color: #6b7280; }
.cas__dot {
    width: 8px;
    height: 8px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: #c3c8d8;
}
.cas__dot.is-ok { background: #1c7a43; }
.cas__dot.is-warn { background: #b7791f; }
</style>
