<template>
    <!--
        The project's AI developer. One window: pick a chat, give an instruction, it
        works on the project's repository and replies here. No task anywhere in the
        flow — a chat is its own thread.

        The thread itself is DevelopmentChat, the same component the task tab uses,
        addressed by conversationId instead of taskId. Teleported to body so the
        overlay isn't trapped by the list's scroll/transform containers.
    -->
    <Teleport to="body">
        <div v-if="modelValue" class="pdc__overlay" @click.self="close()">
            <div class="pdc__shell" :class="{ 'pdc--detail': !!activeId }">
                <aside class="pdc__rail">
                    <div class="pdc__rail-head">
                        <div class="pdc__rail-id">
                            <div class="pdc__rail-title">{{ $t('DevAgent.ai_developer') }}</div>
                            <div class="pdc__rail-sub" :title="projectData?.ProjectName">{{ projectData?.ProjectName }}</div>
                        </div>
                        <button class="pdc__x pdc__x--rail" :aria-label="$t('Projects.close')" @click="close()">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                                stroke-linecap="round" aria-hidden="true">
                                <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
                            </svg>
                        </button>
                    </div>

                    <button class="pdc__new" @click="newChat()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                            stroke-linecap="round" aria-hidden="true">
                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        {{ $t('DevAgent.new_chat') }}
                    </button>

                    <div v-if="chats.length > 6" class="pdc__search">
                        <input v-model="filter" type="text" class="pdc__search-input" :placeholder="$t('DevAgent.find_a_chat')">
                    </div>

                    <div class="pdc__convs">
                        <div v-if="loading && !chats.length" class="pdc__rail-note">{{ $t('DevAgent.loading_chats') }}</div>
                        <div v-else-if="railErr" class="pdc__rail-err">{{ railErr }}</div>
                        <div v-else-if="!chats.length" class="pdc__rail-note">{{ $t('DevAgent.no_chats_yet') }}</div>
                        <div v-else-if="!shown.length" class="pdc__rail-note">{{ $t('DevAgent.no_chat_matches') }}</div>
                        <div
                            v-for="c in shown"
                            :key="c.conversationId"
                            class="pdc__conv"
                            :class="{ 'pdc__conv--on': c.conversationId === activeId }"
                            :title="rowTitle(c)"
                            @click="activeId = c.conversationId"
                        >
                            <span class="pdc__dot" :class="dotClass(c)"></span>
                            <span class="pdc__conv-name">{{ titleOf(c) }}</span>
                            <button
                                class="pdc__conv-del"
                                :title="$t('DevAgent.delete_chat')"
                                :aria-label="$t('DevAgent.delete_chat')"
                                @click.stop="askDelete(c)"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                                    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M4 7h16M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7M6.5 7l.8 12.2a.9.9 0 0 0 .9.8h7.6a.9.9 0 0 0 .9-.8L17.5 7" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <div class="pdc__rail-foot">{{ $t('DevAgent.rail_hint') }}</div>
                </aside>

                <section class="pdc__main">
                    <div class="pdc__head">
                        <button class="pdc__back" :aria-label="$t('DevAgent.all_chats')" @click="activeId = ''">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <polyline points="15 18 9 12 15 6" />
                            </svg>
                        </button>
                        <div class="pdc__head-text">
                            <div class="pdc__head-title">{{ active ? titleOf(active) : $t('DevAgent.ai_developer') }}</div>
                        </div>
                        <button class="pdc__x" :aria-label="$t('Projects.close')" @click="close()">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                                stroke-linecap="round" aria-hidden="true">
                                <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
                            </svg>
                        </button>
                    </div>

                    <ClaudeAuthStatus v-if="modelValue" class="pdc__auth" variant="banner" />

                    <div class="pdc__body">
                        <!-- keyed on the chat: switching remounts, so the poll and the draft
                             belong to the thread on screen and never leak across -->
                        <DevelopmentChat
                            v-if="activeId"
                            :key="activeId"
                            :conversationId="activeId"
                            :projectId="projectId"
                        />
                        <div v-else class="pdc__blank">
                            <div class="pdc__blank-mark">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
                                    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5 8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />
                                </svg>
                            </div>
                            <p class="pdc__blank-lead">{{ chats.length ? $t('DevAgent.pick_a_chat') : $t('DevAgent.no_chats_lead') }}</p>
                            <p class="pdc__blank-hint">{{ $t('DevAgent.no_chats_hint') }}</p>
                            <button class="pdc__blank-cta" @click="newChat()">{{ $t('DevAgent.new_chat') }}</button>
                        </div>
                    </div>
                </section>
            </div>

            <ConfirmDelete
                v-if="pendingDelete"
                :title="$t('DevAgent.delete_chat')"
                :description="deleteDescription"
                :confirmLabel="$t('DevAgent.delete_confirm')"
                :cancelLabel="$t('Projects.cancel')"
                :busy="deleting"
                @confirm="confirmDelete()"
                @cancel="pendingDelete = null"
            />
        </div>
    </Teleport>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount, defineProps, defineEmits } from 'vue';
