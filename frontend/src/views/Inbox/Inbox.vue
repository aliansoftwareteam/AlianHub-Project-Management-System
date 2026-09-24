<template>
    <div class="ah-page ibx" @keydown="onKey">
        <aside class="ibx__side">
            <div class="ibx__nav" role="tablist" aria-orientation="vertical" :aria-label="$t('Inbox.tabs_label')">
                <button
                    v-for="(t, i) in TABS"
                    :id="tabId('side', t)"
                    :key="t"
                    type="button"
                    class="ibx__navitem"
                    :class="{ 'is-active': tab === t }"
                    role="tab"
                    :data-tab="t"
                    :aria-selected="tab === t ? 'true' : 'false'"
                    :aria-controls="PANEL_ID"
                    :tabindex="tab === t ? 0 : -1"
                    @click="switchTab(t)"
                    @keydown="onTabKey($event, i, 'side')"
                >
                    <span>{{ $t('Inbox.tab_' + t) }}</span>
                    <span v-if="tabCount(t)" class="ibx__navcount">{{ tabCount(t) > 99 ? '99+' : tabCount(t) }}</span>
                </button>
            </div>

            <div class="ibx__filters">
                <div class="ah-label ibx__label">{{ $t('Inbox.filter_label') }}</div>
                <button
                    v-for="k in KINDS"
                    :key="k"
                    type="button"
                    class="ibx__navitem ibx__navitem--kind"
                    :class="{ 'is-active': kind === k }"
                    :aria-pressed="kind === k ? 'true' : 'false'"
                    @click="switchKind(k)"
                >{{ $t('Inbox.kind_' + k) }}</button>
            </div>

            <div class="ibx__side-foot">{{ $t('Inbox.footer_cleared') }}</div>
        </aside>

        <section class="ibx__main">
            <div class="ah-toolbar ibx__toolbar">
                <h1 class="ah-toolbar__title">{{ $t('Inbox.title') }}</h1>
                <div class="ibx__tabs" role="tablist" :aria-label="$t('Inbox.tabs_label')">
                    <button
                        v-for="(t, i) in TABS"
                        :id="tabId('top', t)"
                        :key="t"
                        type="button"
                        class="ibx__tab"
                        :class="{ 'is-active': tab === t }"
                        role="tab"
                        :data-tab="t"
                        :aria-selected="tab === t ? 'true' : 'false'"
                        :aria-controls="PANEL_ID"
                        :tabindex="tab === t ? 0 : -1"
                        @click="switchTab(t)"
                        @keydown="onTabKey($event, i, 'top')"
                    >{{ $t('Inbox.tab_' + t) }} <span v-if="tabCount(t)" class="ibx__tabcount">{{ tabCount(t) }}</span></button>
                </div>
                <span class="ah-toolbar__spacer"></span>
                <span class="ibx__keys ah-mono" aria-hidden="true" :title="$t('Inbox.keys_hint')">j k e s</span>
                <button
                    v-if="tab === 'primary' || tab === 'other'"
                    type="button"
                    class="ibx__markall"
                    :disabled="busy || !hasUnread"
                    @click="markAllRead"
                >{{ $t('Inbox.mark_all_read') }}</button>
                <button
                    v-if="tab !== 'cleared'"
                    type="button"
                    class="ibx__markall"
                    data-action="clear-all"
                    :disabled="busy || !items.length"
                    @click="clearAll"
                >{{ $t('Inbox.clear_all') }}</button>
            </div>

            <div :id="PANEL_ID" ref="listEl" class="ibx__list ah-scroll" role="tabpanel" :aria-labelledby="tabId('top', tab)">
                <div v-if="loading" class="ibx__state">{{ $t('Inbox.loading') }}</div>

                <div v-else-if="loadError" class="ibx__state ibx__state--error">
                    {{ loadError }}
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="reload">{{ $t('Inbox.retry') }}</button>
                </div>

                <div v-else-if="!rows.length" class="ibx__zero">
                    <span class="ibx__zero-mark"><ShellIcon name="check" :size="22" /></span>
                    <div class="ibx__zero-title">{{ $t('Inbox.zero_' + tab) }}</div>
                    <div class="ibx__zero-sub">{{ $t(ZERO_SUB[tab]) }}</div>
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

                        <div v-if="tab === 'later' && (it.snoozedUntil || it.snoozeUntilChange)" class="ibx__state-line">
                            <span class="ah-chip ibx__chip ibx__chip--snooze"><ShellIcon name="reminder" :size="11" />{{ it.snoozeUntilChange ? $t('Inbox.snoozed_until_change') : $t('Inbox.snoozed_until', { when: whenLabel(it.snoozedUntil) }) }}</span>
                        </div>
                        <div v-else-if="tab === 'cleared' && it.clearedAt" class="ibx__state-line">
                            <span class="ah-chip ibx__chip">{{ $t('Inbox.cleared_on', { when: whenLabel(it.clearedAt) }) }}</span>
                        </div>

                        <div v-if="isExpanded(it)" class="ibx__reply" @click.stop>
                            <textarea
                                :ref="(el) => setReplyRef(it, el)"
                                v-model="replyText"
                                class="ah-input ah-textarea ibx__reply-input"
                                :class="{ 'ah-input--error': replyError }"
                                rows="2"
                                :aria-label="$t('Inbox.reply_placeholder', { name: actorName(it) || $t('Inbox.someone') })"
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
                            <template v-if="tab === 'cleared'">
                                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-action="restore" :disabled="busy" @click="restoreRow(it)">{{ $t('Inbox.restore') }}</button>
                            </template>
                            <template v-else>
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
                                    <button v-if="it.unread && tab !== 'later'" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="markDone(it)">{{ $t('Inbox.mark_done') }}</button>
                                </template>
                                <template v-else-if="it.kind === 'mention'">
                                    <button v-if="!isExpanded(it) && canReply(it)" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="openReply(it)">{{ $t('Inbox.reply_here') }}</button>
                                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="open(it)">{{ it.mainChat ? $t('Inbox.open_chat') : $t('Inbox.open_task') }}</button>
                                </template>
                                <template v-else>
                                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="open(it)">{{ $t('Inbox.open') }}</button>
                                </template>

                                <button
                                    v-if="canSnooze(it)"
                                    type="button"
                                    class="ah-btn ah-btn--secondary ah-btn--sm"
                                    data-snooze-trigger
                                    aria-haspopup="menu"
                                    :aria-expanded="isSnoozeOpen(it) ? 'true' : 'false'"
                                    @click="toggleSnooze(it)"
                                >{{ $t('Inbox.snooze') }}</button>
                                <button v-if="tab === 'later'" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="unsnoozeRow(it)">{{ $t('Inbox.unsnooze') }}</button>
                                <button v-if="canClear(it)" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="clearRow(it)">{{ $t('Inbox.clear') }}</button>
                                <button v-if="it.kind !== 'approval' && it.kind !== 'reminder' && it.kind !== 'proposal' && !it.agent && it.unread && tab !== 'later'" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="markDone(it)">{{ $t('Inbox.mark_done') }}</button>
                                <button v-if="!it.unread && tab === 'done'" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="markUnread(it)">{{ $t('Inbox.mark_unread') }}</button>
                            </template>
                        </div>

                        <div v-if="isSnoozeOpen(it)" class="ibx__snooze ah-pop" @keydown="onSnoozeKey" @click.stop>
                            <div role="menu" :aria-label="$t('Inbox.snooze_menu')">
                                <button
                                    v-for="p in SNOOZE_MENU"
                                    :key="p"
                                    type="button"
                                    role="menuitem"
                                    class="ah-pop__item ibx__snooze-item"
                                    :data-preset="p"
                                    tabindex="-1"
                                    @click="pickSnooze(it, p)"
                                >
                                    <span>{{ $t('Inbox.snooze_' + p) }}</span>
                                    <span class="ibx__snooze-hint">{{ presetHint(p) }}</span>
                                </button>
                            </div>
                            <div v-if="customOpen" class="ibx__snooze-custom">
                                <label class="ah-label" :for="CUSTOM_ID">{{ $t('Inbox.snooze_pick_label') }}</label>
                                <input
                                    :id="CUSTOM_ID"
                                    v-model="customAt"
                                    type="datetime-local"
                                    class="ah-input"
                                    :class="{ 'ah-input--error': customError }"
                                    :min="customMin"
                                    @keydown.enter.prevent="pickCustom(it)"
                                >
                                <div v-if="customError" class="ah-field__error" role="alert">{{ customError }}</div>
                                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" @click="pickCustom(it)">{{ $t('Inbox.snooze_save') }}</button>
                            </div>
                        </div>
                    </article>

                    <button v-if="hasMore" type="button" class="ah-btn ah-btn--secondary ah-btn--sm ibx__more" :disabled="busy" @click="loadMore">
                        {{ busy ? $t('Inbox.loading') : $t('Inbox.load_more') }}
                    </button>
                </template>

                <div class="ibx__foot">{{ $t('Inbox.footer_cleared') }}</div>
            </div>

            <transition name="ah-fade">
                <div v-if="undo" class="ibx__undo" role="status">
                    <span>{{ undo.text }}</span>
                    <button v-if="undo.fn" type="button" class="ibx__undo-btn" @click="runUndo">{{ $t('Inbox.undo') }}</button>
                </div>
            </transition>
        </section>
    </div>
