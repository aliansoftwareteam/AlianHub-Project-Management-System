<template>
    <div class="ah-page ibx" @keydown="onKey">
        <aside class="ibx__side">
            <nav class="ibx__nav" role="tablist">
                <button
                    v-for="t in TABS"
                    :key="t"
                    type="button"
                    class="ibx__navitem"
                    :class="{ 'is-active': tab === t }"
                    role="tab"
                    :aria-selected="tab === t"
                    @click="switchTab(t)"
                >
                    <span>{{ $t('Inbox.tab_' + t) }}</span>
                    <span v-if="tabCount(t)" class="ibx__navcount">{{ tabCount(t) > 99 ? '99+' : tabCount(t) }}</span>
                </button>
            </nav>

            <div class="ibx__filters">
                <div class="ah-label ibx__label">{{ $t('Inbox.filter_label') }}</div>
                <button
                    v-for="k in KINDS"
                    :key="k"
                    type="button"
                    class="ibx__navitem ibx__navitem--kind"
                    :class="{ 'is-active': kind === k }"
                    @click="switchKind(k)"
                >{{ $t('Inbox.kind_' + k) }}</button>
            </div>

            <div class="ibx__side-foot">{{ $t('Inbox.footer_note') }}</div>
        </aside>

        <main class="ibx__main">
            <div class="ah-toolbar ibx__toolbar">
                <span class="ah-toolbar__title">{{ $t('Inbox.title') }}</span>
                <div class="ibx__tabs" role="tablist">
                    <button
                        v-for="t in TABS"
                        :key="t"
                        type="button"
                        class="ibx__tab"
                        :class="{ 'is-active': tab === t }"
                        role="tab"
                        @click="switchTab(t)"
                    >{{ $t('Inbox.tab_' + t) }} <span v-if="tabCount(t)" class="ibx__tabcount">{{ tabCount(t) }}</span></button>
                </div>
                <span class="ah-toolbar__spacer"></span>
                <span class="ibx__keys ah-mono">j k e</span>
                <button
                    v-if="tab !== 'done'"
                    type="button"
                    class="ibx__markall"
                    :disabled="busy || !hasUnread"
                    @click="markAllRead"
                >{{ $t('Inbox.mark_all_read') }}</button>
            </div>

            <div ref="listEl" class="ibx__list ah-scroll">
                <div v-if="loading" class="ibx__state">{{ $t('Inbox.loading') }}</div>

                <div v-else-if="loadError" class="ibx__state ibx__state--error">
                    {{ loadError }}
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="reload">{{ $t('Inbox.retry') }}</button>
                </div>

                <div v-else-if="!rows.length" class="ibx__zero">
                    <span class="ibx__zero-mark"><ShellIcon name="check" :size="22" /></span>
                    <div class="ibx__zero-title">{{ $t('Inbox.zero_' + tab) }}</div>
                    <div class="ibx__zero-sub">{{ $t('Inbox.zero_sub_' + tab) }}</div>
                    <button v-if="tab !== 'primary'" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="switchTab('primary')">{{ $t('Inbox.back_to_primary') }}</button>
                </div>

                <template v-else>
                    <article
                        v-for="(it, i) in rows"
                        :key="rowKey(it)"
                        class="ibx__card"
                        :class="[`is-${it.kind}`, { 'is-cursor': i === cursor, 'is-read': !it.unread, 'is-agent': it.agent, 'is-expanded': isExpanded(it) }]"
                        tabindex="0"
                        @focus="cursor = i"
                        @click="cursor = i"
                    >
                        <div class="ibx__head">
                            <span v-if="it.kind === 'reminder'" class="ibx__glyph ibx__glyph--reminder"><ShellIcon name="reminder" :size="12" /></span>
                            <span v-else-if="it.agent" class="ah-avatar ah-avatar--agent ah-avatar--sm"><ShellIcon name="agent" :size="12" /></span>
                            <span v-else-if="it.actorId && actorOf(it)" class="ibx__avatar" :title="actorName(it)">
                                <UserProfile :showDot="false" :isBorder="false" :data="{ image: actorImage(it), title: actorName(it) }" width="22px" thumbnail="40x40" />
                            </span>
                            <span v-else class="ibx__glyph" :class="glyphClass(it)"><ShellIcon :name="glyphIcon(it)" :size="12" /></span>

                            <span class="ibx__what">
                                <template v-if="it.kind === 'approval'">
                                    <strong>{{ actorName(it) || $t('Inbox.someone') }}</strong> {{ $t('Inbox.requested_off', { range: dateRange(it) }) }}
                                    <span class="ibx__dim">· {{ $t('Inbox.needs_your_approval') }}</span>
                                </template>
                                <template v-else-if="it.kind === 'proposal'">
                                    <strong>{{ it.agentName }}</strong> {{ $t('Inbox.wants_to') }} {{ it.what }}
                                    <span class="ibx__dim">· {{ $t('Inbox.needs_your_approval') }}</span>
                                </template>
                                <template v-else-if="it.kind === 'reminder'">
                                    <strong>{{ $t('Inbox.reminder') }}</strong> <span class="ibx__dim">· {{ it.unread ? $t('Inbox.due_now') : $t('Inbox.done') }}</span>
                                </template>
                                <template v-else-if="it.kind === 'mention'">
                                    <strong>{{ actorName(it) || $t('Inbox.someone') }}</strong> {{ it.mainChat ? $t('Inbox.mentioned_you_chat') : $t('Inbox.mentioned_you') }}
                                </template>
                                <template v-else>
                                    <strong v-if="actorName(it)">{{ actorName(it) }}</strong>
                                    <span v-else-if="it.taskName" class="ibx__strong">{{ it.taskName }}</span>
                                </template>
                            </span>
                            <span v-if="it.agent" class="ah-chip ah-chip--agent ah-chip--mono ibx__agent">{{ $t('Inbox.agent_tag') }}</span>
                            <time class="ibx__when" :title="it.createdAt">{{ stamp(it.createdAt) }}</time>
                        </div>

                        <div class="ibx__body">
                            <template v-if="it.kind === 'approval'">
                                <span v-if="it.ptoType" class="ah-chip ibx__chip">{{ ptoLabel(it.ptoType) }}</span>
                                <span v-if="it.reason" class="ibx__quote">"{{ it.reason }}"</span>
                            </template>
                            <template v-else-if="it.kind === 'proposal'">
                                <span class="ah-chip ah-chip--agent ibx__chip">{{ $t('Inbox.changes_n', { n: it.changes }) }}</span>
                                <span v-if="it.why" class="ibx__quote">"{{ it.why }}"</span>
                            </template>
                            <template v-else-if="it.kind === 'mention'">
                                <span class="ibx__quote">"<span v-html="render(it)"></span>"</span>
                                <span v-if="it.taskName" class="ibx__target" @click.stop="open(it)">· {{ it.taskName }}</span>
                            </template>
                            <template v-else>
                                <span v-html="render(it)"></span>
                                <span v-if="it.taskName && it.kind !== 'reminder'" class="ibx__target" @click.stop="open(it)">· {{ it.taskName }}</span>
                            </template>
                        </div>

                        <div v-if="isExpanded(it)" class="ibx__reply" @click.stop>
                            <textarea
                                :ref="(el) => setReplyRef(it, el)"
                                v-model="replyText"
                                class="ah-input ah-textarea ibx__reply-input"
                                :class="{ 'ah-input--error': replyError }"
                                rows="2"
                                :placeholder="$t('Inbox.reply_placeholder', { name: actorName(it) || $t('Inbox.someone') })"
                                @keydown.stop="onReplyKey($event, it)"
                            ></textarea>
                            <div v-if="replyError" class="ah-field__error">{{ replyError }}</div>
                            <div class="ibx__reply-actions">
                                <span class="ah-small ah-mono">⌘↵</span>
                                <span class="ah-toolbar__spacer"></span>
                                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="closeReply">{{ $t('Projects.cancel') }}</button>
                                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !replyText.trim()" @click="sendReply(it)">{{ $t('Inbox.send') }}</button>
                            </div>
                        </div>

                        <div class="ibx__actions" @click.stop>
                            <template v-if="it.kind === 'approval'">
                                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" @click="decide(it, 'approved')">{{ $t('Inbox.approve') }}</button>
                                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="decide(it, 'rejected')">{{ $t('Inbox.decline') }}</button>
                            </template>
                            <template v-else-if="it.kind === 'proposal'">
                                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" @click="decideProposal(it, 'approve')">{{ $t('Inbox.approve') }}</button>
                                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="decideProposal(it, 'decline')">{{ $t('Inbox.decline') }}</button>
                                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="openAiInbox">{{ $t('Inbox.open_ai_inbox') }}</button>
                            </template>
                            <template v-else-if="it.kind === 'reminder'">
                                <button v-if="it.unread" type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" @click="markDone(it)">{{ $t('Inbox.done') }}</button>
                                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="openReminders">{{ $t('Inbox.open_reminders') }}</button>
                            </template>
                            <template v-else-if="it.agent">
                                <button v-if="hasAiHub" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="reviewInAiInbox">{{ $t('Inbox.review_ai_inbox') }}</button>
                                <button v-if="it.unread" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="markDone(it)">{{ $t('Inbox.mark_done') }}</button>
                            </template>
                            <template v-else-if="it.kind === 'mention'">
                                <button v-if="!isExpanded(it) && canReply(it)" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="openReply(it)">{{ $t('Inbox.reply_here') }}</button>
                                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="open(it)">{{ it.mainChat ? $t('Inbox.open_chat') : $t('Inbox.open_task') }}</button>
                            </template>
                            <template v-else>
                                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="open(it)">{{ $t('Inbox.open') }}</button>
                            </template>

                            <button v-if="it.kind !== 'approval' && tab !== 'later' && it.unread" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="snooze(it)">{{ $t('Inbox.later') }}</button>
                            <button v-if="tab === 'later'" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="unsnooze(it)">{{ $t('Inbox.back_to_primary') }}</button>
                            <button v-if="it.kind !== 'approval' && it.kind !== 'reminder' && !it.agent && it.unread" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="markDone(it)">{{ $t('Inbox.mark_done') }}</button>
                            <button v-if="!it.unread && it.kind !== 'approval'" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="markUnread(it)">{{ $t('Inbox.mark_unread') }}</button>
                        </div>
                    </article>

                    <button v-if="hasMore" type="button" class="ah-btn ah-btn--secondary ah-btn--sm ibx__more" :disabled="busy" @click="loadMore">
                        {{ busy ? $t('Inbox.loading') : $t('Inbox.load_more') }}
                    </button>
                </template>

                <div class="ibx__foot">{{ $t('Inbox.footer_note') }}</div>
            </div>

            <transition name="ah-fade">
                <div v-if="undo" class="ibx__undo" role="status">
                    <span>{{ undo.text }}</span>
                    <button type="button" class="ibx__undo-btn" @click="runUndo">{{ $t('Inbox.undo') }}</button>
                </div>
            </transition>
        </main>
    </div>
