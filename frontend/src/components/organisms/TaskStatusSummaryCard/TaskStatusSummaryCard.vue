<template>
    <div class="tss">
        <CardSkeleton v-if="loading && !loaded" :counters="3" :rows="4" />
        <template v-else>
            <!-- One counter per status the card is configured to show. Read-only: the
                 breakdown lives in the matrix below, so these stay totals and nothing
                 else. -->
            <div v-if="!boxes.length" class="tss-msg">{{ $t('dashboardCard.tss_no_status') }}</div>
            <div v-else class="tss-boxes">
                <div
                    v-for="b in boxes"
                    :key="b.statusKey"
                    class="tss-box"
                    :class="{ 'is-zero': !b.count }"
                    :style="{ '--tss-accent': b.color }"
                >
                    <span class="tss-num">{{ b.count }}</span>
                    <span class="tss-name" :title="b.name"><i class="tss-dot"></i>{{ b.name }}</span>
                </div>
            </div>

            <!-- The count of what is on screen and the way to narrow it, on one line —
                 they are the same question asked twice. Whose numbers these are moved to
                 the card header, next to the period it covers. -->
            <div class="tss-meta">
                <span class="tss-total">{{ $t('dashboardCard.tss_total', { n: total }) }}</span>
                <input
                    v-model="userSearch"
                    type="search"
                    class="tss-search"
                    :placeholder="$t('dashboardCard.tss_search_user_placeholder')"
                    @mousedown.stop
                    @keydown.stop
                />
            </div>

            <!-- The matrix: who has what, per status. A count opens its tasks in place,
                 as a row under the person it belongs to — the table stays put, so you can
                 read one person's list without losing your place in everyone else's. -->
            <div v-if="!visibleUsers.length" class="tss-msg">
                {{ userSearch ? $t('dashboardCard.tss_no_user_match', { q: userSearch }) : $t('dashboardCard.tss_no_users') }}
            </div>
            <div v-else class="tss-table-wrap">
                <table class="tss-table tss-matrix">
                    <thead>
                        <tr>
                            <th class="tss-th tss-th--user">{{ $t('dashboardCard.tss_col_user') }}</th>
                            <!-- Hours sit next to the name, before the status columns: they
                                 describe the person's whole row, not any one status. -->
                            <th class="tss-th tss-th--hours">{{ $t('dashboardCard.tss_col_estimate') }}</th>
                            <th class="tss-th tss-th--hours">{{ $t('dashboardCard.tss_col_logged') }}</th>
                            <th class="tss-th tss-th--hours" :title="$t('dashboardCard.tss_overdue_hours_hint')">
                                {{ $t('dashboardCard.tss_col_overdue_hours') }}
                            </th>
                            <th v-for="b in boxes" :key="'h' + b.statusKey" class="tss-th tss-th--num" :title="b.name">
                                {{ b.name }}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="u in visibleUsers" :key="u.userId || 'unassigned'">
                            <tr class="tss-tr" :class="{ 'is-open': isOpenUser(u) }">
                                <td class="tss-td tss-td--user" :title="userLabel(u)">{{ userLabel(u) }}</td>
                                <td class="tss-td tss-td--hours">{{ u.estimateMinutes ? formatMinutes(u.estimateMinutes) : '—' }}</td>
                                <td class="tss-td tss-td--hours">{{ u.loggedMinutes ? formatMinutes(u.loggedMinutes) : '—' }}</td>
                                <!-- Logged plus the overrun. Red only when there IS an
                                     overrun — without one this equals the Logged column
                                     and nothing went wrong. -->
                                <td
                                    class="tss-td tss-td--hours"
                                    :class="{ 'tss-over': u.overEstimateMinutes > 0 }"
                                    :title="u.overEstimateMinutes > 0 ? $t('dashboardCard.tss_overdue_hours_row', { hours: formatMinutes(u.overEstimateMinutes) }) : ''"
                                >{{ loggedPlusOver(u) ? formatMinutes(loggedPlusOver(u)) : '—' }}</td>
                                <td
                                    v-for="b in boxes"
                                    :key="(u.userId || 'unassigned') + '-' + b.statusKey"
                                    class="tss-td tss-td--num"
                                    :class="{ 'tss-cell--link': cellCount(u, b) > 0, 'is-open': isOpenCell(u, b) }"
                                    :title="cellCount(u, b) > 0 ? $t('dashboardCard.tss_open_cell', { user: userLabel(u), status: b.name }) : ''"
                                    @click="toggleDrill(u, b)"
                                    @mousedown.stop
                                >{{ cellCount(u, b) || '—' }}</td>
                            </tr>

                            <!-- The expansion. Spans the whole table so the task list is not
                                 squeezed into one status column's width. -->
                            <tr v-if="isOpenUser(u)" class="tss-expand-tr">
                                <!-- +4: username, Estimate, Logged and Overdue Hrs, on top of one per status. -->
                                <td class="tss-expand" :colspan="boxes.length + 4" :style="{ '--tss-accent': drill.color }">
                                    <button type="button" class="tss-expand-close" :title="$t('dashboardCard.tss_close_list')" @click="closeDrill">✕</button>

                                    <!-- A cell cannot bound its own height, so the scroll
                                         belongs to a block inside it. -->
                                    <div class="tss-expand-inner" @scroll.passive="onRowsScroll">
                                    <div v-if="drillLoading" class="tss-msg">{{ $t('dashboardCard.tss_loading_tasks') }}</div>
                                    <div v-else-if="!rows.length" class="tss-msg">{{ $t('dashboardCard.tss_no_tasks') }}</div>
                                    <template v-else>
                                        <table class="tss-table tss-inner">
                                            <thead>
                                                <tr>
                                                    <th class="tss-th tss-th--task">{{ $t('dashboardCard.tss_col_task') }}</th>
                                                    <th class="tss-th tss-th--who">{{ $t('dashboardCard.tss_col_employee') }}</th>
                                                    <th class="tss-th tss-th--num">{{ $t('dashboardCard.tss_col_estimate') }}</th>
                                                    <th class="tss-th tss-th--num">{{ $t('dashboardCard.tss_col_logged') }}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr v-for="r in rows" :key="r.taskId" class="tss-tr">
                                                    <td class="tss-td tss-td--task">
                                                        <span
                                                            class="tss-task"
                                                            :class="{ 'tss-task--link': r.projectId }"
                                                            :title="(r.taskKey ? r.taskKey + ' ' : '') + r.taskName"
                                                            @click="openTaskDetail(r)"
                                                            @mousedown.stop
                                                        >
                                                            <b v-if="r.taskKey" class="tss-key">{{ r.taskKey }}</b> {{ r.taskName }}
                                                        </span>
                                                    </td>
                                                    <td class="tss-td tss-td--who" :title="whoTitle(r)">{{ who(r) }}</td>
                                                    <td class="tss-td tss-td--num">{{ r.estimateMinutes ? formatMinutes(r.estimateMinutes) : '—' }}</td>
                                                    <td class="tss-td tss-td--num" :class="{ 'tss-over': isOver(r) }">
                                                        {{ r.loggedMinutes ? formatMinutes(r.loggedMinutes) : '—' }}
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                        <!-- Nothing is capped any more; scrolling brings the
                                             rest. This only says a page is on its way, so
                                             the list does not look finished while it is. -->
                                        <div v-if="rowsBusy" class="tss-capped">{{ $t('dashboardCard.tss_loading_tasks') }}</div>
                                    </template>
                                    </div>
                                </td>
                            </tr>
                        </template>
                    </tbody>
                </table>
                <div v-if="usersCapped" class="tss-capped">
                    {{ $t('dashboardCard.tss_users_capped', { n: visibleUsers.length }) }}
                </div>
            </div>
        </template>

    </div>