</template>

<script setup>
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { aiOff } from "@/composable/aiAvailability";
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { useStore } from 'vuex';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import { sendProposalDecision } from '@/composable/agentProposals';
import UserProfile from '@/components/atom/UserProfile/UserProfile.vue';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { useHelper } from '@/components/organisms/Header/helper';
import { openPanel } from '@/components/organisms/Shell/shellState';
import { onTaskClosed, openTask, overlayState } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
import { noticeTextOf } from '@/views/Ai/rateAlerts';
import { escapeHtml } from '@/utils/notificationHtml';
import { renderNotice } from './renderNotice';
import { SNOOZE_PRESETS, formatWhen, resolveTimeZone, snoozeTarget, toZonedInput } from './snoozePresets';
import { laterStorageKey, migrateLegacyLater } from './laterMigration';

defineOptions({ name: 'InboxPage' });

const TABS = ['primary', 'other', 'later', 'done', 'cleared'];
const KINDS = ['all', 'mention', 'approval', 'reminder', 'update'];
const SNOOZE_MENU = [...SNOOZE_PRESETS, 'custom'];
const ZERO_SUB = {
    primary: 'Inbox.zero_sub_primary',
    other: 'Inbox.zero_sub_other',
    later: 'Inbox.zero_sub_later_snooze',
    done: 'Inbox.zero_sub_done',
    cleared: 'Inbox.zero_sub_cleared',
};
const PANEL_ID = 'ibx-panel';
const CUSTOM_ID = 'ibx-snooze-at';
const UNDO_MS = 6000;

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
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
const counts = ref({ primary: 0, other: 0, later: 0 });
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
const snoozeFor = ref('');
const customOpen = ref(false);
const customAt = ref('');
const customError = ref('');
let undoTimer = null;
let replyEl = null;