</template>

<script setup>
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { useStore } from 'vuex';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import UserProfile from '@/components/atom/UserProfile/UserProfile.vue';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { useHelper } from '@/components/organisms/Header/helper';
import { openPanel } from '@/components/organisms/Shell/shellState';

defineOptions({ name: 'InboxPage' });

const TABS = ['primary', 'later', 'done'];
const KINDS = ['all', 'mention', 'approval', 'reminder', 'update'];
const UNDO_MS = 6000;

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const { changeText } = useCustomComposable();
const { getUser } = useGetterFunctions();
const { openRoute } = useHelper();
const companyId = inject('$companyId');
const userId = inject('$userId');

const tab = ref(TABS.includes(route.query.tab) ? route.query.tab : 'primary');
const kind = ref(KINDS.includes(route.query.kind) ? route.query.kind : 'all');
const items = ref([]);
const approvals = ref([]);
const counts = ref({ all: 0, primary: 0, approvals: 0 });
const loading = ref(true);
const busy = ref(false);
const loadError = ref('');
const hasMore = ref(false);
const nextSkip = ref(0);
const cursor = ref(0);
const listEl = ref(null);
const expanded = ref('');
const replyText = ref('');
const replyError = ref('');
const undo = ref(null);
let undoTimer = null;
let replyEl = null;

