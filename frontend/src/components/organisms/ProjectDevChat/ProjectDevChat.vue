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
                        <button class="pdc__new" :title="$t('DevAgent.new_chat')"
                            :aria-label="$t('DevAgent.new_chat')" @click="newChat()">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                                stroke-linecap="round" aria-hidden="true">
                                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                        </button>
                        <button class="pdc__x pdc__x--rail" :aria-label="$t('Projects.close')" @click="close()">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                                stroke-linecap="round" aria-hidden="true">
                                <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
                            </svg>
                        </button>
                    </div>

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
                            <input
                                v-if="renamingId === c.conversationId"
                                ref="renameInputEl"
                                v-model="renameDraft"
                                class="pdc__conv-rename"
                                maxlength="120"
                                placeholder="Name this chat"
                                @click.stop
                                @blur="commitRename"
                                @keydown.enter.prevent="commitRename"
                                @keydown.esc.stop.prevent="cancelRename"
                            />
                            <span v-else class="pdc__conv-name">{{ titleOf(c) }}</span>
                            <button
                                v-if="renamingId !== c.conversationId"
                                class="pdc__conv-act"
                                :class="{ 'is-open': menuId === c.conversationId }"
                                title="Chat actions"
                                aria-label="Chat actions"
                                :aria-expanded="menuId === c.conversationId"
                                @click.stop="openMenu(c, $event)"
                            >
                                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
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
                            <!-- DevelopmentChat teleports its repository summary in here, so the
                                 thread's title and the code it runs against read as one line. -->
                            <div id="pdc-repo-slot" class="pdc__repo-slot"></div>
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
                            repo-target="#pdc-repo-slot"
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

            <!-- Row actions. Fixed and positioned from the button's rect because the rail
                 scrolls: anything absolutely positioned inside a row gets clipped by it. -->
            <template v-if="menuId">
                <div class="pdc__menu-veil" @click="closeMenu" @contextmenu.prevent="closeMenu"></div>
                <div class="pdc__menu" :style="{ top: `${menuPos.top}px`, right: `${menuPos.right}px` }" role="menu">
                    <button class="pdc__menu-item" role="menuitem" @click="menuRename">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                        </svg>
                        Rename
                    </button>
                    <button class="pdc__menu-item is-danger" role="menuitem" @click="menuDelete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M4 7h16M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7M6.5 7l.8 12.2a.9.9 0 0 0 .9.8h7.6a.9.9 0 0 0 .9-.8L17.5 7" />
                        </svg>
                        Delete
                    </button>
                </div>
            </template>
        </div>
    </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount, defineProps, defineEmits } from 'vue';
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
/* Trim on a word boundary. A hard slice ended titles mid-word ("…what is you apporach
 * a"), which reads as a rendering fault rather than a shortened sentence; CSS ellipsis
 * still handles whatever overflows the rail or the header after this. */
const titleOf = (c) => {
    const t = oneLine(c && c.title);
    const short = t.length > 70 ? `${t.slice(0, 70).replace(/\s+\S*$/, '')}…` : t;
    return short
        || (c && c.firstAttachment ? c.firstAttachment : '')
        || 'New chat';
};

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

/* Row actions menu.
 *
 * Local rather than the shared DropDown: that one teleports into #my-dropdown inside
 * #app, while this window is teleported to <body> above it, and it becomes a
 * full-screen sheet under 768px — neither suits a two-item row menu. It lives inside
 * the overlay so it inherits the font and the overlay's stacking context. */
const MENU_H = 88;
const menuId = ref('');
const menuPos = ref({ top: 0, right: 0 });

const closeMenu = () => { menuId.value = ''; };