const hasAiHub = computed(() => !aiOff.value && router.hasRoute('AiHub'));
const timeZone = computed(() => resolveTimeZone((getUser(userId?.value) || {}).Time_Zone));

const rowKey = (it) => `${it.sourceType}:${it.sourceId}`;
const itemOf = (it) => ({ sourceType: it.sourceType, sourceId: it.sourceId, duplicateIds: it.duplicateIds || [] });
const rows = computed(() => (tab.value === 'primary' ? [...approvals.value, ...items.value] : items.value));
const hasUnread = computed(() => rows.value.some((i) => i.unread && i.kind !== 'approval' && i.kind !== 'proposal'));
const tabCount = (name) => Number(counts.value[name] || 0);
const tabId = (group, name) => `ibx-tab-${group}-${name}`;

const actorOf = (it) => (it.actorId ? getUser(it.actorId) : null);
const actorImage = (it) => actorOf(it)?.Employee_profileImageURL || '';
const actorName = (it) => actorOf(it)?.Employee_Name || '';
const alertNotice = (it) => (it.changeType === 'agent_alert' ? noticeTextOf(it.changeData) : null);
const render = (it) => renderNotice(it, { t, changeText });
const isExpanded = (it) => expanded.value === rowKey(it);
const canReply = (it) => !!(it.taskId && it.projectId && it.sprintId && !it.mainChat);
const clearable = (it) => it.sourceType === 'notification' || it.sourceType === 'mention';
const canClear = (it) => clearable(it) && tab.value !== 'cleared';
const canSnooze = (it) => clearable(it) && (tab.value === 'primary' || tab.value === 'other');
const whenLabel = (iso) => formatWhen(iso, timeZone.value, locale?.value);