const hasAiHub = computed(() => router.hasRoute('AiHub'));

// Put aside for later. Held here, per person and per device: the rows themselves
// stay unread on the server, and Primary is told to leave these out.
const laterKey = computed(() => `alianhub.inbox.later.${companyId?.value || ''}.${userId?.value || ''}`);
const readLater = () => {
    try { return JSON.parse(window.localStorage.getItem(laterKey.value) || '{}') || {}; } catch (e) { return {}; }
};
const later = ref(readLater());
const writeLater = () => {
    try { window.localStorage.setItem(laterKey.value, JSON.stringify(later.value)); } catch (e) { /* session only */ }
};
const laterIds = computed(() => Object.keys(later.value).map((k) => k.split(':')[1]).filter(Boolean));

const rowKey = (it) => `${it.sourceType}:${it.sourceId}`;
const rows = computed(() => (tab.value === 'primary' ? [...approvals.value, ...items.value] : items.value));
const hasUnread = computed(() => rows.value.some((i) => i.unread && i.kind !== 'approval'));
const tabCount = (name) => {
    if (name === 'primary') return Math.max(0, Number(counts.value.primary || 0) - laterIds.value.length);
    if (name === 'later') return laterIds.value.length;
    return 0;
};

const actorOf = (it) => (it.actorId ? getUser(it.actorId) : null);
const actorImage = (it) => actorOf(it)?.Employee_profileImageURL || '';
const actorName = (it) => actorOf(it)?.Employee_Name || '';
const render = (it) => changeText(String(it.message || ''));
const isExpanded = (it) => expanded.value === rowKey(it);
const canReply = (it) => !!(it.taskId && it.projectId && it.sprintId && !it.mainChat);

