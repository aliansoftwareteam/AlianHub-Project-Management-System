<template>
    <div class="ibx">
        <div class="ibx__tabs" role="tablist">
            <button
                v-for="t in visibleTabs"
                :key="t"
                class="ibx__tab"
                :class="{ 'is-active': tab === t }"
                role="tab"
                :aria-selected="tab === t"
                @click="switchTab(t)"
            >
                <span class="ibx__tab-ico" v-html="ICONS[t]"></span>
                <span class="ibx__tab-label">{{ $t('Inbox.tab_' + t) }}</span>
                <span v-if="counts[t]" class="ibx__count">{{ counts[t] > 99 ? '99+' : counts[t] }}</span>
            </button>
        </div>

        <div class="ibx__bar">
            <span class="ibx__hint">{{ $t('Inbox.tab_hint_' + tab) }}</span>
            <div class="ibx__bar-right">
                <!-- Archive is the one tab holding both kinds at once, so it is the one
                     that needs narrowing. It also has no "Mark all as read" — those rows
                     are already read — so this takes that space rather than adding any. -->
                <div v-if="tab === 'archive'" class="ibx__seg">
                    <button
                        v-for="s in SOURCES"
                        :key="s"
                        class="ibx__seg-btn"
                        :class="{ 'is-on': source === s }"
                        :disabled="busy"
                        @click="switchSource(s)"
                    >{{ $t('Inbox.source_' + s) }}</button>
                </div>
                <button
                    v-else
                    class="ibx__chip"
                    :disabled="busy || !hasUnread"
                    @click="markAllRead"
                >{{ $t('Inbox.mark_all_read') }}</button>
                <!-- Settings live in a small dropdown off the gear, not a slide-in panel:
                     there are three of them and each is a single switch. -->
                <div class="ibx__cog">
                    <button
                        class="ibx__gear"
                        :class="{ 'is-on': customizeOpen }"
                        :title="$t('Inbox.customize')"
                        @click.stop="customizeOpen = !customizeOpen"
                        v-html="ICONS.gear"
                    ></button>

                    <div v-if="customizeOpen" class="ibx__menu" @click.stop>
                        <button
                            v-for="o in OPTIONS"
                            :key="o.key"
                            class="ibx__menu-item"
                            :class="{ 'is-on': prefs[o.key] }"
                            role="menuitemcheckbox"
                            :aria-checked="prefs[o.key]"
                            @click="toggle(o.key)"
                        >
                            <span class="ibx__menu-ico" v-html="ICONS[o.icon]"></span>
                            <span class="ibx__menu-label">{{ $t('Inbox.opt_' + o.key) }}</span>
                            <!-- The tick is the state. A row with no tick is simply off. -->
                            <span class="ibx__menu-tick" v-html="prefs[o.key] ? ICONS.check : ''"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <div class="ibx__scroll">
            <div v-if="loading" class="ibx__state">{{ $t('Inbox.loading') }}</div>

            <div v-else-if="loadError" class="ibx__state ibx__state--error">
                {{ loadError }}
                <button class="ibx__link" @click="reload">{{ $t('Inbox.retry') }}</button>
            </div>

            <div v-else-if="!items.length" class="ibx__zero">
                <div class="ibx__zero-mark" v-html="ICONS.check"></div>
                <h2 class="ibx__zero-title">{{ tab === 'archive' ? $t('Inbox.zero_archive') : $t('Inbox.zero') }}</h2>
                <p class="ibx__zero-sub">{{ $t('Inbox.zero_sub') }}</p>
            </div>

            <template v-else>
                <!-- One flat pass, with a heading before the first row of each day. -->
                <template v-for="(it, i) in items" :key="it.sourceType + ':' + it.sourceId">
                    <div v-if="groupByDate && it.dateGroup !== items[i - 1]?.dateGroup" class="ibx__day">
                        {{ dayLabel(it.dateGroup) }}
                    </div>

                    <article
                        class="ibx__row"
                        :class="{ 'is-unread': it.unread }"
                        @click="open(it)"
                    >
                        <span class="ibx__name" :title="it.taskName || ''">
                            {{ it.taskName || $t('Inbox.no_task') }}
                        </span>

                        <!--
                          Whose action this was. UserProfile rather than a bare <img>, for
                          the same reason the bell dropdown uses it: a profile picture is
                          often a Wasabi key, not an http URL, and a raw src on one of those
                          404s. That is what left a row showing its type icon instead of a
                          face. UserProfile routes those through WasabiImage and falls back
                          to the default avatar, so a row always has a person on it.

                          The type icon is kept only for a row with no actor at all.
                        -->
                        <span class="ibx__avatar" :class="'is-' + it.sourceType" :title="actorName(it)">
                            <UserProfile
                                v-if="it.actorId"
                                :showDot="false"
                                :isBorder="false"
                                :data="{ image: actorImage(it), title: actorName(it) }"
                                width="22px"
                                thumbnail="40x40"
                            />
                            <span v-else v-html="it.sourceType === 'mention' ? ICONS.at : ICONS.bell"></span>
                        </span>

                        <!--
                          v-html because these messages ARE html — the writers store <b>
                          tags. changeText flattens mention tokens the same way the header
                          sidebar and chat list do, so @Name reads the same everywhere.

                          The name leads the line, as it does in the bell dropdown: the
                          messages themselves say "Status of X changed" without ever naming
                          who changed it, so without this the row does not say whose it is.
                        -->
                        <span class="ibx__text">
                            <b v-if="actorName(it)" class="ibx__actor">{{ actorName(it) }}</b>
                            <span class="ibx__msg" v-html="render(it)"></span>
                        </span>

                        <!-- Fixed-width slot: the hover button is wider than the time, and
                             letting it size to content made every row shift on hover. -->
                        <span class="ibx__right">
                            <span class="ibx__resting">
                                <time class="ibx__when" :title="it.createdAt">{{ stamp(it.createdAt) }}</time>
                            </span>
                            <span class="ibx__hover">
                                <button
                                    class="ibx__act"
                                    :disabled="busy"
                                    :title="it.unread ? $t('Inbox.mark_read') : $t('Inbox.mark_unread')"
                                    @click.stop="toggleRead(it)"
                                >{{ it.unread ? $t('Inbox.mark_read') : $t('Inbox.mark_unread') }}</button>
                            </span>
                        </span>
                    </article>
                </template>

                <button v-if="hasMore" class="ibx__more" :disabled="busy" @click="loadMore">
                    {{ busy ? $t('Inbox.loading') : $t('Inbox.load_more') }}
                </button>
            </template>
        </div>

    </div>