const glyphIcon = (it) => {
    if (it.kind === 'mention') return 'at';
    if (it.changeType === 'agent_alert') return 'alert';
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
    snoozeFor.value = '';
    syncQuery();
    load(false);
};
const switchKind = (next) => {
    if (kind.value === next) return;
    kind.value = next;
    syncQuery();
    load(false);
};

const onTabKey = (e, index, group) => {
    const n = TABS.length;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    switchTab(TABS[next]);
    nextTick(() => document.getElementById(tabId(group, TABS[next]))?.focus());
};

const post = async (path, body, { quiet = false } = {}) => {
    busy.value = true;
    try {
        const res = await apiRequest('post', `${env.INBOX}${path}`, body);
        if (!res?.data?.status) {
            if (!quiet) $toast.error(res?.data?.statusText || t('Inbox.action_failed'), { position: 'top-right' });
            return null;
        }
        return res.data;
    } catch (e) {
        if (!quiet) $toast.error(e?.message || t('Inbox.action_failed'), { position: 'top-right' });
        return null;
    } finally {
        busy.value = false;
    }
};

const removeRow = (it) => {
    const at = rows.value.findIndex((x) => rowKey(x) === rowKey(it));
    items.value = items.value.filter((x) => rowKey(x) !== rowKey(it));
    approvals.value = approvals.value.filter((x) => rowKey(x) !== rowKey(it));
    nextSkip.value = Math.max(0, nextSkip.value - 1);
    if (at >= 0 && at < cursor.value) cursor.value -= 1;
    cursor.value = Math.min(cursor.value, Math.max(0, rows.value.length - 1));
};
// The removed card held focus, so without this it drops to <body> and the next key does nothing.
const refocusAfterRemove = () => {
    const active = document.activeElement;
    if (overlayState.open) return;
    if (!active || active === document.body || !active.isConnected || listEl.value?.contains(active)) focusCursor();
};

const setRead = async (it, read) => {
    const payload = { items: [itemOf(it)] };
    if (!read) payload.read = 'false';
    if (!(await post('/read', payload))) return false;
    loadCounts();
    return true;
};

const markDone = async (it) => {
    if (it.kind === 'approval') return;
    if (!(await setRead(it, true))) return;
    if (tab.value === 'done') items.value = items.value.map((x) => (rowKey(x) === rowKey(it) ? { ...x, unread: false } : x));
    else removeRow(it);
};
const markUnread = async (it) => {
    if (!(await setRead(it, false))) return;
    if (tab.value === 'done') removeRow(it);
    else items.value = items.value.map((x) => (rowKey(x) === rowKey(it) ? { ...x, unread: true } : x));
};