const glyphIcon = (it) => {
    if (it.kind === 'mention') return 'at';
    if (/milestone/i.test(it.key || '')) return 'alert';
    if (/status/i.test(it.key || '')) return 'refresh';
    if (/comment/i.test(it.key || '')) return 'chat';
    return 'bell';
};
const glyphClass = (it) => (/milestone/i.test(it.key || '') && /missed|overdue/i.test(it.message || '') ? 'ibx__glyph--danger' : '');

const stamp = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((startOf(now) - startOf(d)) / 86400000);
    if (days <= 0) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (days < 7) return `${days}d`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
const dateRange = (it) => {
    const f = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
    const a = f(it.startDate); const b = f(it.endDate);
    return a === b || !b ? a : `${a}–${b}`;
};
const ptoLabel = (type) => t(`Pto.types.${type}`, type);

const loadCounts = async () => {
    try {
        const res = await apiRequest('get', `${env.INBOX}/counts`);
        if (res?.data?.status) counts.value = res.data.data || counts.value;
    } catch (e) { /* badges are decoration */ }
};

const load = async (append = false) => {
    if (!append) { loading.value = true; loadError.value = ''; }
    busy.value = true;
    try {
        const skip = append ? nextSkip.value : 0;
        const q = new URLSearchParams({ tab: tab.value, kind: kind.value, skip: String(skip), sort: 'newest' });
        if (tab.value === 'primary' && laterIds.value.length) q.set('exclude', laterIds.value.join(','));
        if (tab.value === 'later') q.set('ids', laterIds.value.join(','));
        const res = await apiRequest('get', `${env.INBOX}?${q.toString()}`);
        if (!res?.data?.status) {
            loadError.value = res?.data?.statusText || t('Inbox.load_failed');
            if (!append) { items.value = []; approvals.value = []; }
            return;
        }
        const d = res.data.data || {};
        items.value = append ? [...items.value, ...(d.items || [])] : (d.items || []);
        if (!append) approvals.value = [...(d.proposals || []), ...(d.approvals || [])];
        hasMore.value = !!d.hasMore;
        nextSkip.value = d.nextSkip || 0;
        if (!append) cursor.value = 0;
    } catch (e) {
        loadError.value = e?.message || t('Inbox.load_failed');
        if (!append) { items.value = []; approvals.value = []; }
    } finally {
        loading.value = false;
        busy.value = false;
    }
};

