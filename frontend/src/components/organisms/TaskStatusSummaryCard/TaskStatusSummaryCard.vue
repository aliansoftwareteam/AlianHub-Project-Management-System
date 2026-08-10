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
            <!-- The open list is part of this table now, so the region that scrolls it is
                 the one that pages it. -->
            <div v-else class="tss-table-wrap" @scroll.passive="onRowsScroll">
                <!-- The open list's accent lives here rather than on one cell: its rows are
                     siblings, so a variable set on any one of them would not reach the rest.
                     Only one list is ever open, so one value covers it. -->
                <table class="tss-table tss-matrix" :style="drill ? { '--tss-accent': drill.color } : null">
                    <thead>
                        <tr>
                            <th class="tss-th tss-th--user">{{ $t('dashboardCard.tss_col_user') }}</th>
                            <!-- Hours sit next to the name, before the status columns: they
                                 describe the person's whole row, not any one status. -->
                            <th class="tss-th tss-th--hours">{{ $t('dashboardCard.tss_col_planned') }}</th>
                            <th class="tss-th tss-th--hours">{{ $t('dashboardCard.tss_col_logged') }}</th>
                            <th class="tss-th tss-th--hours" :title="$t('dashboardCard.tss_overdue_hint')">
                                {{ $t('dashboardCard.tss_col_overdue') }}
                            </th>
                            <th v-for="b in boxes" :key="'h' + b.statusKey" class="tss-th tss-th--num" :title="b.name">
                                {{ b.name }}
                            </th>
                            <th v-if="showOther" class="tss-th tss-th--num tss-th--other" :title="$t('dashboardCard.tss_other_hint')">
                                {{ otherBox.name }}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="u in visibleUsers" :key="u.userId || 'unassigned'">
                            <tr class="tss-tr" :class="{ 'is-open': isOpenUser(u) }">
                                <td class="tss-td tss-td--user" :title="userLabel(u)">{{ userLabel(u) }}</td>
                                <td class="tss-td tss-td--hours">{{ u.plannedMinutes ? formatMinutes(u.plannedMinutes) : '—' }}</td>
                                <td class="tss-td tss-td--hours">{{ u.loggedMinutes ? formatMinutes(u.loggedMinutes) : '—' }}</td>
                                <!-- Only an overrun is worth colouring; a period inside its
                                     plan has nothing to report and stays a dash. -->
                                <td class="tss-td tss-td--hours" :class="{ 'tss-over': u.overdueMinutes > 0 }">
                                    {{ u.overdueMinutes ? formatMinutes(u.overdueMinutes) : '—' }}
                                </td>
                                <td
                                    v-for="b in boxes"
                                    :key="(u.userId || 'unassigned') + '-' + b.statusKey"
                                    class="tss-td tss-td--num"
                                    :class="{ 'tss-cell--link': cellCount(u, b) > 0, 'is-open': isOpenCell(u, b) }"
                                    :title="cellCount(u, b) > 0 ? $t('dashboardCard.tss_open_cell', { user: userLabel(u), status: b.name }) : ''"
                                    @click="toggleDrill(u, b)"
                                    @mousedown.stop
                                >{{ cellCount(u, b) || '—' }}</td>
                                <!-- Work in a status this card has no column for. Reads as a
                                     count like the rest, and opens the same list. -->
                                <td
                                    v-if="showOther"
                                    class="tss-td tss-td--num tss-td--other"
                                    :class="{ 'tss-cell--link': cellCount(u, otherBox) > 0, 'is-open': isOpenCell(u, otherBox) }"
                                    :title="cellCount(u, otherBox) > 0 ? $t('dashboardCard.tss_open_other', { user: userLabel(u) }) : $t('dashboardCard.tss_other_hint')"
                                    @click="toggleDrill(u, otherBox)"
                                    @mousedown.stop
                                >{{ cellCount(u, otherBox) || '—' }}</td>
                            </tr>

                            <!-- The expansion: REAL rows of this table, not a table of its
                                 own. That is what puts a task's hours directly under the
                                 Planned / Logged headings they belong to — a nested table
                                 computes its own widths and can only ever land near them. -->
                            <template v-if="isOpenUser(u)">
                                <tr class="tss-drill-head">
                                    <td class="tss-drill-cell" :colspan="matrixTotalColumns">
                                        <span class="tss-drill-title">{{ drillTitle }}</span>
                                        <button type="button" class="tss-drill-close" :title="$t('dashboardCard.tss_close_list')" @click="closeDrill">✕</button>
                                    </td>
                                </tr>
                                <tr v-if="drillLoading" class="tss-drill-msg">
                                    <td class="tss-drill-cell" :colspan="matrixTotalColumns">{{ $t('dashboardCard.tss_loading_tasks') }}</td>
                                </tr>
                                <tr v-else-if="!rows.length" class="tss-drill-msg">
                                    <td class="tss-drill-cell" :colspan="matrixTotalColumns">{{ $t('dashboardCard.tss_no_tasks') }}</td>
                                </tr>
                                <template v-else>
                                    <tr v-for="r in rows" :key="r.taskId" class="tss-tr tss-drill-row">
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
                                        <td class="tss-td tss-td--hours">{{ r.plannedMinutes ? formatMinutes(r.plannedMinutes) : '—' }}</td>
                                        <td class="tss-td tss-td--hours">{{ r.loggedMinutes ? formatMinutes(r.loggedMinutes) : '—' }}</td>
                                        <!-- Overdue is a NET figure over the whole row — one
                                             task's underrun cancels another's overrun — so it
                                             has no honest per-task value to print here. The
                                             cell keeps the columns lined up. -->
                                        <td class="tss-td tss-td--hours"></td>
                                        <!-- The Other list is the only one that mixes statuses,
                                             so only it names the status each task is in. It goes
                                             in the run past the hours, which is empty on a task
                                             row — up front it crowded the name down to an
                                             ellipsis, which is the one thing the row must show. -->
                                        <td v-if="matrixColumns" class="tss-td tss-td--tail" :colspan="matrixColumns">
                                            <span v-if="isOtherDrill" class="tss-chip" :title="statusLabel(r.statusKey)">{{ statusLabel(r.statusKey) }}</span>
                                        </td>
                                    </tr>
                                    <!-- Nothing is capped; scrolling brings the rest. This only
                                         says a page is on its way, so the list does not look
                                         finished while it is. -->
                                    <tr v-if="rowsBusy" class="tss-drill-msg">
                                        <td class="tss-drill-cell" :colspan="matrixTotalColumns">{{ $t('dashboardCard.tss_loading_tasks') }}</td>
                                    </tr>
                                </template>
                            </template>
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