</template>

<script>
export default { name: 'TaskStatusSummaryCard' };
</script>

<script setup>
import { ref, computed, watch, onMounted, inject } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { resolveCardRange, formatMinutes } from '@/composable/useResourceWorkload';
import CardSkeleton from '@/components/atom/CardSkeleton/CardSkeleton.vue';

// Task counts per status for the selected window, with a per-status drill-down.
//
// Statuses are per-project and fully configurable, so nothing here is hardcoded: the
// boxes come from whatever the card's `status` setting selected, resolved against the
// company's own status list (settings/AllTaskStatus, handed down as taskStatusArray).
//
// Scoping is the SERVER's call — Owner/Admin get the company, everyone else gets their
// own tasks. The card only reports which it got.
const props = defineProps({
    cardUID: { type: [String, Number], default: '' },
    componentId: { type: String, default: '' },
    cardData: { type: Object, default: () => ({}) },
    filterData: { type: [Array, Object], default: () => [] },
    refreshTrigger: { type: [Number, String], default: 0 },
    companyUserDetail: { type: Object, default: () => ({}) },
    allProjectsArrayFilter: { type: Array, default: () => [] },
    taskStatusArray: { type: [Array, Object], default: () => ({}) },
});

const { t } = useI18n();
const companyId = inject('$companyId', ref(''));
const router = useRouter();
const globalRange = inject('dashboardGlobalRange', null);