import { useI18n } from 'vue-i18n';
import DevelopmentChat from '@/components/organisms/Development/DevelopmentChat.vue';
import ClaudeAuthStatus from '@/components/molecules/ClaudeAuthStatus/ClaudeAuthStatus.vue';
import ConfirmDelete from '@/components/atom/ConfirmDelete/ConfirmDelete.vue';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';

const props = defineProps({
    modelValue: { type: Boolean, default: false },
    projectData: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['update:modelValue']);
const toast = useToast();
const { t } = useI18n();

const BASE = '/api/v2/dev-agent';
const RAIL_POLL_MS = 10000;

const saved = ref([]);
// A chat the user has started but not yet sent anything in. It exists only here
// until the first message is sent — the same as a new chat in a desktop client —
// so it has to survive the poll that only knows about stored chats.
const draft = ref(null);
const activeId = ref('');
const filter = ref('');
const loading = ref(false);
const railErr = ref('');
const pendingDelete = ref(null);
const deleting = ref(false);
let timer = null;

const projectId = computed(() => String(props.projectData?._id || ''));

const chats = computed(() => (draft.value ? [draft.value, ...saved.value] : saved.value));
const active = computed(() => chats.value.find((c) => c.conversationId === activeId.value) || null);
const shown = computed(() => {
    const q = filter.value.trim().toLowerCase();
    if (!q) return chats.value;
    return chats.value.filter((c) => `${c.title} ${c.lastText}`.toLowerCase().includes(q));
});

const statusLabel = (s) => ({
    awaiting_repo: 'needs repo',
    awaiting_approval: 'needs approval',
    pending: 'queued',
    working: 'working',
    awaiting_pr: 'needs PR approval',
    pending_pr: 'opening PR',
    cancelling: 'stopping',
    cancelled: 'cancelled',
    done: 'done',
    error: 'error',
}[s] || s);

const oneLine = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 140);

/* The list shows a title and nothing else, so the state that used to sit in a chip
 * and the detail that sat in a preview line move into one dot and the row's tooltip.
 * A running or failed chat still has to be visible without opening it. */
const dotClass = (c) => {
    if (!c) return '';
    if (c.status === 'error') return 'is-error';
    if (c.isActive) return 'is-live';
    return '';
};
const rowTitle = (c) => {
    if (!c) return '';
    const bits = [titleOf(c)];
    if (c.status) bits.push(statusLabel(c.status));
    if (c.lastAt) bits.push(shortWhen(c.lastAt));
    if (c.lastText) bits.push(`${c.lastRole === 'agent' ? `${t('DevAgent.ai_short')}: ` : ''}${oneLine(c.lastText)}`);
    return bits.filter(Boolean).join(' · ');
};

/* A chat is titled by its first instruction. A chat opened with only an attachment
 * has no text to take a title from, so it falls back to the file — otherwise every
 * such chat is called "New chat" forever and none of them can be told apart. */