const reload = async () => { await Promise.all([load(false), loadCounts()]); };
const loadMore = () => load(true);

// A new arrival moves the per-user counters document; only a rise means a new row.
const liveCounts = computed(() => {
    const c = getters['users/myCounts']?.data || {};
    return [c.notification_counts, c.mention_counts];
});
let liveTimer = null;
let lastCounts = null;
watch(liveCounts, (next) => {
    const prev = lastCounts;
    lastCounts = next;
    if (!prev || !next.some((n, i) => Number(n || 0) > Number(prev[i] || 0))) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { if (!busy.value) reload(); }, 400);
}, { immediate: true });

const syncQuery = () => router.replace({ query: { ...route.query, tab: tab.value, kind: kind.value } }).catch(() => {});
const switchTab = (next) => {
    if (tab.value === next) return;
    tab.value = next;
    expanded.value = '';
    syncQuery();
    load(false);
};
const switchKind = (next) => {
    if (kind.value === next) return;
    kind.value = next;
    syncQuery();
    load(false);
};

const post = async (path, body) => {
    busy.value = true;
    try {
        const res = await apiRequest('post', `${env.INBOX}${path}`, body);
        if (!res?.data?.status) {
            $toast.error(res?.data?.statusText || t('Inbox.action_failed'), { position: 'top-right' });
            return false;
        }
        return true;
    } catch (e) {
        $toast.error(e?.message || t('Inbox.action_failed'), { position: 'top-right' });
        return false;
    } finally {
        busy.value = false;
    }
};

const removeRow = (it) => {
    items.value = items.value.filter((x) => rowKey(x) !== rowKey(it));
    approvals.value = approvals.value.filter((x) => rowKey(x) !== rowKey(it));
    nextSkip.value = Math.max(0, nextSkip.value - 1);
    cursor.value = Math.min(cursor.value, Math.max(0, rows.value.length - 1));
};

const setRead = async (it, read) => {
    const payload = { items: [{ sourceType: it.sourceType, sourceId: it.sourceId, duplicateIds: it.duplicateIds || [] }] };
    if (!read) payload.read = 'false';
    if (!(await post('/read', payload))) return false;
    loadCounts();
    return true;
};

const markDone = async (it) => {
    if (it.kind === 'approval') return;
    if (!(await setRead(it, true))) return;
    delete later.value[rowKey(it)];
    writeLater();
    if (tab.value === 'done') items.value = items.value.map((x) => (rowKey(x) === rowKey(it) ? { ...x, unread: false } : x));
    else removeRow(it);
};
const markUnread = async (it) => {
    if (!(await setRead(it, false))) return;
    if (tab.value === 'done') removeRow(it);
    else items.value = items.value.map((x) => (rowKey(x) === rowKey(it) ? { ...x, unread: true } : x));
};

const snooze = (it) => {
    later.value = { ...later.value, [rowKey(it)]: Date.now() };
    writeLater();
    removeRow(it);
    showUndo(t('Inbox.undo_later'), () => { delete later.value[rowKey(it)]; writeLater(); reload(); });
};
const unsnooze = (it) => {
    delete later.value[rowKey(it)];
    later.value = { ...later.value };
    writeLater();
    removeRow(it);
};

const markAllRead = async () => {
    if (!(await post('/read-all', { tab: tab.value === 'later' ? 'all' : 'primary' }))) return;
    if (tab.value === 'later') later.value = {};
    writeLater();
    items.value = [];
    hasMore.value = false;
    nextSkip.value = 0;
    loadCounts();
};

const showUndo = (text, fn) => {
    clearTimeout(undoTimer);
    undo.value = { text, fn };
    undoTimer = setTimeout(() => { undo.value = null; }, UNDO_MS);
};
const runUndo = async () => {
    const u = undo.value;
    undo.value = null;
    clearTimeout(undoTimer);
    if (u && u.fn) await u.fn();
};