const showUndo = (text, fn = null) => {
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

const snoozeRow = async (it, target) => {
    if (!(await post('/snooze', { items: [itemOf(it)], ...target }))) return;
    removeRow(it);
    refocusAfterRemove();
    loadCounts();
    const text = target.untilChange ? t('Inbox.undo_snoozed_change') : t('Inbox.undo_snoozed', { when: whenLabel(target.until) });
    showUndo(text, async () => { if (await post('/unsnooze', { items: [itemOf(it)], unread: !!it.unread })) reload(); });
};
const unsnoozeRow = async (it) => {
    if (!(await post('/unsnooze', { items: [itemOf(it)] }))) return;
    removeRow(it);
    loadCounts();
    showUndo(t('Inbox.restored'));
};
const clearRow = async (it) => {
    if (!(await post('/clear', { items: [itemOf(it)] }))) return;
    removeRow(it);
    refocusAfterRemove();
    loadCounts();
    showUndo(t('Inbox.undo_cleared'), async () => { if (await post('/restore', { items: [itemOf(it)], unread: !!it.unread })) reload(); });
};
const restoreRow = async (it) => {
    if (!(await post('/restore', { items: [itemOf(it)] }))) return;
    removeRow(it);
    loadCounts();
    showUndo(t('Inbox.restored'));
};
const clearAll = async () => {
    const res = await post('/clear-all', { tab: tab.value, kind: kind.value });
    if (!res) return;
    items.value = [];
    hasMore.value = false;
    nextSkip.value = 0;
    cursor.value = 0;
    loadCounts();
    showUndo(t('Inbox.cleared_all', { n: Number(res.data?.count || 0) }));
};

const markAllRead = async () => {
    if (!(await post('/read-all', { tab: tab.value }))) return;
    items.value = [];
    hasMore.value = false;
    nextSkip.value = 0;
    loadCounts();
};

const isSnoozeOpen = (it) => snoozeFor.value === rowKey(it);
const menuItems = () => [...(listEl.value?.querySelectorAll('.ibx__snooze [role="menuitem"]') || [])];
const openSnooze = async (it) => {
    const index = rows.value.findIndex((x) => rowKey(x) === rowKey(it));
    if (index >= 0) cursor.value = index;
    snoozeFor.value = rowKey(it);
    customOpen.value = false;
    customError.value = '';
    await nextTick();
    menuItems()[0]?.focus();
};
const closeSnooze = async (returnFocus = true) => {
    snoozeFor.value = '';
    customOpen.value = false;
    if (returnFocus) await focusCursor();
};
const toggleSnooze = (it) => (isSnoozeOpen(it) ? closeSnooze() : openSnooze(it));
const presetHint = (preset) => {
    if (preset === 'until_change') return t('Inbox.snooze_until_change_hint');
    if (preset === 'custom') return '';
    const target = snoozeTarget(preset, { timeZone: timeZone.value });
    return target && target.until ? whenLabel(target.until) : '';
};
const customMin = computed(() => (snoozeFor.value ? toZonedInput(new Date(), timeZone.value) : ''));
const pickSnooze = async (it, preset) => {
    if (preset === 'custom') {
        const tomorrow = snoozeTarget('tomorrow', { timeZone: timeZone.value });
        customAt.value = tomorrow ? toZonedInput(new Date(tomorrow.until), timeZone.value) : '';
        customError.value = '';
        customOpen.value = true;
        await nextTick();
        document.getElementById(CUSTOM_ID)?.focus();
        return;
    }
    const target = snoozeTarget(preset, { timeZone: timeZone.value });
    if (!target) return;
    await closeSnooze();
    await snoozeRow(it, target);
};
const pickCustom = async (it) => {
    const target = snoozeTarget('custom', { timeZone: timeZone.value, value: customAt.value });
    if (!target) { customError.value = t('Inbox.snooze_pick_past'); return; }
    await closeSnooze();
    await snoozeRow(it, target);
};
const onSnoozeKey = (e) => {
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeSnooze();
        return;
    }
    if (e.target?.getAttribute?.('role') !== 'menuitem') return;
    const list = menuItems();
    const at = list.indexOf(e.target);
    let next = -1;
    if (e.key === 'ArrowDown') next = (at + 1) % list.length;
    else if (e.key === 'ArrowUp') next = (at - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    list[next].focus();
};
const onOutside = (e) => {
    if (!snoozeFor.value) return;
    const target = e.target;
    if (target?.closest?.('.ibx__snooze') || target?.closest?.('[data-snooze-trigger]')) return;
    closeSnooze(false);
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

const opensOverTheInbox = (it) => !!(it.taskId && it.projectId && it.sprintId && !it.mainChat && !alertNotice(it)
    && (it.sourceType === 'mention' || String(it.type || '').toLowerCase() !== 'project'));
const open = (it) => {
    if (it.unread && it.kind !== 'approval') setRead(it, true).then((ok) => { if (ok && tab.value !== 'done') removeRow(it); });
    if (alertNotice(it) && router.hasRoute('AiHealth')) {
        router.push({ name: 'AiHealth', params: { cid: companyId?.value } }).catch(() => {});
        return;
    }
    if (opensOverTheInbox(it)) {
        openTask({
            companyId: it.companyId || companyId?.value,
            projectId: it.projectId,
            sprintId: it.sprintId,
            folderId: it.folderId || '',
            taskId: it.taskId,
            tab: it.sourceType === 'mention' ? 'activity' : '',
        });
        return;
    }
    openRoute(it, it.sourceType === 'notification' ? 'notifications' : 'mentions', { gettersVal: getters });
};
const openReminders = () => openPanel('reminders');
const openAiInbox = () => router.push({ name: 'AiInbox', params: { cid: companyId?.value } }).catch(() => {});
const decideProposal = async (it, verb) => {
    busy.value = true;
    try {
        const res = await sendProposalDecision(it.proposalId, verb);
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

const typingIn = (el) => !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
const isTyping = (e) => typingIn(e.target);
const inList = (e) => !!(listEl.value && e.target && listEl.value.contains(e.target));
const focusCursor = async () => {
    await nextTick();
    const el = listEl.value?.querySelectorAll('.ibx__card')[cursor.value];
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView?.({ block: 'nearest' }); }
};
const moveCursor = (step) => {
    cursor.value = Math.max(0, Math.min(rows.value.length - 1, cursor.value + step));
    focusCursor();
};
// Row keys act only from inside the list, so a key pressed on a tab or a filter never clears a row out of sight.
const onKey = (e) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target?.closest?.('.ibx__snooze')) return;
    const it = rows.value[cursor.value];
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); moveCursor(1); return; }
    if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); moveCursor(-1); return; }
    if (!it || !inList(e)) return;
    if (e.key === 'e') { e.preventDefault(); if (canClear(it)) clearRow(it); }
    else if (e.key === 's') { e.preventDefault(); if (canSnooze(it)) openSnooze(it); }
    else if (e.key === 'r') { e.preventDefault(); if (it.kind === 'mention' && canReply(it)) openReply(it); }
    else if (e.key === 'Enter' && e.target?.classList?.contains('ibx__card')) {
        e.preventDefault();
        if (it.kind !== 'approval' && it.kind !== 'reminder' && it.kind !== 'proposal') open(it);
    }
};