const openMenu = (c, e) => {
    if (menuId.value === c.conversationId) { closeMenu(); return; }
    const r = e.currentTarget.getBoundingClientRect();
    // Flip above the button when there is no room below, and never leave the viewport.
    const below = r.bottom + 4;
    const top = below + MENU_H > window.innerHeight - 8 ? Math.max(8, r.top - MENU_H - 4) : below;
    // Anchored by its RIGHT edge, so the menu can size to its content: pinning `left`
    // would need the width up front, which is what forced a fixed one before.
    menuPos.value = { top: Math.round(top), right: Math.round(Math.max(8, window.innerWidth - r.right)) };
    menuId.value = c.conversationId;
};

const menuChat = computed(() => chats.value.find((c) => c.conversationId === menuId.value) || null);
const menuRename = () => { const c = menuChat.value; closeMenu(); if (c) startRename(c); };
const menuDelete = () => { const c = menuChat.value; closeMenu(); if (c) askDelete(c); };

/* Renaming a chat.
 *
 * The draft chat is deliberately excluded: nothing is stored until its first message
 * is sent, so there is no document to carry a name yet. Sending one and renaming
 * afterwards works normally. */
const renamingId = ref('');
const renameDraft = ref('');
const renameInputEl = ref(null);
const renaming = ref(false);

const startRename = async (c) => {
    if (draft.value && c.conversationId === draft.value.conversationId && !c.count) {
        toast.info('Send a message first, then you can name this chat', { position: 'top-right', duration: 3000 });
        return;
    }
    renamingId.value = c.conversationId;
    // The raw title, not titleOf() — that one is shortened for display and ends in an
    // ellipsis, which would otherwise be saved as part of the name.
    renameDraft.value = oneLine(c.title).slice(0, 120);
    await nextTick();
    // A ref inside v-for resolves to an array.
    const el = Array.isArray(renameInputEl.value) ? renameInputEl.value[0] : renameInputEl.value;
    if (el) { el.focus(); el.select(); }
};

const cancelRename = () => { renamingId.value = ''; renameDraft.value = ''; };

const commitRename = async () => {
    const id = renamingId.value;
    if (!id || renaming.value) return;
    const title = renameDraft.value.replace(/\s+/g, ' ').trim().slice(0, 120);
    const row = saved.value.find((x) => x.conversationId === id);
    if (!row || title === oneLine(row.title).slice(0, 120)) { cancelRename(); return; }
    renaming.value = true;
    try {
        const body = (await apiRequest('post', `${BASE}/conversation/rename`, { conversationId: id, title }))?.data;
        if (body && body.status) {
            // Reload rather than patch the row: clearing the name hands the chat back to
            // its derived title, which only the server can work out.
            await loadRail();
        } else {
            toast.error((body && (body.statusText || body.message)) || 'Could not rename the chat', { position: 'top-right', duration: 5000 });
        }
    } catch (e) {
        toast.error((e && e.response && e.response.data && (e.response.data.statusText || e.response.data.message))
            || (e && e.message) || 'Could not rename the chat', { position: 'top-right', duration: 5000 });
    } finally {
        renaming.value = false;
        cancelRename();
    }
};

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
const onKey = (e) => {
    if (e.key !== 'Escape') return;
    // Innermost thing first: one press should dismiss the menu, not the window under it.
    if (menuId.value) { closeMenu(); return; }
    if (pendingDelete.value || renamingId.value) return;
    close();
};

/* The menu is positioned from a rect, so any scroll or resize detaches it from its
   row. Capture phase, because the rail is a nested scroller. */
const onViewportChange = () => { if (menuId.value) closeMenu(); };