const setPtoStatus = async (id, status) => {
    busy.value = true;
    try {
        const res = await apiRequest('put', `${env.PTO}/${id}/status`, { status });
        if (!res?.data?.status) { $toast.error(res?.data?.statusText || t('Inbox.action_failed'), { position: 'top-right' }); return false; }
        return true;
    } catch (e) {
        $toast.error(e?.response?.data?.statusText || e?.message || t('Inbox.action_failed'), { position: 'top-right' });
        return false;
    } finally {
        busy.value = false;
    }
};
const decide = async (it, status) => {
    if (!(await setPtoStatus(it.sourceId, status))) return;
    removeRow(it);
    loadCounts();
    const who = actorName(it) || t('Inbox.someone');
    showUndo(
        status === 'approved' ? t('Inbox.undo_approved', { who }) : t('Inbox.undo_declined', { who }),
        async () => { if (await setPtoStatus(it.sourceId, 'pending')) reload(); },
    );
};

const setReplyRef = (it, el) => { if (isExpanded(it)) replyEl = el; };
const openReply = async (it) => {
    expanded.value = rowKey(it);
    replyText.value = '';
    replyError.value = '';
    await nextTick();
    if (replyEl && replyEl.focus) replyEl.focus();
};
const closeReply = () => { expanded.value = ''; replyText.value = ''; replyError.value = ''; };
const onReplyKey = (e, it) => {
    if (e.key === 'Escape') { closeReply(); return; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(it); }
};
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const sendReply = async (it) => {
    const text = replyText.value.trim();
    if (!text) { replyError.value = t('Inbox.reply_empty'); return; }
    busy.value = true;
    replyError.value = '';
    try {
        const objId = { projectId: it.projectId, sprintId: it.sprintId, taskId: it.taskId };
        if (it.folderId) objId.folderId = it.folderId;
        const res = await apiRequest('post', env.API_COMMENTS, {
            data: {
                message: escapeHtml(text),
                type: 'text',
                userId: userId?.value,
                objId,
                project: false,
                mentionIds: [],
                isDeleted: false,
                hasReply: false,
                replyMessageId: '',
                mediaURL: '',
                mediaName: '',
                mediaSize: 0,
            },
        });
        if (!res?.data?.status) { replyError.value = res?.data?.statusText || t('Inbox.action_failed'); return; }
        closeReply();
        if (it.unread) await markDone(it);
        $toast.success(t('Inbox.reply_sent'), { position: 'top-right' });
    } catch (e) {
        replyError.value = e?.message || t('Inbox.action_failed');
    } finally {
        busy.value = false;
    }
};

const open = (it) => {
    if (it.unread && it.kind !== 'approval') setRead(it, true).then(() => removeRowSoft(it));
    openRoute(it, it.sourceType === 'notification' ? 'notifications' : 'mentions', { gettersVal: getters });
};
const removeRowSoft = (it) => {
    delete later.value[rowKey(it)];
    writeLater();
    if (tab.value !== 'done') removeRow(it);
};
const openReminders = () => openPanel('reminders');
const openAiInbox = () => router.push({ name: 'AiInbox', params: { cid: companyId?.value } }).catch(() => {});
// Agent proposals decide through the agent API so the audit row, undo window and
// run closure are the same whichever Inbox the person used.
const decideProposal = async (it, verb) => {
    busy.value = true;
    try {
        const res = await apiRequest('post', `${env.AGENT_PROPOSALS}/${it.proposalId}/${verb}`, {});
        if (!res?.data?.status) { $toast.error(res?.data?.statusText || t('Inbox.action_failed'), { position: 'top-right' }); return; }
        removeRow(it);
        loadCounts();
    } catch (e) {
        $toast.error(e?.response?.data?.statusText || e?.message || t('Inbox.action_failed'), { position: 'top-right' });
    } finally {
        busy.value = false;
    }
};
const reviewInAiInbox = () => router.push({ name: 'AiInbox', params: { cid: companyId?.value } }).catch(() => {});