const titleOf = (c) => oneLine(c && c.title).slice(0, 70)
    || (c && c.firstAttachment ? c.firstAttachment : '')
    || 'New chat';

const shortWhen = (iso) => {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (!then) return '';
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.round(hrs / 24);
    if (days < 7) return `${days}d`;
    return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/* Minted here rather than server-side so "New chat" costs no round trip and an
 * abandoned chat leaves nothing behind. Hex, which the server's id shape accepts. */
const mintId = () => {
    const bytes = new Uint8Array(12);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const loadRail = async (first) => {
    if (!projectId.value) return;
    if (first) { loading.value = true; railErr.value = ''; }
    try {
        const body = (await apiRequest('get', `${BASE}/conversations?projectId=${encodeURIComponent(projectId.value)}`))?.data;
        if (body && body.status) {
            saved.value = Array.isArray(body.data) ? body.data : [];
            railErr.value = '';
            // Once the first message lands the chat is stored, so the local
            // placeholder has done its job.
            if (draft.value && saved.value.some((c) => c.conversationId === draft.value.conversationId)) draft.value = null;
            // Still runs on every poll: a chat deleted elsewhere must release the pane.
            if (activeId.value && !chats.value.some((c) => c.conversationId === activeId.value)) activeId.value = '';
            // Auto-select ONLY on open. On every poll it fought the user: going back to
            // the list, or holding the blank pane, undid itself within 10 seconds — and
            // since the rail is sorted by last activity, it threw you into whichever
            // chat the agent had just posted in.
            if (first && !activeId.value && saved.value.length) activeId.value = saved.value[0].conversationId;
        } else if (first) {
            railErr.value = (body && (body.statusText || body.message)) || 'Could not load the chats.';
        }
    } catch (e) {
        if (first) {
            railErr.value = (e && e.response && e.response.data && (e.response.data.statusText || e.response.data.message))
                || (e && e.message) || 'Could not load the chats.';
        }
    } finally {
        if (first) loading.value = false;
    }
};

const newChat = () => {
    // Reuse an empty chat rather than stacking up placeholders.
    if (draft.value) { activeId.value = draft.value.conversationId; return; }
    draft.value = { conversationId: mintId(), title: '', firstAttachment: '', lastText: '', lastRole: 'user', lastAt: null, count: 0, status: '', isActive: false };
    activeId.value = draft.value.conversationId;
    filter.value = '';
};

const deleteDescription = computed(() => {
    const c = pendingDelete.value;
    if (!c) return '';
    const n = Number(c.count) || 0;
    return `"${titleOf(c)}" and its ${n === 1 ? '1 message' : `${n} messages`} will be deleted, along with any files sent in it. This cannot be undone.`;
});

const askDelete = (c) => {
    // A chat that was never sent has nothing stored, so it just goes away.
    if (draft.value && c.conversationId === draft.value.conversationId && !c.count) {
        if (activeId.value === c.conversationId) activeId.value = '';
        draft.value = null;
        return;
    }
    pendingDelete.value = c;
};

const confirmDelete = async () => {
    const c = pendingDelete.value;
    if (!c || deleting.value) return;
    deleting.value = true;
    try {
        const body = (await apiRequest('post', `${BASE}/conversation/delete`, { conversationId: c.conversationId }))?.data;
        if (body && body.status) {
            saved.value = saved.value.filter((x) => x.conversationId !== c.conversationId);
            if (activeId.value === c.conversationId) activeId.value = '';
            pendingDelete.value = null;
            toast.success('Chat deleted', { position: 'top-right', duration: 2500 });
        } else {
            // The server refuses while the agent is mid-run, and says why — show that
            // rather than a generic failure.
            toast.error((body && (body.statusText || body.message)) || 'Could not delete the chat', { position: 'top-right', duration: 5000 });
            pendingDelete.value = null;
        }
    } catch (e) {
        toast.error((e && e.response && e.response.data && (e.response.data.statusText || e.response.data.message))
            || (e && e.message) || 'Could not delete the chat', { position: 'top-right', duration: 5000 });
        pendingDelete.value = null;
    } finally {
        deleting.value = false;
    }
};

const close = () => emit('update:modelValue', false);

// The confirm owns Escape while it is open, so one press closes the dialog
// rather than the whole window behind it.
const onKey = (e) => { if (e.key === 'Escape' && !pendingDelete.value) close(); };

const stop = () => {
    if (timer) { clearInterval(timer); timer = null; }
    document.removeEventListener('keydown', onKey);
};

watch(() => props.modelValue, (open) => {
    stop();
    if (!open) return;
    saved.value = [];
    draft.value = null;
    activeId.value = '';
    filter.value = '';
    pendingDelete.value = null;
    loadRail(true);
    timer = setInterval(() => loadRail(false), RAIL_POLL_MS);
    document.addEventListener('keydown', onKey);
}, { immediate: true });

onBeforeUnmount(stop);
</script>

<style scoped>
.pdc__overlay {
    position: fixed;
    inset: 0;
    /* Teleported to <body>, outside #app — so the app's `#app { font-family: 'Roboto' }`
       doesn't reach it and text falls back to the browser serif. Set it explicitly. */
    font-family: 'Roboto', sans-serif;
    background: rgba(20, 22, 40, 0.55);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1200;
    padding: 16px;
}
.pdc__shell {
    /* The rail header carries two lines (name + project) and the thread header one,
       so left to themselves they resolve to different heights and the rule between
       them steps instead of running straight across. Both take this height. */
    --pdc-head-h: 57px;
    background: #fff;
    color: #1f2333;
    border-radius: 14px;
    width: min(1440px, 96vw);
    height: min(920px, 94vh);
    display: flex;
    overflow: hidden;
    box-shadow: 0 24px 60px rgba(28, 26, 80, 0.28);
}

/* rail */
.pdc__rail {
    width: 288px;
    flex: 0 0 288px;
    border-right: 1px solid #e9eaf2;
    background: #fafbff;
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.pdc__rail-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    height: var(--pdc-head-h);
    box-sizing: border-box;
    flex: 0 0 auto;
    padding: 8px 14px;
    border-bottom: 1px solid #e9eaf2;
}
.pdc__rail-id { min-width: 0; }
.pdc__rail-title { font-size: 14px; font-weight: 500; color: #1f2333; }
.pdc__rail-sub {
    font-size: 12px;
    color: #9aa0b4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.pdc__new {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    margin: 12px 12px 4px;
    border: 1px solid #d7d9e6;
    border-radius: 9px;
    background: #fff;
    color: #2f3990;
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 500;
    padding: 8px 10px;
    cursor: pointer;
}
.pdc__new svg { width: 13px; height: 13px; }
.pdc__new:hover { background: #f2f3fb; border-color: #b9c0ea; }

.pdc__search { padding: 8px 12px 4px; }
.pdc__search-input {
    width: 100%;
    border: 1px solid #dfe2f0;
    border-radius: 8px;
    background: #fff;
    padding: 7px 10px;
    font-size: 12.5px;
    color: #3b4252;
    font-family: inherit;
}
.pdc__search-input:focus { outline: none; border-color: #7b8ce0; }

.pdc__convs { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 3px; }
.pdc__rail-note, .pdc__rail-err { padding: 14px 8px; font-size: 12.5px; color: #9aa0b4; line-height: 1.5; }
.pdc__rail-err { color: #c0392b; }

/* One line per chat, the way a desktop chat client lists them: no card, no border,
   no preview line, no timestamp. Everything that used to be printed on the row is in
   its tooltip instead, so the list stays scannable at a glance. */
.pdc__conv {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    text-align: left;
    border: 0;
    border-radius: 6px;
    background: none;
    padding: 7px 9px;
    cursor: pointer;
    font-family: inherit;
    min-width: 0;
}
.pdc__conv:hover { background: #eef0f8; }
.pdc__conv--on { background: #e7eaf6; }
.pdc__conv-name {
    flex: 1;
    font-size: 13px;
    color: #2f3444;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
/* State without a chip: grey normally, amber while the agent is working, red if the
   turn failed. The row's tooltip spells it out. */
.pdc__dot {
    width: 6px;
    height: 6px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: #c3c8d8;
}
.pdc__dot.is-live { background: #b7791f; }
.pdc__dot.is-error { background: #c0392b; }
@media (prefers-reduced-motion: no-preference) {
    .pdc__dot.is-live { animation: pdc-pulse 1.4s ease-in-out infinite; }
}
.pdc__conv-del {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
    margin-right: -4px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: #b0b5c7;
    cursor: pointer;
    padding: 0;
    opacity: 0;
    transition: opacity .12s ease;
}
.pdc__conv-del svg { width: 13px; height: 13px; }
.pdc__conv:hover .pdc__conv-del, .pdc__conv--on .pdc__conv-del { opacity: 1; }
.pdc__conv-del:hover { background: #fdeceb; color: #c0392b; }
.pdc__conv-del:focus-visible { opacity: 1; outline: 2px solid #7b8ce0; outline-offset: 1px; }
/* A pointer device is what reveals the action on hover; without one it has to stay put. */
@media (hover: none) {
    .pdc__conv-del { opacity: 1; }
}
@keyframes pdc-pulse { 50% { opacity: .25; } }

.pdc__rail-foot {
    padding: 10px 14px;
    border-top: 1px solid #e9eaf2;
    font-size: 11px;
    color: #9aa0b4;
    line-height: 1.5;
}

/* main */
.pdc__main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.pdc__head {
    display: flex;
    align-items: center;
    gap: 10px;
    height: var(--pdc-head-h);
    box-sizing: border-box;
    flex: 0 0 auto;
    padding: 8px 16px;
    border-bottom: 1px solid #e9eaf2;
}
.pdc__head-text { flex: 1; min-width: 0; }
.pdc__head-title {
    font-size: 14px;
    font-weight: 500;
    color: #1f2333;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.pdc__x, .pdc__back {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    flex: 0 0 auto;
    border: 0;
    border-radius: 8px;
    background: none;
    color: #7c8195;
    cursor: pointer;
    padding: 0;
}
.pdc__x svg, .pdc__back svg { width: 15px; height: 15px; }
.pdc__x:hover, .pdc__back:hover { background: #f2f3f9; color: #2f3990; }
.pdc__x--rail { display: none; }
.pdc__back { display: none; }

.pdc__body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0 16px 12px; }

/* Placement only. ClaudeAuthStatus brings its own appearance, so styling it from
   here as well would fight it — the parent just says where it sits. */
.pdc__auth { margin: 12px 16px 0; }

.pdc__blank {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 24px;
}
.pdc__blank-mark { color: #b9c0ea; margin-bottom: 12px; }
.pdc__blank-mark svg { width: 40px; height: 40px; }
.pdc__blank-lead { font-size: 14px; color: #3b4252; margin: 0 0 6px; max-width: 44ch; line-height: 1.55; }
.pdc__blank-hint { font-size: 12.5px; color: #9aa0b4; margin: 0 0 16px; max-width: 46ch; line-height: 1.55; }
.pdc__blank-cta {
    border: 0;
    border-radius: 9px;
    background: #2f3a8f;
    color: #fff;
    font-family: inherit;
    font-size: 13px;
    padding: 9px 20px;
    cursor: pointer;
}
.pdc__blank-cta:hover { background: #26307a; }

/* Master-detail on a phone: the rail IS the screen until a chat is picked. */
@media (max-width: 767px) {
    .pdc__overlay { padding: 0; }
    .pdc__shell { width: 100vw; height: 100vh; border-radius: 0; }
    .pdc__rail { width: 100%; flex: 1 1 auto; border-right: 0; }
    .pdc__main { display: none; }
    .pdc__x--rail { display: flex; }
    .pdc--detail .pdc__rail { display: none; }
    .pdc--detail .pdc__main { display: flex; }
    .pdc__back { display: flex; }
}
</style>