</template>

<script setup>
import { defineComponent, ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useStore } from 'vuex';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import { useProjects } from '@/composable/projects';
// The same avatar component the bell dropdown uses, so a picture that lives on Wasabi
// resolves here too.
import UserProfile from '@/components/atom/UserProfile/UserProfile.vue';
// The header's own router for notification and mention rows. Reused rather than
// reimplemented — see open().
import { useHelper } from '@/components/organisms/Header/helper';

// vue/multi-word-component-names — the repo's convention for a single-word view, the
// same as Chat.vue's "chat-component".
defineComponent({ name: 'inbox-component' });

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const $toast = useToast();
// The app's own mention-token flattener, shared with the header sidebar and chat list.
const { changeText } = useCustomComposable();
// The same resolver the bell and @ dropdowns use for the face on a row. The picture is
// looked up live from the company-user list, never taken from the notification document —
// see actorId in Modules/Inbox/controller.js.
const { getUser } = useGetterFunctions();
// And its own date+time formatter — the one the mention dropdown already uses. It honours
// the user's 12/24-hour preference, which a hardcoded toLocaleTimeString did not.
const { getDateAndTime } = useProjects();
// openRoute checks the project list for "deleted" and "archived" before navigating, and
// reads it out of the store — the same getters the header hands it.
const { getters } = useStore();
const { openRoute } = useHelper();