/**
 * The "Other" column: work sitting in a status this card has no column for.
 *
 * The hours beside a name count every status, so without this a row could carry time
 * with no task anywhere on screen to explain it. Opening the column lists those tasks
 * with the status each one is really in.
 *
 * Only shown when the card displays a subset — with every status ticked there is no
 * "other", and an always-empty column is just noise.
 */
const OTHER_KEY = 'other';
const showOther = computed(() => statusSettings.value.length > selectedKeys.value.length);
const otherBox = computed(() => ({
    statusKey: OTHER_KEY,
    name: t('dashboardCard.tss_col_other'),
    color: '#8a94a6',
}));
// The status columns (plus Other), and the whole row width including the four fixed
// leading columns — username, Planned, Logged, Overdue. One place decides both, so adding
// a column cannot leave a colspan behind somewhere.
const matrixColumns = computed(() => (showOther.value ? boxes.value.length + 1 : boxes.value.length));
const LEAD_COLUMNS = 4;
const matrixTotalColumns = computed(() => matrixColumns.value + LEAD_COLUMNS);

// Statuses can be named even when the card is not showing them, which is what makes the
// Other list readable.
const statusLabel = (key) => {
    const meta = statusSettings.value.find((s) => Number(s.key) === Number(key));
    return (meta && meta.name) || t('dashboardCard.tss_unknown_status');
};
const isOtherDrill = computed(() => !!drill.value && drill.value.statusKey === OTHER_KEY);
// The open list has no header row of its own — its columns are the matrix's — so this line
// is what says whose list it is and which cell opened it.
const drillTitle = computed(() => (drill.value
    ? `${drill.value.userName} · ${drill.value.statusName}`
    : ''));

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
                // Other is not a status, so it travels as its own flag rather than as a
                // statusKey the server would have to parse out of a number.
                ...(d.statusKey === OTHER_KEY ? { otherStatuses: true } : { statusKey: d.statusKey }),
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
.tss-table-wrap::-webkit-scrollbar { width: 7px; height: 7px; }
.tss-table-wrap::-webkit-scrollbar-track { background: transparent; }
.tss-table-wrap::-webkit-scrollbar-thumb { background: #dcdfe8; border-radius: 4px; }
.tss-table-wrap::-webkit-scrollbar-thumb:hover { background: #c3c8d6; }
.tss-table-wrap { scrollbar-width: thin; scrollbar-color: #dcdfe8 transparent; }

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
/* Hours read as a figure, not a count: right-aligned and tabular like the status columns,
   but muted, so the eye still lands on the numbers that are clickable. */
.tss-th--hours, .tss-td--hours {
    width: 88px;
    min-width: 88px;
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}
.tss-matrix .tss-td--hours { color: var(--muted); }
/* An overrun is the one figure here worth colouring. Scoped under .tss-matrix so it
   outranks the muted colour the rule above sets at equal weight — a bare .tss-over loses
   that fight and the number stays grey. */
.tss-matrix .tss-td--hours.tss-over { color: #b45309; font-weight: 600; }
.tss-matrix .tss-th--num { overflow-wrap: anywhere; }
/* Other is a real column but not a status: set off by a rule so the eye reads the status
   columns as one group and this as the remainder, not as one more status. */
.tss-matrix .tss-th--other, .tss-matrix .tss-td--other { border-left: 1px solid var(--hairline); }
/* The status a task is really in, in the Other list. A chip rather than plain text: it is
   a label on the row, not another field to read across. */
.tss-chip {
    display: inline-block; max-width: 100%;
    padding: 1px 7px; border-radius: 9px;
    background: #eef0f6; color: var(--muted);
    font-size: 10.5px; line-height: 16px; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; vertical-align: middle;
}
/* The status chip starts where the first status column does, so it reads as belonging to
   that side of the table rather than floating after the numbers. */
.tss-drill-row > .tss-td--tail { padding-left: 8px; }
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

/* The open list. Its rows belong to the matrix, so they inherit its columns and the hours
   land under their own headings; all that is left to do is set the region apart. The left
   edge carries the status colour, which is what ties the list to the cell that opened it. */
.tss-drill-head > .tss-drill-cell,
.tss-drill-msg > .tss-drill-cell,
.tss-drill-row > .tss-td { background: #f8fafc; box-shadow: inset 3px 0 0 0 var(--tss-accent, transparent); }
/* Only the first cell of a row can carry the accent bar; the rest just take the tint. */
.tss-drill-row > .tss-td ~ .tss-td { box-shadow: none; }
.tss-drill-head > .tss-drill-cell { position: relative; padding: 7px 30px 5px 12px; }
.tss-drill-msg > .tss-drill-cell { padding: 8px 12px; font-size: 11px; color: var(--muted); }
.tss-drill-title { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
/* The task name is indented to read as nested. Padding on the flexible column only eats
   into itself, so the fixed-width hours columns beside it do not move. */
/* The task name is indented to read as nested. Padding on the flexible column only eats
   into itself, so the fixed-width hours columns beside it do not move. */
.tss-drill-row > .tss-td--task { padding-left: 12px; }
/* The row border belongs to the <tr> under border-collapse, so it is set there. */
.tss-drill-row { border-bottom-color: #edf0f4; }
.tss-matrix tbody .tss-drill-row:hover > .tss-td { background: #f2f6f9; }
.tss-drill-close {
    position: absolute; top: 4px; right: 8px;
    width: 20px; height: 20px;
    display: inline-flex; align-items: center; justify-content: center;
    border: none; border-radius: 50%; background: transparent;
    font-size: 11px; color: var(--muted); cursor: pointer; line-height: 1;
    transition: background .12s ease, color .12s ease;
}
.tss-drill-close:hover { background: #eceef4; color: var(--body); }
/* The region carries the scrollbar, so without this the last column sits under it and the
   numbers read as clipped. The width above already reserves the column; this is the gap. */
.tss-th:last-child, .tss-td:last-child { padding-right: 14px; }
.tss-tr { border-bottom: 1px solid var(--hairline); }
.tss-tr:last-child { border-bottom: none; }
.tss-td { padding: 7px 8px 7px 0; font-size: 11.5px; color: var(--body); vertical-align: middle; transition: background .1s ease; }
/* max-width: 0 like the username cell above it: without it a long task name widens the
   first column under auto layout and drags the hours columns out of alignment with their
   own headings — the exact thing the shared table was for. */
.tss-td--task { max-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tss-td--num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--faint); }
.tss-task { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
.tss-task--link { cursor: pointer; }
.tss-task--link:hover { color: var(--accent); text-decoration: underline; }
.tss-key { color: var(--accent); font-size: 10.5px; }
/* Inside the scroll region, so it sits after the last row rather than pinned to the card. */
.tss-capped { font-size: 10px; color: var(--muted); padding: 7px 0 2px; }
</style>