// One page of the drill-down list. Smaller than the old flat 50: the list scrolls in a
// 240px box, so a page only has to outlast a couple of flicks, and a smaller first page
// puts the tasks on screen sooner.
const ROW_LIMIT = 25;

const timerange = computed(() => {
    const v = Number(props.cardData?.timerange);
    return Number.isFinite(v) && v >= 0 && v <= 8 ? v : 3; // default This Week; 0 = Auto
});

const counts = ref({});          // statusKey -> count, from the server
const total = ref(0);
const scope = ref('self');
const users = ref([]);           // [{ userId, name, counts, total }] — "" userId = unassigned
const usersCapped = ref(false);
const rows = ref([]);
const loading = ref(false);
const loaded = ref(false);
const drillLoading = ref(false);
const rowsHasMore = ref(false);
const rowsNextSkip = ref(0);
const rowsBusy = ref(false);
// Which cell of the matrix is open: { userId, unassigned, statusKey, userName, statusName, color }
const drill = ref(null);
const userSearch = ref('');

// The company's status list: { key, name, textColor }. Same shape the pie/bar cards read.
const statusSettings = computed(() => {
    const a = props.taskStatusArray;
    const list = Array.isArray(a) ? a : (a && a.settings) || [];
    return Array.isArray(list) ? list : [];
});

// Which statuses this card shows. The `status` setting stores the selected keys; an
// empty selection means "all of them", so a newly added card is useful immediately.
const selectedKeys = computed(() => {
    const v = props.cardData?.statusArray;
    const keys = (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isFinite(n));
    return keys.length ? keys : statusSettings.value.map((s) => Number(s.key));
});

const boxes = computed(() => selectedKeys.value.map((key) => {
    const meta = statusSettings.value.find((s) => Number(s.key) === key) || {};
    return {
        statusKey: key,
        name: meta.name || t('dashboardCard.tss_unknown_status'),
        color: meta.textColor || '#6473e8',
        // A status with nothing in it still gets a box: "zero in review" is a real
        // answer, and boxes appearing and vanishing between periods reads as broken.
        count: Number(counts.value[key]) || 0,
    };
}));

const scopeLabel = computed(() => (scope.value === 'company'
    ? t('dashboardCard.tss_scope_company')
    : t('dashboardCard.tss_scope_self')));

// Whose numbers these are belongs in the card header, beside the period they cover — both
// qualify the same figures. Held back until the first response, or the card would claim
// "My tasks" for a moment before the server says otherwise.
const headerBadge = inject('dashboardCardBadge', null);
watch([loaded, scopeLabel], () => {
    if (headerBadge) headerBadge.value = loaded.value ? scopeLabel.value : '';
}, { immediate: true });

// Tasks nobody is assigned to still belong to the window, so they get a row rather than
// going missing between the counters and the matrix.
const userLabel = (u) => (u.userId ? (u.name || '-') : t('dashboardCard.tss_unassigned'));
const cellCount = (u, b) => Number(u.counts && u.counts[b.statusKey]) || 0;

// Searching the rows already in hand, not the server: the matrix is one row per person,
// which is a list a browser filters instantly and a round-trip only makes slower.
const visibleUsers = computed(() => {
    const term = userSearch.value.trim().toLowerCase();
    if (!term) return users.value;
    return users.value.filter((u) => userLabel(u).toLowerCase().includes(term));
});

const who = (r) => (r.assignees && r.assignees.length
    ? r.assignees.map((a) => a.name).join(', ')
    : '—');
const whoTitle = (r) => (r.assignees && r.assignees.length > 1
    ? t('dashboardCard.tss_assignees', { n: r.assignees.length }) + ': ' + who(r)
    : who(r));
const isOver = (r) => !!r.estimateMinutes && r.loggedMinutes > r.estimateMinutes;