// One tab per thing the user already has, plus All to see them together.
const TABS = ['all', 'notifications', 'mentions', 'archive'];
// Archive-only: which kind of row to show. Mirrors SOURCES in Modules/Inbox/helpers.
const SOURCES = ['all', 'notifications', 'mentions'];

// Only settings that change THIS view. A switch that does nothing visible is worse than
// no switch, so display modes and importance editors are deliberately absent.
const OPTIONS = [
    { key: 'showAllTab', icon: 'eye' },
    { key: 'groupByDate', icon: 'layers' },
    { key: 'newestFirst', icon: 'sortIcon' },
];

// Inline so the view carries no image requests and every glyph inherits currentColor.
const ICONS = {
    all: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    notifications: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    mentions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>',
    archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    at: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    sortIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="15" y2="6"/><line x1="4" y1="12" x2="12" y2="12"/><line x1="4" y1="18" x2="9" y2="18"/><polyline points="17 8 20 5 23 8"/><line x1="20" y1="5" x2="20" y2="19"/></svg>',
};

// Per-user, per-browser. These change how one person reads their own inbox, so they do
// not belong on the server — and a failed write must never stop the inbox rendering.
const PREFS_KEY = 'alianhub.inbox.prefs';
const DEFAULT_PREFS = { showAllTab: true, groupByDate: true, newestFirst: true };
const loadPrefs = () => {
    try {
        const raw = window.localStorage.getItem(PREFS_KEY);
        return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS };
    } catch (e) {
        // Corrupt JSON, or storage blocked entirely (private mode, strict settings).
        return { ...DEFAULT_PREFS };
    }
};

const prefs = ref(loadPrefs());
const customizeOpen = ref(false);
/**
 * Which tab to stand on, honouring the fact that All can be switched off in the gear.
 *
 * The default used to be 'all' unconditionally. With the All tab hidden, opening /inbox
 * with no ?tab= landed on a tab that is not in the strip: nothing appeared selected, so it
 * read as Notifications while actually listing notifications AND mentions together — the
 * mention rows looked like they had leaked into the wrong tab. A stale ?tab=all in the URL
 * did the same.
 */
const resolveTab = (candidate) => {
    const wanted = TABS.includes(candidate) ? candidate : 'all';
    return (wanted === 'all' && !prefs.value.showAllTab) ? 'notifications' : wanted;
};
const tab = ref(resolveTab(route.query.tab));
const source = ref(SOURCES.includes(route.query.source) ? route.query.source : 'all');
const items = ref([]);
const counts = ref({ all: 0, notifications: 0, mentions: 0, archive: 0 });
const loading = ref(true);
const busy = ref(false);
const loadError = ref('');
const hasMore = ref(false);
const nextSkip = ref(0);

const hasUnread = computed(() => items.value.some((i) => i.unread));
const visibleTabs = computed(() => (
    prefs.value.showAllTab ? TABS : TABS.filter((x) => x !== 'all')
));
const groupByDate = computed(() => prefs.value.groupByDate);

const toggle = (key) => {
    prefs.value = { ...prefs.value, [key]: !prefs.value[key] };
    try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs.value));
    } catch (e) {
        // A preference that cannot be persisted still applies for this session.
    }

    // Hiding the All tab while standing on it would leave no tab selected.
    if (key === 'showAllTab' && !prefs.value.showAllTab && tab.value === 'all') {
        switchTab('notifications');
        return;
    }
    // Sort is decided by the server, so this one needs a refetch; the other two are
    // presentation over data already loaded.
    if (key === 'newestFirst') load(false);
};

const dayLabel = (key) => {
    if (key === 'today') return t('Inbox.today');
    if (key === 'yesterday') return t('Inbox.yesterday');
    // Month names arrive already formatted from the server.
    return key;
};
// Date AND time, formatted exactly as the mention dropdown formats it — same helper, so
// the two read identically and both follow the user's 12/24-hour setting.
const stamp = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    // getDateAndTime swallows its own errors and returns undefined; fall back rather than
    // render the word "undefined" in the column.
    return getDateAndTime(d.getTime()) || d.toLocaleDateString();
};
const render = (it) => changeText(String(it.message || ''));