const isTyping = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) || e.target?.isContentEditable;
const focusCursor = async () => {
    await nextTick();
    const el = listEl.value?.querySelectorAll('.ibx__card')[cursor.value];
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); }
};
const onKey = (e) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const it = rows.value[cursor.value];
    if (e.key === 'j') { e.preventDefault(); cursor.value = Math.min(rows.value.length - 1, cursor.value + 1); focusCursor(); }
    else if (e.key === 'k') { e.preventDefault(); cursor.value = Math.max(0, cursor.value - 1); focusCursor(); }
    else if (e.key === 'e' && it) { e.preventDefault(); if (it.kind !== 'approval') markDone(it); }
    else if (e.key === 'l' && it) { e.preventDefault(); if (it.kind !== 'approval' && tab.value !== 'later') snooze(it); }
    else if (e.key === 'r' && it) { e.preventDefault(); if (it.kind === 'mention' && canReply(it)) openReply(it); }
    else if (e.key === 'Enter' && it) { e.preventDefault(); if (it.kind !== 'approval' && it.kind !== 'reminder') open(it); }
};

watch(() => route.query.tab, (next) => {
    if (!next || !TABS.includes(next) || next === tab.value) return;
    tab.value = next;
    load(false);
});

onMounted(async () => {
    if (route.query.tab !== tab.value) syncQuery();
    await loadCounts();
    await load(false);
});
onUnmounted(() => { clearTimeout(liveTimer); clearTimeout(undoTimer); });
</script>

<style scoped>
.ibx { display: flex; height: 100%; min-height: 0; background: var(--canvas); color: var(--ink); font-family: var(--font-ui); font-size: 12.5px; }