/**
 * Logged time plus the overrun, as specified.
 *
 * Read this as an emphasis figure rather than an amount of work: the overrun is already
 * part of the logged total (a task estimated at 3h with 5h against it contributes 5h
 * logged AND 2h over, the 2 being part of the 5), so this sum counts those hours twice and
 * is larger than anyone actually worked. It is deliberate — it weights a row by how far it
 * ran past its estimates. The Logged column beside it carries the true figure.
 *
 * Dash when nothing has been logged: there is nothing to weight.
 */
const loggedPlusOver = (u) => (u.loggedMinutes ? u.loggedMinutes + (u.overEstimateMinutes || 0) : 0);

const requestBody = (skip = 0) => {
    const { dateFrom, dateTo } = resolveCardRange(timerange.value, globalRange && globalRange.value);
    const d = drill.value;
    return {
        dateFrom,
        dateTo,
        statusKeys: props.cardData?.statusArray || [],
        projectId: props.cardData?.projectId || [],
        projectMode: props.cardData?.projectMode || 'all',
        // The task rows are only asked for while a cell is open. The counters and the
        // matrix come back either way, so the card behind the list stays current.
        ...(d
            ? {
                statusKey: d.statusKey,
                limit: ROW_LIMIT,
                skip,
                ...(d.unassigned ? { unassigned: true } : { userId: d.userId }),
            }
            : {}),
    };
};

const load = async () => {
    loading.value = true;
    // Whichever cell was open stays open across a reload, so changing the period does not
    // silently collapse the detail the user was reading.
    if (drill.value) drillLoading.value = true;
    try {
        const res = await apiRequest('post', `${env.TASKS_BY_STATUS}`, requestBody(0));
        const d = (res && res.data && res.data.status) ? (res.data.data || {}) : {};
        const map = {};
        (d.statuses || []).forEach((s) => { map[Number(s.statusKey)] = Number(s.count) || 0; });
        counts.value = map;
        total.value = Number(d.total) || 0;
        scope.value = d.scope || 'self';
        users.value = d.users || [];
        usersCapped.value = d.usersCapped === true;
        rows.value = d.rows || [];
        rowsHasMore.value = d.rowsHasMore === true;
        rowsNextSkip.value = Number(d.rowsNextSkip) || rows.value.length;
        loaded.value = true;
    } catch (e) {
        console.error('TaskStatusSummaryCard fetch error:', e);
        counts.value = {};
        total.value = 0;
        users.value = [];
        rows.value = [];
        rowsHasMore.value = false;
    } finally {
        loading.value = false;
        drillLoading.value = false;
    }
};

/**
 * The next page of the open list, appended.
 *
 * Only the rows are taken from the response: the counters and the matrix are unchanged by
 * scrolling, and letting them overwrite would re-render the whole table under the pointer
 * mid-scroll.
 */
const loadMoreRows = async () => {
    if (rowsBusy.value || !rowsHasMore.value || !drill.value) return;
    rowsBusy.value = true;
    try {
        const res = await apiRequest('post', `${env.TASKS_BY_STATUS}`, requestBody(rowsNextSkip.value));
        const d = (res && res.data && res.data.status) ? (res.data.data || {}) : {};
        rows.value = [...rows.value, ...(d.rows || [])];
        // The server's own answer, not an inference from page length: a full page is not
        // evidence of more, and a short one is not proof there is nothing left.
        rowsHasMore.value = d.rowsHasMore === true;
        rowsNextSkip.value = Number(d.rowsNextSkip) || rows.value.length;
    } catch (e) {
        console.error('TaskStatusSummaryCard page fetch error:', e);
        // Leave hasMore alone — a failed page is not the end of the list, and the next
        // scroll should be able to try again.
    } finally {
        rowsBusy.value = false;
    }
};

// Within 60px of the bottom is close enough to start fetching: the next page lands before
// the user reaches the end, so the list reads as continuous rather than as a stall.
const onRowsScroll = (e) => {
    const el = e && e.target;
    if (!el || !rowsHasMore.value || rowsBusy.value) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 60) loadMoreRows();
};

// Which row is expanded, and which of its cells opened it. Keyed on the row rather than
// the name, so two people who share a name still expand independently.
const rowKey = (u) => (u.userId || 'unassigned');
const isOpenUser = (u) => !!drill.value && drill.value.rowKey === rowKey(u);
const isOpenCell = (u, b) => isOpenUser(u) && drill.value.statusKey === b.statusKey;