// Who the row is FROM, resolved from the live company-user record exactly as the bell
// dropdown resolves it. A user getUser does not know still answers — with the ghost avatar
// and, for a removed member, their email as the name. That is the honest thing to show:
// "a person who is no longer here did this" reads better than an anonymous row, and it is
// what the bell already shows for the same notification.
const actorOf = (it) => (it.actorId ? getUser(it.actorId) : null);
const actorImage = (it) => actorOf(it)?.Employee_profileImageURL || '';
const actorName = (it) => actorOf(it)?.Employee_Name || '';

const loadCounts = async () => {
    try {
        const res = await apiRequest('get', `${env.INBOX}/counts`);
        if (res?.data?.status) counts.value = res.data.data || counts.value;
    } catch (e) {
        // Badges are decoration — never surface an error for them.
    }
};

const load = async (append = false) => {
    if (!append) { loading.value = true; loadError.value = ''; }
    busy.value = true;
    try {
        const skip = append ? nextSkip.value : 0;
        const sort = prefs.value.newestFirst ? 'newest' : 'oldest';
        // source is only meaningful on Archive; the server ignores it elsewhere.
        const res = await apiRequest('get', `${env.INBOX}?tab=${tab.value}&source=${source.value}&skip=${skip}&sort=${sort}`);
        if (!res?.data?.status) {
            // Surface the server's own message: a generic failure is undebuggable.
            loadError.value = res?.data?.statusText || t('Inbox.load_failed');
            if (!append) items.value = [];
            return;
        }
        const d = res.data.data || {};
        items.value = append ? [...items.value, ...(d.items || [])] : (d.items || []);
        hasMore.value = !!d.hasMore;
        nextSkip.value = d.nextSkip || 0;
    } catch (e) {
        loadError.value = e?.message || t('Inbox.load_failed');
        if (!append) items.value = [];
    } finally {
        loading.value = false;
        busy.value = false;
    }
};

const reload = async () => { await Promise.all([load(false), loadCounts()]); };
const loadMore = () => load(true);

/**
 * Arrive live, rather than on the next visit.
 *
 * myCounts is a stored counters document that moves over a socket the moment a
 * notification or mention is written, so watching it is the cue that something new
 * exists. The header's dot is driven from exactly this signal — which is why the dot
 * appeared instantly while the list behind it sat still.
 *
 * The counters themselves are NOT read: they drift (they are maintained by increments).
 * They are only a trigger to re-read the rows, which cannot drift.
 *
 * Debounced, because a single action can move the document more than once, and only the
 * settled state is worth a request. A page the user has paged through is reloaded from the
 * top: appending would put a new row underneath older ones, and dropping their loaded
 * pages mid-read is worse than the row appearing where it belongs.
 */
const liveCounts = computed(() => {
    const c = getters['users/myCounts']?.data || {};
    return [c.notification_counts, c.mention_counts];
});
let liveTimer = null;
const scheduleLiveRefresh = () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
        // Not while a request of our own is in flight, or the two race and the loser's
        // response overwrites the list.
        if (busy.value) { scheduleLiveRefresh(); return; }
        reload();
    }, 400);
};
// Only when a counter goes UP. Reading a row moves this document too, and refetching after
// every mark-as-read would undo the row we just removed by hand — with a visible flash on
// the way. A new arrival is the only thing that increases it.
let lastCounts = null;
watch(liveCounts, (next) => {
    const prev = lastCounts;
    lastCounts = next;
    if (!prev) return;
    if (next.some((n, i) => Number(n || 0) > Number(prev[i] || 0))) scheduleLiveRefresh();
}, { immediate: true });