// With focus on <body> the page's own keydown never fires, so j and k are caught here to enter the list.
const onDocumentKey = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || overlayState.open) return;
    if (e.target !== document.body && e.target !== document.documentElement) return;
    if ((e.key !== 'j' && e.key !== 'k') || !rows.value.length) return;
    e.preventDefault();
    focusCursor();
};
const focusFirstCard = () => {
    if (overlayState.open || typingIn(document.activeElement) || !rows.value.length) return;
    cursor.value = 0;
    focusCursor();
};
// The panel is still in the DOM while it animates out, and the card that opened it may already be gone.
const stopOnTaskClosed = onTaskClosed(async () => {
    await nextTick();
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected || active.closest?.('.ah-detail')) focusCursor();
});

const migrateLater = async () => {
    let storage = null;
    try { storage = window.localStorage; } catch (e) { return; }
    if (!storage) return;
    const moved = await migrateLegacyLater({
        storage,
        key: laterStorageKey(companyId?.value, userId?.value),
        snooze: async (list) => !!(await post('/snooze', { items: list, ...snoozeTarget('tomorrow', { timeZone: timeZone.value }) }, { quiet: true })),
    });
    if (moved) $toast.info(t('Inbox.later_migrated', { n: moved }), { position: 'top-right' });
};

watch(() => route.query.tab, (next) => {
    if (!next || !TABS.includes(next) || next === tab.value) return;
    tab.value = next;
    load(false);
});

onMounted(async () => {
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onDocumentKey);
    if (route.query.tab !== tab.value) syncQuery();
    await migrateLater();
    await loadCounts();
    await load(false);
    focusFirstCard();
});
onUnmounted(() => {
    document.removeEventListener('mousedown', onOutside);
    document.removeEventListener('keydown', onDocumentKey);
    stopOnTaskClosed();
    clearTimeout(liveTimer);
    clearTimeout(undoTimer);
});
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
.ibx__navitem:focus-visible, .ibx__tab:focus-visible { outline: none; box-shadow: var(--focus); }
.ibx__navitem.is-active { background: var(--brand-tint); color: var(--brand); font-weight: 600; }
.ibx__navitem--kind { font-weight: 400; }
.ibx__navcount { margin-left: auto; background: var(--brand); color: var(--on-brand); font: 700 10px/1 var(--font-mono); padding: 3px 6px; border-radius: 9px; }
.ibx__side-foot { margin-top: auto; padding: 0 9px; font-size: 11.5px; line-height: 1.45; color: var(--ink-2); }