const stop = () => {
    if (timer) { clearInterval(timer); timer = null; }
    closeMenu();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onViewportChange);
    document.removeEventListener('scroll', onViewportChange, true);
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
    window.addEventListener('resize', onViewportChange);
    document.addEventListener('scroll', onViewportChange, true);
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
}
.pdc__shell {
    /* The rail header carries two lines (name + project) and the thread header one,
       so left to themselves they resolve to different heights and the rule between
       them steps instead of running straight across. Both take this height. */
    --pdc-head-h: 57px;
    background: #fff;
    color: #1f2333;
    border-radius: 0;
    width: 100%;
    height: 100%;
    display: flex;
    overflow: hidden;
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
.pdc__rail-id { flex: 1; min-width: 0; }
.pdc__rail-title { font-size: 14px; font-weight: 500; color: #1f2333; }
.pdc__rail-sub {
    font-size: 12px;
    color: #9aa0b4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
/* An icon in the rail header rather than a full-width bar: it is one action among the
   header's controls, and the width it used to take said otherwise. */
.pdc__new {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex: 0 0 auto;
    box-sizing: border-box;
    border: 0;
    border-radius: 7px;
    background: none;
    color: #2f3990;
    padding: 0;
    cursor: pointer;
}
.pdc__new svg { width: 16px; height: 16px; }
.pdc__new:hover { background: #e7eaf6; }
.pdc__new:focus-visible { outline: 2px solid #7b8ce0; outline-offset: 1px; }

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
.pdc__conv-act {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
    border: 0;
    border-radius: 5px;
    background: none;
    color: #b0b5c7;
    cursor: pointer;
    padding: 0;
    opacity: 0;
    transition: opacity .12s ease;
}
.pdc__conv-act:last-child { margin-right: -4px; }
.pdc__conv-act svg { width: 13px; height: 13px; }
.pdc__conv:hover .pdc__conv-act, .pdc__conv--on .pdc__conv-act { opacity: 1; }
.pdc__conv-act:hover, .pdc__conv-act.is-open { background: #dfe4f3; color: #3b4252; }
/* Its menu is open, so the trigger cannot fade out from under it. */
.pdc__conv-act.is-open { opacity: 1; }
.pdc__conv-act:focus-visible { opacity: 1; outline: 2px solid #7b8ce0; outline-offset: 1px; }
/* A pointer device is what reveals the action on hover; without one it has to stay put. */
@media (hover: none) {
    .pdc__conv-act { opacity: 1; }
}

.pdc__menu-veil { position: fixed; inset: 0; z-index: 20; }
.pdc__menu {
    position: fixed;
    z-index: 21;
    /* Sized by its widest item rather than a fixed width — see openMenu for why this
       is anchored on the right. */
    width: max-content;
    max-width: min(280px, calc(100vw - 16px));
    padding: 5px;
    border: 1px solid #e3e5f0;
    border-radius: 10px;
    background: #fff;
    box-shadow: 0 10px 28px rgba(28, 26, 80, .16);
}
.pdc__menu-item {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    text-align: left;
    white-space: nowrap;
    border: 0;
    border-radius: 6px;
    background: none;
    padding: 7px 12px 7px 9px;
    font-family: inherit;
    font-size: 13px;
    color: #2f3444;
    cursor: pointer;
}
.pdc__menu-item svg { width: 14px; height: 14px; flex: 0 0 auto; opacity: .65; }
.pdc__menu-item:hover { background: #f1f2f8; }
.pdc__menu-item.is-danger { color: #c0392b; }
.pdc__menu-item.is-danger:hover { background: #fdeceb; }
.pdc__conv-rename {
    flex: 1;
    min-width: 0;
    font-family: inherit;
    font-size: 13px;
    color: #2f3444;
    border: 1px solid #7b8ce0;
    border-radius: 5px;
    background: #fff;
    padding: 3px 7px;
    outline: none;
    box-shadow: 0 0 0 3px rgba(123, 140, 224, .14);
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
/* Title then repository, on one line. The title yields first so the repository pill
   stays whole — which of the two is truncated matters: a shortened sentence still
   reads, a shortened path does not tell you which checkout you are talking to. */
.pdc__head-text { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; }
.pdc__head-title {
    flex: 0 1 auto;
    min-width: 0;
    font-size: 14px;
    font-weight: 500;
    color: #1f2333;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.pdc__repo-slot { flex: 0 0 auto; display: flex; align-items: center; min-width: 0; }
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