const toggleDrill = (u, b) => {
    // An empty cell has nothing to open, and a list that comes back empty reads as a
    // failure rather than as a zero.
    if (cellCount(u, b) <= 0) return;
    // The same cell again closes it — the expansion is the cell's own state, so the cell
    // is what turns it off.
    if (isOpenCell(u, b)) { closeDrill(); return; }
    drill.value = {
        rowKey: rowKey(u),
        userId: u.userId,
        unassigned: !u.userId,
        statusKey: b.statusKey,
        userName: userLabel(u),
        statusName: b.name,
        color: b.color,
    };
    // A different cell is a different list: carrying the previous one's offset would start
    // the new one part-way through, silently skipping its first rows.
    rows.value = [];
    rowsHasMore.value = false;
    rowsNextSkip.value = 0;
    load();
};

const closeDrill = () => {
    drill.value = null;
    rows.value = [];
    rowsHasMore.value = false;
    rowsNextSkip.value = 0;
};

/**
 * Open the task where it lives.
 *
 * Navigates into the project first and lets the task detail open there, rather than
 * mounting the sidebar over the dashboard. The task then sits in its own project, with the
 * sprint, the board and the breadcrumb around it — and the URL is somewhere you can go
 * back to or share, which a sidebar floating over a dashboard was not.
 *
 * folderObjId picks the route: a sprint inside a folder is a different route from a sprint
 * directly on the project, and the folder variant needs the folder id in its params.
 * sprintId is required by both, so a row without one is not navigable.
 */
function openTaskDetail(r) {
    if (!r || !r.taskId || !r.projectId || !r.sprintId) return;
    router.push({
        name: r.folderId ? 'ProjectFolderSprintTask' : 'ProjectSprintTask',
        params: {
            cid: companyId.value,
            id: r.projectId,
            ...(r.folderId ? { folderId: r.folderId } : {}),
            sprintId: r.sprintId,
            taskId: r.taskId,
        },
        query: { detailTab: 'task-detail-tab' },
    }).catch(() => {});
}

watch(() => props.refreshTrigger, load);
watch(() => props.cardData, load, { deep: true });
// Auto mode only — otherwise the card's own period wins and the global picker is noise.
watch(() => globalRange && globalRange.value, () => { if (timerange.value === 0) load(); }, { deep: true });
onMounted(load);
</script>

<style scoped>
/* One palette for the whole card, so nothing is picked twice by eye. `faint` is what the
   empty cells use: a table this wide is mostly dashes, and they should sit well behind the
   numbers that are actually there. */
.tss {
    --ink: #1f2430;
    --body: #3a3f52;
    --muted: #8b90a3;
    --faint: #c9cdd8;
    --hairline: #eef0f5;
    --surface: #f7f8fb;
    --accent: #0e7490;
    --accent-tint: #eaf4f7;
}

/* The card itself does NOT scroll: the counters and the total line stay put, and only the
   table moves. That is what lets the table header stick — a sticky header needs a scroll
   container with a bounded height, and the card body has no bound. Same shape
   MilestoneReportCard and the Inbox page use. */
.tss { height: 100%; width: 100%; padding: 10px 12px; overflow: hidden; display: flex; flex-direction: column; gap: 10px; }
.tss-msg { color: var(--muted); font-size: 12px; padding: 10px 2px; }

/* Counter row. Wraps rather than scrolls: a status that fell off the right edge is a
   status nobody counts. */
.tss-boxes { display: flex; flex-wrap: wrap; gap: 8px; flex: 0 0 auto; }
/* Read-only counters. No hover, no cursor, no selected state — nothing here reacts to a
   click, so nothing here should look like it would. */