const switchTab = (next) => {
    if (tab.value === next) return;
    tab.value = next;
    // The filter belongs to Archive. Carrying it to a tab that is already one kind would
    // leave it set but invisible, and it would still be applied on the way back.
    if (next !== 'archive') source.value = 'all';
    router.replace({ query: { ...route.query, tab: next, source: source.value } }).catch(() => {});
    load(false);
};

const switchSource = (next) => {
    if (source.value === next) return;
    source.value = next;
    router.replace({ query: { ...route.query, source: next } }).catch(() => {});
    load(false);
};

const post = async (path, body, okMessage) => {
    busy.value = true;
    try {
        const res = await apiRequest('post', `${env.INBOX}${path}`, body);
        if (!res?.data?.status) {
            $toast.error(res?.data?.statusText || t('Inbox.action_failed'), { position: 'top-right' });
            return false;
        }
        if (okMessage) $toast.success(okMessage, { position: 'top-right' });
        return true;
    } catch (e) {
        $toast.error(e?.message || t('Inbox.action_failed'), { position: 'top-right' });
        return false;
    } finally {
        busy.value = false;
    }
};

const toggleRead = async (it) => {
    const read = it.unread;
    // duplicateIds carries the rows collapsed into this one. One comment can produce two
    // mention records, and marking only the visible one read leaves its twin unread — the
    // badge counts it again and the row never clears.
    const payload = {
        items: [{
            sourceType: it.sourceType,
            sourceId: it.sourceId,
            duplicateIds: it.duplicateIds || [],
        }],
    };
    if (!read) payload.read = 'false';
    if (!(await post('/read', payload))) return;

    // Archive lists the rows that ARE read; every other tab lists the ones that are not
    // (planFor, Modules/Inbox/helpers). So a row whose state just flipped no longer belongs
    // to the tab it is on — in BOTH directions. Only the Archive half of that was handled,
    // which left a row marked read sitting in a list of unread things until the next load.
    const stillBelongs = tab.value === 'archive' ? read : !read;
    if (stillBelongs) {
        items.value = items.value.map((x) => (x.sourceId === it.sourceId ? { ...x, unread: !read } : x));
    } else {
        items.value = items.value.filter((x) => x.sourceId !== it.sourceId);
        // The row left the server's result set too, so the next page starts one earlier.
        // Without this, loading more after marking rows read steps over unseen rows.
        nextSkip.value = Math.max(0, nextSkip.value - 1);
    }
    loadCounts();
};

const markAllRead = async () => {
    if (!(await post('/read-all', { tab: tab.value }, t('Inbox.all_read_toast')))) return;
    // read-all is scoped to the tab server-side and the server refuses it on Archive, so
    // on any other tab there is nothing unread left for the list to hold — not just on the
    // page that was loaded.
    items.value = [];
    hasMore.value = false;
    nextSkip.value = 0;
    loadCounts();
};

/**
 * Open what the row is about, marking it read on the way.
 *
 * Routing is NOT decided here. openRoute is the function the bell and the @ dropdown
 * already navigate with, and this page exists to replace those two — so a second copy of
 * the rules would only be a second place for them to drift. It is handed the row under the
 * source field names it expects, and the same `key` the sidebars pass.
 *
 * What it does that a hand-rolled task route did not:
 *   - a mention lands on the Comment tab (detailTab=comment) and jumps to that comment
 *     via #comment_id; a notification lands on task-detail-tab
 *   - a mention from a chat channel opens the channel, not a task
 *   - a project-level notification opens the project, folder or sprint
 *   - a deleted or archived project says so instead of routing into nothing
 */
const open = (it) => {
    if (it.unread) toggleRead(it);
    openRoute(it, it.sourceType === 'notification' ? 'notifications' : 'mentions', { gettersVal: getters });
};

watch(() => route.query.tab, (next) => {
    if (!next) return;
    // Through resolveTab, so a link or a back button carrying ?tab=all cannot put someone
    // back on a tab they have switched off.
    const wanted = resolveTab(next);
    if (wanted !== tab.value) { tab.value = wanted; load(false); }
});

