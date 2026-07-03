// Shared, pure helpers for the Resource Utilization dashboard cards
// (LiveWorkTable, FreeResources, WorkedTasksTable, team charts). Kept
// framework-free so any card can import without setup-context concerns.
import { getTimeRange } from '@/composable/commonFunction';

/**
 * timerange id meaning "Auto — follow the dashboard's global date range".
 * Cards store it in cardData.timerange like the 1–8 preset ids.
 */
export const AUTO_RANGE_ID = 0;

/**
 * Resolve a card timerange into ISO { dateFrom, dateTo }, honouring Auto
 * mode: id 0 defers to the dashboard-level range (provided by HomePage via
 * inject('dashboardGlobalRange')); any other id resolves the preset. Falls
 * back to the preset resolver when no global range is available.
 */
export function resolveCardRange(timerangeId, globalRange) {
    if (Number(timerangeId) === AUTO_RANGE_ID && globalRange && globalRange.dateFrom && globalRange.dateTo) {
        return { dateFrom: globalRange.dateFrom, dateTo: globalRange.dateTo };
    }
    return resolveIsoRange(timerangeId);
}

/**
 * Resolve a card-catalog timerange id (1=today … 8=last_30_days) into the
 * ISO { dateFrom, dateTo } the /employee-workload + resource endpoints expect.
 * Reuses commonFunction.getTimeRange (Unix-seconds) and converts to ISO.
 * Falls back to "today" on an invalid id.
 */
export function resolveIsoRange(timerangeId) {
    let id = Number(timerangeId);
    if (!id || id < 1 || id > 8) id = 1;
    try {
        const { start, end } = getTimeRange(id);
        return {
            dateFrom: new Date(start * 1000).toISOString(),
            dateTo: new Date(end * 1000).toISOString(),
        };
    } catch (e) {
        const { start, end } = getTimeRange(1);
        return {
            dateFrom: new Date(start * 1000).toISOString(),
            dateTo: new Date(end * 1000).toISOString(),
        };
    }
}

// Status-name → canonical bucket keywords. Mirrors the backend
// resourceHelpers.STATUS_BUCKET_KEYWORDS so the worked-tasks table buckets
// the same way the server would. Tunable in one place.
const STATUS_BUCKET_KEYWORDS = {
    backlog: ['backlog', 'todo', 'to do', 'open', 'new'],
    review: ['review', 'qa', 'testing', 'verify'],
    progress: ['progress', 'doing', 'active', 'wip', 'development', 'dev'],
};

/**
 * Bucket an arbitrary per-project status into: complete | review | progress | backlog.
 * `statusType === 'close'` always → complete; unmatched active → progress.
 */
export function bucketForStatus(statusName, statusType) {
    if (statusType === 'close' || statusType === 'done') return 'complete';
    const name = String(statusName || '').toLowerCase();
    for (const bucket of ['review', 'backlog', 'progress']) {
        if (STATUS_BUCKET_KEYWORDS[bucket].some((kw) => name.includes(kw))) return bucket;
    }
    return 'progress';
}

/** Format a minute count as "3h 05m" / "45m" / "0h". */
export function formatMinutes(min) {
    const n = Number(min) || 0;
    if (n <= 0) return '0h';
    const h = Math.floor(n / 60);
    const m = Math.round(n % 60);
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}