.ibx__main { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }
.ibx__toolbar { gap: 4px; }
.ibx__tabs { display: flex; gap: 2px; margin-left: 10px; }
.ibx__tab {
    padding: 6px 10px; border: 0; border-bottom: 2px solid transparent; background: transparent; border-radius: 0;
    font: 500 12.5px/1 var(--font-ui); color: var(--ink-2); cursor: pointer; white-space: nowrap;
    transition: color var(--t-state) var(--ease), border-color var(--t-state) var(--ease);
}
.ibx__tab.is-active { color: var(--ink); font-weight: 600; border-bottom-color: var(--brand); }
.ibx__tabcount { font: 500 10px/1 var(--font-mono); color: var(--ink-2); margin-left: 2px; }
.ibx__keys { color: var(--ink-2); font-size: 10.5px; letter-spacing: .12em; }
.ibx__markall { border: 0; background: transparent; font: 600 12px/1 var(--font-ui); color: var(--brand); cursor: pointer; padding: 8px 0 8px 10px; white-space: nowrap; }
.ibx__markall:disabled { opacity: .45; cursor: default; }

.ibx__list { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px 20px; display: flex; flex-direction: column; gap: 8px; }
.ibx__state { padding: 40px 0; text-align: center; color: var(--ink-2); display: flex; flex-direction: column; align-items: center; gap: 10px; }
.ibx__state--error { color: var(--danger-ink); }
.ibx__zero { padding: 60px 0; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.ibx__zero-mark { width: 44px; height: 44px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--ok-bg); color: var(--ok-ink); margin-bottom: 8px; }
.ibx__zero-title { font-size: 15px; font-weight: 600; }
.ibx__zero-sub { color: var(--ink-2); margin-bottom: 8px; max-width: 420px; }

.ibx__card {
    position: relative;
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
.ibx__glyph { width: 22px; height: 22px; border-radius: 6px; display: inline-grid; place-items: center; background: var(--fill); color: var(--ink-label); flex: none; }
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
.ibx__chip--snooze { background: var(--warn-bg); color: var(--warn-ink); }
.ibx__state-line { display: flex; flex-wrap: wrap; gap: 6px; }
.ibx__target { font: 500 10.5px/1 var(--font-mono); color: var(--ink-2); cursor: pointer; }
.ibx__target:hover { color: var(--brand); }
.ibx__actions { display: flex; gap: 6px; flex-wrap: wrap; }
.ibx__actions .ah-btn--sm { height: 28px; padding: 0 10px; font-size: 11.5px; }
.ibx__reply { display: flex; flex-direction: column; gap: 6px; }
.ibx__reply-input { min-height: 56px; font-size: 12.5px; }
.ibx__reply-actions { display: flex; align-items: center; gap: 6px; }
.ibx__more { align-self: center; margin-top: 6px; }
.ibx__foot { margin-top: auto; padding-top: 12px; text-align: center; font-size: 11.5px; color: var(--ink-2); }

.ibx__snooze {
    position: absolute; right: 12px; top: calc(100% - 6px); z-index: 20;
    width: 280px; display: flex; flex-direction: column; gap: 4px;
}
.ibx__snooze-item { justify-content: space-between; }
.ibx__snooze-item:focus-visible { outline: none; box-shadow: var(--focus); }
.ibx__snooze-hint { font: 500 11px/1.2 var(--font-mono); color: var(--ink-2); }
.ibx__snooze-custom { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px 6px; border-top: 1px solid var(--hairline); }
.ibx__snooze-custom .ah-input { color-scheme: light dark; }
.ibx__snooze-custom .ah-btn { align-self: flex-end; }

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
    .ibx__toolbar { flex-wrap: wrap; height: auto; padding: 8px 12px 0; row-gap: 2px; }
    .ibx__toolbar .ibx__tabs { order: 5; flex-basis: 100%; margin-left: -4px; overflow-x: auto; scrollbar-width: none; }
    .ibx__tab { height: 40px; padding: 0 10px; }
    .ibx__keys { display: none; }
    .ibx__list { padding: 10px; }
    .ibx__actions .ah-btn--sm { height: 44px; padding: 0 14px; font-size: 13px; }
    .ibx__snooze { left: 8px; right: 8px; width: auto; }
    .ibx__snooze .ah-pop__item { min-height: 44px; }
}
</style>