// The gear and the panel both stop propagation, so this only fires on a genuine click
// outside either of them.
const onDocClick = () => { customizeOpen.value = false; };

onMounted(async () => {
    document.addEventListener('click', onDocClick);
    // Keep the URL honest when resolveTab overrode what it asked for, so a refresh or a
    // copied link lands where the page actually is.
    if (route.query.tab !== tab.value) {
        router.replace({ query: { ...route.query, tab: tab.value } }).catch(() => {});
    }
    await loadCounts();
    await load(false);
});
onUnmounted(() => {
    document.removeEventListener('click', onDocClick);
    clearTimeout(liveTimer);
});
</script>

<style scoped>
.ibx {
    --ibx-primary: #2F3990;
    --ibx-primary-soft: #F0F2FF;
    --ibx-ink: #1F212A;
    --ibx-muted: #8A909C;
    --ibx-line: #EDEFF5;

    display: flex;
    flex-direction: column;
    height: 100%;
    background: #fff;
    overflow: hidden;
}

/* ── tabs ─────────────────────────────────────────────── */
.ibx__tabs { display: flex; border-bottom: 1px solid var(--ibx-line); flex: none; }
.ibx__tab {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 1 1 0;
    min-width: 0;
    padding: 15px 22px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--ibx-muted);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.12s ease, border-color 0.12s ease;
}
.ibx__tab + .ibx__tab { border-left: 1px solid var(--ibx-line); }
.ibx__tab:hover { color: var(--ibx-ink); }
.ibx__tab.is-active { color: var(--ibx-primary); border-bottom-color: var(--ibx-primary); }
.ibx__tab-ico { display: inline-flex; width: 16px; height: 16px; flex: none; }
.ibx__tab-ico :deep(svg) { width: 100%; height: 100%; }
.ibx__tab-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Red, not the navy accent — it means "unread", the same thing the header's red dot
   means, and it has to read as urgent rather than as decoration. Navy also collided with
   the active tab's own colour, so the badge disappeared into it. */
.ibx__count {
    min-width: 18px; padding: 0 5px;
    border-radius: 9px; background: #E14B4B; color: #fff;
    font-size: 11px; font-weight: 700; line-height: 17px; text-align: center;
}
/* Same red on an inactive tab: the count means the same thing wherever it sits, and
   greying it out on the tab you are NOT looking at hides exactly what you need to see. */