.tss-box {
    flex: 1 1 96px;
    min-width: 92px;
    border-radius: 10px;
    background: var(--surface);
    padding: 10px 8px 9px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
/* The number is ink, not the status colour. Status colours come from settings and are not
   chosen for contrast on white — a pale "On Hold" yellow rendered a real count nearly
   invisible. The colour moves to the dot, where it identifies without having to be read. */
/* Numbers stay on one line across the row and labels sit on the floor of the tile, so a
   two-line status name lengthens the tiles without knocking the counts out of line. */
.tss-num { font-size: 21px; font-weight: 700; color: var(--ink); line-height: 1.15; font-variant-numeric: tabular-nums; }
.tss-box .tss-name { margin-top: auto; }
/* Status names are whatever the company typed, so the label has to survive any length.
   It wraps instead of truncating — the previous version put text-overflow on a centred
   flex container, where ellipsis does not apply at all, so "Ready For Production" was
   clipped at BOTH ends into ":ADY FOR PRODUC". Two lines is the ceiling; past that the
   clamp trims and the title attribute carries the rest. */
.tss-name {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-align: center;
    font-size: 9.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
    line-height: 1.35;
    color: var(--muted);
    /* A single unbroken word — a name with no spaces — breaks rather than escaping the tile. */
    overflow-wrap: anywhere;
}
.tss-dot {
    display: inline-block; vertical-align: middle;
    width: 6px; height: 6px; margin: -1px 5px 0 0;
    border-radius: 50%; background: var(--tss-accent);
}
/* Nothing in it: the tile stays for the sake of a stable row, but recedes so the eye lands
   on the statuses that do have work in them. */
.tss-box.is-zero { background: #fafbfd; }
.tss-box.is-zero .tss-num { color: var(--faint); }
.tss-box.is-zero .tss-dot { background: var(--faint); }

/* Total on the left, search on the right, one line. */
.tss-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: 0 0 auto; }
.tss-total { font-size: 11px; color: var(--muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tss-search {
    flex: 0 1 240px;
    min-width: 0;
    height: 30px;
    padding: 0 10px 0 30px;
    border: 1px solid transparent;
    border-radius: 8px;
    background-color: var(--surface);
    /* Inlined, because the card must not depend on an asset request to look finished. */
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b90a3' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='M20 20l-3.4-3.4' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: 10px center;
    background-size: 13px 13px;
    font-size: 12px;
    color: var(--body);
    outline: none;
    transition: background-color .12s ease, border-color .12s ease;
}
.tss-search::placeholder { color: var(--muted); }
.tss-search:focus { background-color: #fff; border-color: var(--accent); }

/* The table is the only thing that scrolls, and it takes whatever height the card has left.
   `min-height: 0` is what allows it to shrink inside the flex column — without it the
   region grows to fit its rows and the card clips instead of scrolling. */
.tss-table-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; }
/* A thin scrollbar rather than the platform's: the default one is wide enough to sit over
   the last column and read as clipped numbers. */
.tss-table-wrap::-webkit-scrollbar, .tss-expand-inner::-webkit-scrollbar { width: 7px; height: 7px; }
.tss-table-wrap::-webkit-scrollbar-track, .tss-expand-inner::-webkit-scrollbar-track { background: transparent; }
.tss-table-wrap::-webkit-scrollbar-thumb, .tss-expand-inner::-webkit-scrollbar-thumb { background: #dcdfe8; border-radius: 4px; }
.tss-table-wrap::-webkit-scrollbar-thumb:hover, .tss-expand-inner::-webkit-scrollbar-thumb:hover { background: #c3c8d6; }
.tss-table-wrap, .tss-expand-inner { scrollbar-width: thin; scrollbar-color: #dcdfe8 transparent; }

.tss-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.tss-th {
    position: sticky;
    top: 0;
    z-index: 1;
    /* Opaque, or the rows show through as they pass under it. */
    background: #fff;
    font-size: 9.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
    color: var(--muted); text-align: left; padding: 2px 8px 7px 0;
    /* Bottom-aligned so a status name that wraps to two lines still shares a baseline with
       the single-line ones instead of leaving the row ragged. */
    vertical-align: bottom;
    /* An inset shadow rather than border-bottom: with border-collapse the border belongs
       to the table grid and scrolls away from a sticky cell, leaving the header floating
       over the rows with no edge. */
    box-shadow: inset 0 -1px 0 var(--hairline);
}
.tss-th--who { width: 26%; }
.tss-th--num { width: 74px; text-align: right; }
.tss-th--user { width: auto; }

/* The matrix. Status columns are fixed and narrow so the names column takes the slack;
   with enough statuses the whole table scrolls sideways inside its own region rather
   than squeezing every column to nothing. */
.tss-matrix { table-layout: auto; min-width: 100%; }
.tss-td--user {
    font-weight: 500; color: var(--ink);
    max-width: 0; width: 99%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* Bounded at both ends: wide enough for a count to breathe, capped so one long status
   name cannot claim half the table. The header wraps inside that cap, and an unbroken
   word breaks rather than forcing the column wider than the cap. */
.tss-matrix .tss-th--num, .tss-matrix .tss-td--num { min-width: 85px; max-width: 130px; }
/* Hours read as figures, not as counts: right-aligned and tabular like the status columns,
   but muted, so the eye still lands on the numbers that are clickable. */
.tss-th--hours, .tss-td--hours {
    width: 78px;
    min-width: 78px;
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}
.tss-matrix .tss-td--hours { color: var(--muted); }
/* Over the estimate keeps the amber it has in the task list — same meaning, same colour. */
.tss-matrix .tss-td--hours.tss-over { color: #b45309; font-weight: 600; }
.tss-matrix .tss-th--num { overflow-wrap: anywhere; }
/* Tracing one person across nine columns is the main thing asked of this table. */
.tss-matrix tbody .tss-tr:hover .tss-td { background: #fbfcfe; }
/* Only a cell with something behind it is clickable — an empty one has no list to open.
   It reads as a plain number until the pointer is on it: nine teal numbers per row would
   turn the table into a wall of links.

   Scoped under .tss-matrix so it outranks the faint colour .tss-td--num sets further
   down — at equal specificity the later rule would win and grey out every real number. */
.tss-matrix .tss-cell--link { cursor: pointer; color: var(--ink); font-weight: 600; }
.tss-matrix tbody .tss-tr .tss-cell--link:hover { background: var(--accent-tint); color: var(--accent); }
/* The open cell stays marked while its list is below it: with the matrix still on screen,
   nothing else says which of nine numbers you actually opened. */
.tss-matrix .tss-td--num.is-open {
    background: var(--accent-tint);
    color: var(--accent);
    box-shadow: inset 0 -2px 0 0 var(--accent);
}
.tss-matrix .tss-tr.is-open .tss-td { background: #f8fbfc; }
.tss-matrix .tss-tr.is-open .tss-td--user { font-weight: 600; color: var(--ink); }

/* The expansion, spanning every column. The left edge carries the status colour, which is
   what ties the list to the cell that opened it. */
.tss-expand-tr > .tss-expand {
    position: relative;
    padding: 6px 30px 10px 12px;
    background: #f8fafc;
    border-bottom: 1px solid var(--hairline);
    box-shadow: inset 3px 0 0 0 var(--tss-accent);
}
/* The list scrolls on its own once it is long, so a person with forty tasks does not push
   everyone below them off the card. */
.tss-expand-inner { max-height: 240px; overflow-y: auto; overflow-x: hidden; }
.tss-expand-close {
    position: absolute; top: 7px; right: 8px;
    width: 20px; height: 20px;
    display: inline-flex; align-items: center; justify-content: center;
    border: none; border-radius: 50%; background: transparent;
    font-size: 11px; color: var(--muted); cursor: pointer; line-height: 1;
    transition: background .12s ease, color .12s ease;
}
.tss-expand-close:hover { background: #eceef4; color: var(--body); }
/* The inner header is not sticky: this region is short and already sits under the matrix's
   own sticky header, and two headers stacking on scroll reads as a glitch. */
.tss-inner { table-layout: fixed; }
.tss-inner .tss-th { position: static; background: transparent; box-shadow: inset 0 -1px 0 #e6eaf0; }
.tss-inner .tss-td, .tss-inner .tss-th { padding-left: 8px; }
.tss-inner .tss-tr { border-bottom-color: #edf0f4; }
.tss-inner tbody .tss-tr:hover .tss-td { background: #f2f6f9; }
/* The list region carries the scrollbar, so without this the last column sits under it and
   the numbers read as clipped. The width above already reserves the column; this is the gap. */
.tss-th:last-child, .tss-td:last-child { padding-right: 14px; }
.tss-tr { border-bottom: 1px solid var(--hairline); }
.tss-tr:last-child { border-bottom: none; }
.tss-td { padding: 7px 8px 7px 0; font-size: 11.5px; color: var(--body); vertical-align: middle; transition: background .1s ease; }
.tss-td--task, .tss-td--who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tss-td--who { color: var(--muted); }
.tss-td--num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--faint); }
/* Logged past the estimate is the one thing worth colouring in this table. */
.tss-over { color: #b45309; font-weight: 600; }
.tss-inner .tss-td--num { color: var(--body); }
.tss-task { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
.tss-task--link { cursor: pointer; }
.tss-task--link:hover { color: var(--accent); text-decoration: underline; }
.tss-key { color: var(--accent); font-size: 10.5px; }
/* Inside the scroll region, so it sits after the last row rather than pinned to the card. */
.tss-capped { font-size: 10px; color: var(--muted); padding: 7px 0 2px; }
</style>