.ibx__side {
    width: var(--sidebar-w); flex: none; display: flex; flex-direction: column; gap: 14px;
    padding: 14px 10px; background: var(--surface); border-right: 1px solid var(--hairline); font-size: 13px;
}
.ibx__nav, .ibx__filters { display: flex; flex-direction: column; gap: 1px; }
.ibx__label { padding: 0 9px 4px; }
.ibx__navitem {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 6px 9px; border: 0; border-radius: 7px; background: transparent; text-align: left;
    font: 500 13px/1.3 var(--font-ui); color: var(--ink); cursor: pointer;
    transition: background var(--t-state) var(--ease), color var(--t-state) var(--ease);
}
.ibx__navitem:hover { background: var(--surface-hover); }
.ibx__navitem.is-active { background: var(--brand-tint); color: var(--brand); font-weight: 600; }
.ibx__navitem--kind { font-weight: 400; }
.ibx__navcount { margin-left: auto; background: var(--brand); color: #fff; font: 700 10px/1 var(--font-mono); padding: 3px 6px; border-radius: 9px; }
.ibx__side-foot { margin-top: auto; padding: 0 9px; font-size: 11.5px; line-height: 1.45; color: var(--ink-2); }

.ibx__main { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }
.ibx__toolbar { gap: 4px; }
.ibx__tabs { display: flex; gap: 2px; margin-left: 10px; }
.ibx__tab {
    padding: 6px 10px; border: 0; border-bottom: 2px solid transparent; background: transparent;
    font: 500 12.5px/1 var(--font-ui); color: var(--ink-2); cursor: pointer;
    transition: color var(--t-state) var(--ease), border-color var(--t-state) var(--ease);
}
.ibx__tab.is-active { color: var(--ink); font-weight: 600; border-bottom-color: var(--brand); }
.ibx__tabcount { font: 500 10px/1 var(--font-mono); color: var(--ink-2); margin-left: 2px; }
.ibx__keys { color: var(--ink-3); font-size: 10.5px; letter-spacing: .12em; }
.ibx__markall { border: 0; background: transparent; font: 600 12px/1 var(--font-ui); color: var(--brand); cursor: pointer; padding: 8px 0 8px 10px; }
.ibx__markall:disabled { opacity: .45; cursor: default; }

.ibx__list { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px 20px; display: flex; flex-direction: column; gap: 8px; }
.ibx__state { padding: 40px 0; text-align: center; color: var(--ink-2); display: flex; flex-direction: column; align-items: center; gap: 10px; }
.ibx__state--error { color: var(--danger-ink); }
.ibx__zero { padding: 60px 0; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.ibx__zero-mark { width: 44px; height: 44px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--ok-bg); color: var(--ok-ink); margin-bottom: 8px; }
.ibx__zero-title { font-size: 15px; font-weight: 600; }
.ibx__zero-sub { color: var(--ink-2); margin-bottom: 8px; }

.ibx__card {
    background: var(--surface); border: 1px solid var(--hairline); border-left: 3px solid transparent; border-radius: 10px;
    padding: 11px 13px; display: flex; flex-direction: column; gap: 7px; outline: none;
    transition: border-color var(--t-state) var(--ease), box-shadow var(--t-state) var(--ease);
}
.ibx__card.is-mention, .ibx__card.is-approval, .ibx__card.is-reminder { border-left-color: var(--brand); }
.ibx__card.is-agent { border-left-color: rgba(47, 57, 144, .5); }
.ibx__card.is-read { border-left-color: transparent; color: var(--ink-label); }
.ibx__card.is-cursor, .ibx__card:focus-visible { box-shadow: var(--focus); border-color: var(--brand); }
.ibx__head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ibx__avatar { display: inline-flex; width: 22px; height: 22px; flex: none; }
.ibx__avatar :deep(.profile-image) { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; }
.ibx__glyph { width: 22px; height: 22px; border-radius: 6px; display: inline-grid; place-items: center; background: rgba(0, 0, 0, .07); color: var(--ink-label); flex: none; }
.ibx__glyph--reminder { border-radius: 50%; background: var(--warn-bg); color: var(--warn-ink); }
.ibx__glyph--danger { background: var(--danger-bg); color: var(--danger-ink); }
.ibx__what { font-weight: 400; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ibx__what strong, .ibx__strong { font-weight: 600; color: var(--ink); }
.ibx__dim { color: var(--ink-2); font-weight: 400; }
.ibx__agent { height: 16px; padding: 0 4px; font-size: 8.5px; letter-spacing: .04em; }
.ibx__when { margin-left: auto; font: 500 10px/1 var(--font-mono); color: var(--ink-2); flex: none; }
.ibx__body { color: var(--ink-label); line-height: 1.45; overflow-wrap: anywhere; }
.ibx__body :deep(b), .ibx__body :deep(strong) { color: var(--ink); font-weight: 600; }
.ibx__body :deep(.mentioned) { color: var(--brand); font-weight: 600; }
.ibx__body :deep(span[style]) { display: inline-block; padding: 1px 4px; border-radius: 4px; line-height: 1.35; }
.ibx__quote { color: var(--ink); }
.ibx__chip { margin-right: 6px; }
.ibx__target { font: 500 10.5px/1 var(--font-mono); color: var(--ink-2); cursor: pointer; }
.ibx__target:hover { color: var(--brand); }
.ibx__actions { display: flex; gap: 6px; flex-wrap: wrap; }
.ibx__actions .ah-btn--sm { height: 28px; padding: 0 10px; font-size: 11.5px; }
.ibx__reply { display: flex; flex-direction: column; gap: 6px; }
.ibx__reply-input { min-height: 56px; font-size: 12.5px; }
.ibx__reply-actions { display: flex; align-items: center; gap: 6px; }
.ibx__more { align-self: center; margin-top: 6px; }
.ibx__foot { margin-top: auto; padding-top: 12px; text-align: center; font-size: 11.5px; color: var(--ink-2); }

.ibx__undo {
    position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
    display: flex; align-items: center; gap: 14px; padding: 9px 14px;
    background: var(--rail); color: #fff; border-radius: 9px; box-shadow: var(--shadow-pop); font-size: 12.5px; white-space: nowrap;
}
.ibx__undo-btn { border: 0; background: transparent; color: #a892ff; font: 600 12.5px/1 var(--font-ui); cursor: pointer; padding: 0; }

.ibx__toolbar .ibx__tabs { display: none; }
@media (max-width: 1279px) {
    .ibx__side { display: none; }
    .ibx__toolbar .ibx__tabs { display: flex; }
    .ibx__foot { display: block; }
}
@media (max-width: 767px) {
    .ibx__toolbar { padding: 0 12px; }
    .ibx__keys { display: none; }
    .ibx__list { padding: 10px; }
    .ibx__actions .ah-btn--sm { height: 44px; padding: 0 14px; font-size: 13px; }
}
</style>