.ibx__tab:not(.is-active) .ibx__count { background: #E14B4B; }

/* ── toolbar ──────────────────────────────────────────── */
.ibx__bar {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; padding: 12px 20px; flex: none;
}
.ibx__hint { font-size: 12.5px; color: var(--ibx-muted); }
.ibx__bar-right { display: flex; align-items: center; gap: 8px; }
.ibx__gear {
    display: inline-flex; align-items: center; justify-content: center;
    width: 30px; height: 30px;
    border: 0; border-radius: 7px;
    background: transparent; color: var(--ibx-muted);
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease;
}
.ibx__gear :deep(svg) { width: 16px; height: 16px; }
.ibx__gear:hover, .ibx__gear.is-on { background: var(--ibx-primary-soft); color: var(--ibx-primary); }
.ibx__chip {
    padding: 6px 13px;
    border: 1px solid #DDE0EA; border-radius: 16px;
    background: #fff; color: #2A2C39;
    font-size: 12.5px; cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;
}
.ibx__chip:hover:not(:disabled) { background: #F6F7FC; }
.ibx__chip:disabled { opacity: 0.5; cursor: default; }

/* Archive's source filter. One pill holding three options rather than three loose chips:
   these are exclusive, and a segmented control says that where separate chips would read
   as three independent toggles. */
.ibx__seg {
    display: inline-flex;
    padding: 2px;
    border: 1px solid #DDE0EA; border-radius: 16px;
    background: #F6F7FC;
}
.ibx__seg-btn {
    border: 0; border-radius: 14px;
    padding: 4px 12px;
    background: transparent; color: #6B7280;
    font-size: 12.5px; cursor: pointer; white-space: nowrap;
    transition: background 0.12s ease, color 0.12s ease;
}
.ibx__seg-btn:hover:not(:disabled):not(.is-on) { color: #2A2C39; }
.ibx__seg-btn.is-on { background: #fff; color: var(--ibx-primary); font-weight: 600; box-shadow: 0 1px 2px rgba(42, 44, 57, 0.10); }
.ibx__seg-btn:disabled { opacity: 0.5; cursor: default; }
.ibx__link { border: 0; background: transparent; padding: 0; color: var(--ibx-primary); font-size: 12.5px; font-weight: 600; cursor: pointer; }

/* ── list ─────────────────────────────────────────────── */
.ibx__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 0 28px; }
.ibx__day {
    padding: 18px 20px 7px;
    font-size: 11px; font-weight: 700;
    letter-spacing: 0.05em; text-transform: uppercase;
    color: #A0A6B4;
}
.ibx__day:first-child { padding-top: 6px; }

.ibx__row {
    display: grid;
    grid-template-columns: minmax(110px, 1fr) 24px minmax(0, 2.4fr) 194px;
    align-items: center;
    gap: 12px;
    /* Height is pinned so hovering swaps what is drawn, never the layout — otherwise
       the list appears to bounce as the pointer moves down it. */
    height: 48px;
    padding: 0 20px 0 17px;
    border-left: 3px solid transparent;
    border-bottom: 1px solid var(--ibx-line);
    background: #fff;
    cursor: pointer;
    transition: background 0.1s ease;
}
.ibx__row:hover { background: #FAFAFC; }

/* Unread has to be obvious at a glance across a long list, so it carries FOUR signals,
   not one: a filled left edge, a tinted background, bolder text, and a dot before the
   task name. The left border alone — which is all this had — vanishes the moment the
   eye is more than a row or two away. */
.ibx__row.is-unread {
    border-left-color: var(--ibx-primary);
    background: var(--ibx-primary-soft);
}
.ibx__row.is-unread:hover { background: #E7EAFF; }
.ibx__row.is-unread .ibx__name {
    position: relative;
    padding-left: 14px;
    font-weight: 700;
    color: var(--ibx-ink);
}
/* The dot. Small, but it is the thing that reads as "new" rather than "highlighted". */
.ibx__row.is-unread .ibx__name::before {
    content: "";
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ibx-primary);
}
.ibx__row.is-unread .ibx__text { color: #2A2C39; font-weight: 500; }
.ibx__row.is-unread .ibx__when { color: var(--ibx-primary); font-weight: 600; }
.ibx__row.is-unread .ibx__avatar { color: var(--ibx-primary); }

.ibx__name {
    font-size: 13px; font-weight: 500; color: #4A4E5C;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ibx__avatar { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; color: #B4B9C6; }
/* UserProfile sizes its own wrapper and image; these only round it off and stop it being
   squeezed by the grid column. */
.ibx__avatar :deep(.profile-image) { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; }
.ibx__avatar :deep(svg) { width: 15px; height: 15px; }
/* A mention is about YOU, so it gets the accent; a notification stays neutral. Same
   distinction the two header icons make. Applies to the fallback icon only — an avatar
   has no stroke to tint. */
.ibx__avatar.is-mention { color: var(--ibx-primary); }
.ibx__text {
    font-size: 13px; color: #6B7280; line-height: 1.45;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* The name leads, and stays whole: it is the part that says whose row this is, so the
   message is what gets clipped when the row runs out of width. */
.ibx__actor { color: var(--ibx-ink); font-weight: 600; margin-right: 5px; white-space: nowrap; }
.ibx__msg { color: inherit; }
.ibx__text :deep(.mentioned) { color: var(--ibx-primary); font-weight: 600; }
.ibx__text :deep(b), .ibx__text :deep(strong) { color: var(--ibx-ink); font-weight: 600; }
/* Status and priority chips arrive as spans carrying their own background and colour —
   the same markup the notification dropdown renders. Only the box needs settling so a
   chip sits on the row's baseline instead of stretching its line height. */
.ibx__text :deep(span[style]) {
    display: inline-block;
    padding-top: 1px;
    padding-bottom: 1px;
    line-height: 1.35;
    vertical-align: baseline;
    white-space: nowrap;
}

.ibx__right {
    display: flex; align-items: center; justify-content: flex-end;
    width: 194px; height: 26px; flex: none;
}
.ibx__resting { display: inline-flex; align-items: center; height: 100%; }
.ibx__when { font-size: 11.5px; color: #A0A6B4; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ibx__hover { display: none; align-items: center; height: 100%; }
.ibx__row:hover .ibx__resting { display: none; }
.ibx__row:hover .ibx__hover { display: inline-flex; }
.ibx__act {
    height: 26px; padding: 0 11px;
    border: 0; border-radius: 6px;
    background: var(--ibx-primary); color: #fff;
    font-size: 12px; font-weight: 600;
    white-space: nowrap; cursor: pointer;
}
.ibx__act:hover:not(:disabled) { background: #262E75; }
.ibx__act:disabled { opacity: 0.6; cursor: default; }

.ibx__state { padding: 48px 0; text-align: center; color: var(--ibx-muted); font-size: 13px; }
.ibx__state--error { color: #C0392B; }
.ibx__zero { padding: 72px 0; text-align: center; }
.ibx__zero-mark {
    display: inline-flex; align-items: center; justify-content: center;
    width: 54px; height: 54px; margin-bottom: 16px;
    border-radius: 50%; background: #E4F5EA; color: #1B7F3B;
}
.ibx__zero-mark :deep(svg) { width: 26px; height: 26px; }
.ibx__zero-title { font-size: 17px; font-weight: 700; color: var(--ibx-ink); margin: 0 0 6px; }
.ibx__zero-sub { font-size: 13px; color: var(--ibx-muted); margin: 0; }

.ibx__more {
    display: block; margin: 18px auto 0;
    border: 1px solid #DDE0EA; border-radius: 7px;
    background: #fff; color: var(--ibx-primary);
    font-size: 12.5px; font-weight: 600;
    padding: 8px 18px; cursor: pointer;
}
.ibx__more:disabled { opacity: 0.55; cursor: default; }

/* ── settings dropdown ───────────────────────────────── */
.ibx__cog { position: relative; }
.ibx__menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 12;
    min-width: 212px;
    padding: 5px;
    background: #fff;
    border: 1px solid #E3E6EF;
    border-radius: 10px;
    box-shadow: 0 12px 30px rgba(31, 33, 42, 0.13);
}
.ibx__menu-item {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) 16px;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 9px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease;
}
.ibx__menu-item:hover { background: #F5F6FA; }
.ibx__menu-item.is-on .ibx__menu-label,
.ibx__menu-item.is-on .ibx__menu-ico,
.ibx__menu-item.is-on .ibx__menu-tick { color: var(--ibx-primary); }
.ibx__menu-item.is-on .ibx__menu-label { font-weight: 600; }
.ibx__menu-ico { display: inline-flex; width: 16px; height: 16px; color: #6B7280; }
.ibx__menu-ico :deep(svg) { width: 100%; height: 100%; }
.ibx__menu-label { font-size: 13px; color: var(--ibx-ink); }
/* The tick column is always reserved, so rows do not shift as settings are flipped. */
.ibx__menu-tick { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; }
.ibx__menu-tick :deep(svg) { width: 14px; height: 14px; }


@media (max-width: 900px) {
    .ibx__tab-label { display: none; }
    .ibx__tab { justify-content: center; padding: 14px 8px; }
    .ibx__row { grid-template-columns: minmax(0, 1fr) 194px; height: 44px; }
    /* The dropdown is anchored to the gear at the right edge, so on a narrow screen it
       would otherwise run off it. */
    .ibx__menu { min-width: 190px; }
    .ibx__avatar, .ibx__text { display: none; }
}
</style>
