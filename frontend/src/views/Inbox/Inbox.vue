<template>
    <div class="ibx">
        <div class="ibx__tabs" role="tablist">
            <button
                v-for="t in TABS"
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
            <button
                v-if="tab !== 'archive'"
                class="ibx__chip"
                :disabled="busy || !hasUnread"
                @click="markAllRead"
            >{{ $t('Inbox.mark_all_read') }}</button>
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
                    <div v-if="it.dateGroup !== items[i - 1]?.dateGroup" class="ibx__day">
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

                        <span class="ibx__avatar">
                            <img v-if="it.actorImage" :src="it.actorImage" alt="" @error="onAvatarError" />
                            <span v-else v-html="it.sourceType === 'mention' ? ICONS.at : ICONS.bell"></span>
                        </span>

                        <!--
                          v-html because these messages ARE html — the writers store <b>
                          tags. changeText flattens mention tokens the same way the header
                          sidebar and chat list do, so @Name reads the same everywhere.
                        -->
                        <span class="ibx__text" v-html="render(it)"></span>

                        <!-- Fixed-width slot: the hover button is wider than the time, and
                             letting it size to content made every row shift on hover. -->
                        <span class="ibx__right">
                            <span class="ibx__resting">
                                <time class="ibx__when" :title="it.createdAt">{{ clock(it.createdAt) }}</time>
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
import { defineComponent, ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useCustomComposable } from '@/composable';

// vue/multi-word-component-names — the repo's convention for a single-word view, the
// same as Chat.vue's "chat-component".
defineComponent({ name: 'inbox-component' });

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const $toast = useToast();
// The app's own mention-token flattener, shared with the header sidebar and chat list.
const { changeText } = useCustomComposable();

// One tab per thing the user already has, plus All to see them together.
const TABS = ['all', 'notifications', 'mentions', 'archive'];

// Inline so the view carries no image requests and every glyph inherits currentColor.
const ICONS = {
    all: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    notifications: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    mentions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>',
    archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    at: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
};

const tab = ref(TABS.includes(route.query.tab) ? route.query.tab : 'all');
const items = ref([]);
const counts = ref({ all: 0, notifications: 0, mentions: 0, archive: 0 });
const loading = ref(true);
const busy = ref(false);
const loadError = ref('');
const hasMore = ref(false);
const nextSkip = ref(0);

const hasUnread = computed(() => items.value.some((i) => i.unread));

const dayLabel = (key) => {
    if (key === 'today') return t('Inbox.today');
    if (key === 'yesterday') return t('Inbox.yesterday');
    // Month names arrive already formatted from the server.
    return key;
};
const clock = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
const render = (it) => changeText(String(it.message || ''));

// A profile image can 404 (deleted user, expired presigned URL). Hide the broken glyph
// so the fallback icon shows instead of a torn-image box.
const onAvatarError = (e) => { if (e?.target) e.target.style.display = 'none'; };

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
        const res = await apiRequest('get', `${env.INBOX}?tab=${tab.value}&skip=${skip}`);
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

const switchTab = (next) => {
    if (tab.value === next) return;
    tab.value = next;
    router.replace({ query: { ...route.query, tab: next } }).catch(() => {});
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
    const payload = { items: [{ sourceType: it.sourceType, sourceId: it.sourceId }] };
    if (!read) payload.read = 'false';
    if (!(await post('/read', payload))) return;

    // The row stays where it is; only its emphasis changes. On Archive a row that becomes
    // unread no longer belongs there, so drop it.
    if (tab.value === 'archive' && !read) {
        items.value = items.value.filter((x) => x.sourceId !== it.sourceId);
    } else {
        items.value = items.value.map((x) => (x.sourceId === it.sourceId ? { ...x, unread: !read } : x));
    }
    loadCounts();
};

const markAllRead = async () => {
    if (!(await post('/read-all', { tab: tab.value }, t('Inbox.all_read_toast')))) return;
    items.value = items.value.map((x) => ({ ...x, unread: false }));
    loadCounts();
};

/**
 * Open the task the row is about, marking it read on the way.
 *
 * A task route needs the sprint as well as the project, and takes a different shape when
 * the sprint sits in a folder. Rows without a task are not links.
 */
const open = (it) => {
    if (it.unread) toggleRead(it);
    if (!it.taskId || !it.projectId || !it.sprintId) return;

    const target = it.folderId
        ? {
            name: 'ProjectFolderSprintTask',
            params: {
                cid: route.params.cid, id: it.projectId,
                folderId: it.folderId, sprintId: it.sprintId, taskId: it.taskId,
            },
        }
        : {
            name: 'ProjectSprintTask',
            params: {
                cid: route.params.cid, id: it.projectId,
                sprintId: it.sprintId, taskId: it.taskId,
            },
        };
    router.push(target).catch(() => {
        // A stale notification can point at a task that has since moved or been deleted.
        // Staying put beats an unhandled router rejection.
    });
};

watch(() => route.query.tab, (next) => {
    if (next && TABS.includes(next) && next !== tab.value) { tab.value = next; load(false); }
});

onMounted(async () => {
    await loadCounts();
    await load(false);
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
.ibx__count {
    min-width: 18px; padding: 0 5px;
    border-radius: 9px; background: var(--ibx-primary); color: #fff;
    font-size: 11px; font-weight: 700; line-height: 17px; text-align: center;
}
.ibx__tab:not(.is-active) .ibx__count { background: #C7CBDA; }

/* ── toolbar ──────────────────────────────────────────── */
.ibx__bar {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; padding: 12px 20px; flex: none;
}
.ibx__hint { font-size: 12.5px; color: var(--ibx-muted); }
.ibx__chip {
    padding: 6px 13px;
    border: 1px solid #DDE0EA; border-radius: 16px;
    background: #fff; color: #2A2C39;
    font-size: 12.5px; cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;
}
.ibx__chip:hover:not(:disabled) { background: #F6F7FC; }
.ibx__chip:disabled { opacity: 0.5; cursor: default; }
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
    grid-template-columns: minmax(110px, 1fr) 20px minmax(0, 2.6fr) 132px;
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
/* Unread reads from the left edge AND the weight — a tint alone disappears next to
   the hover state. */
.ibx__row.is-unread { border-left-color: var(--ibx-primary); }
.ibx__row.is-unread .ibx__name { font-weight: 700; color: var(--ibx-ink); }
.ibx__row.is-unread .ibx__text { color: #3A3D4A; }

.ibx__name {
    font-size: 13px; font-weight: 500; color: #4A4E5C;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ibx__avatar { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; color: #B4B9C6; }
.ibx__avatar img { width: 18px; height: 18px; border-radius: 50%; object-fit: cover; }
.ibx__avatar :deep(svg) { width: 15px; height: 15px; }
.ibx__text {
    font-size: 13px; color: #6B7280; line-height: 1.45;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ibx__text :deep(.mentioned) { color: var(--ibx-primary); font-weight: 600; }
.ibx__text :deep(b), .ibx__text :deep(strong) { color: var(--ibx-ink); font-weight: 600; }

.ibx__right {
    display: flex; align-items: center; justify-content: flex-end;
    width: 132px; height: 26px; flex: none;
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

@media (max-width: 900px) {
    .ibx__tab-label { display: none; }
    .ibx__tab { justify-content: center; padding: 14px 8px; }
    .ibx__row { grid-template-columns: minmax(0, 1fr) 132px; height: 44px; }
    .ibx__avatar, .ibx__text { display: none; }
}
</style>
