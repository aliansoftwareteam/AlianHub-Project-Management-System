import { ref, computed } from 'vue';
import Store from '@/store/index';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

const STORAGE_KEY = 'ah.timer';
const OVERNIGHT_MS = 12 * 3600 * 1000;
const MAX_ENTRY_MINUTES = 24 * 60 - 1;

const read = () => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
};
const write = (value) => {
    try {
        if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
        else localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
        // storage unavailable — the in-memory timer still runs for this tab
    }
};

const active = ref(read());
const elapsed = ref(0);
const sessions = ref([]);
const lastStopped = ref(null);
let ticker = null;
let reconciled = false;

const refreshElapsed = () => {
    elapsed.value = active.value ? Math.max(0, Math.floor((Date.now() - Number(active.value.startedAt)) / 1000)) : 0;
};
const syncTicker = () => {
    if (active.value && !ticker) ticker = setInterval(refreshElapsed, 1000);
    if (!active.value && ticker) { clearInterval(ticker); ticker = null; }
};
refreshElapsed();
syncTicker();
if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
        if (e.key !== STORAGE_KEY) return;
        active.value = read();
        refreshElapsed();
        syncTicker();
    });
}

const pad2 = (n) => String(n).padStart(2, '0');
export const formatClock = (seconds, withSeconds = false) => {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return withSeconds ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${h}:${pad2(m)}`;
};
export const formatMinutes = (minutes) => formatClock((Number(minutes) || 0) * 60);
export const formatHm = (minutes) => {
    const m = Math.round(Number(minutes) || 0);
    const h = Math.floor(m / 60);
    const r = m % 60;
    if (!h) return `${r}m`;
    return r ? `${h}h ${r}m` : `${h}h`;
};
export const isoDate = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
};
const hhmm = (d) => {
    const x = new Date(d);
    return `${pad2(x.getHours())}:${pad2(x.getMinutes())}`;
};

const currentUser = () => {
    const g = Store.getters;
    const id = localStorage.getItem('userId') || '';
    const u = (g['users/users'] || []).find((x) => x._id === id) || {};
    return {
        id,
        name: u.Employee_Name || '',
        timeZone: u.Time_Zone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        timeFormat: u.Time_Format || '',
        companyOwnerId: (g['settings/companyOwnerDetail'] || {})._id || '',
        dateFormat: (g['settings/companyDateFormat'] || {}).dateFormat || 'DD/MM/YYYY',
        companyId: localStorage.getItem('selectedCompany') || '',
    };
};

/* Writes one manual entry of `minutes` on `task`, ending at `endAt` (default now)
 * or at 18:00 for a past day, so a bare "2:30 on Tuesday" lands sensibly. */
export async function logTime({ task, minutes, date, endAt, note, billable = true }) {
    if (!task || !task.taskId) throw new Error('task_required');
    const m = Math.min(MAX_ENTRY_MINUTES, Math.max(1, Math.round(Number(minutes) || 0)));
    const user = currentUser();
    const day = date || isoDate(endAt || Date.now());
    let end = endAt ? new Date(endAt) : (day === isoDate(Date.now()) ? new Date() : new Date(`${day}T18:00:00`));
    let start = new Date(end.getTime() - m * 60000);
    if (isoDate(start) !== day) {
        start = new Date(`${day}T00:00:00`);
        end = new Date(Math.min(start.getTime() + m * 60000, new Date(`${day}T23:59:00`).getTime()));
    }
    const payload = {
        logTimeDate: day,
        description: note || task.taskName || 'Logged time',
        startLogTime: hhmm(start),
        endLogTime: hhmm(end),
        timeDuration: formatClock(m * 60),
        ticketId: task.taskId,
        projectId: task.projectId,
        companyId: user.companyId,
        userId: user.id,
        isEdit: false,
        userName: user.name || 'User',
        dateFormat: user.dateFormat,
        timeSheetId: '',
        sprintId: task.sprintId || 'none',
        taskName: task.taskName || 'Task',
        companyOwnerId: user.companyOwnerId,
        projectName: task.projectName || 'Project',
        previousLoggedTime: '',
        timeZone: user.timeZone,
        timeFormat: user.timeFormat,
        billable: billable !== false,
    };
    const res = await apiRequest('post', env.ADD_TIMELOG, payload);
    const body = (res && res.data) || {};
    if (!body.status) throw new Error(body.statusText || 'log_failed');
    return body.data;
}

/* One timer per person, globally. Starting a second one stops (and logs) the first.
 * The active entry lives in localStorage so it survives reloads; `reconcile()`
 * pulls open desktop-tracker sessions from the server so overnight timers can be trimmed. */
export function useTimer() {
    const running = computed(() => !!active.value);
    const overnight = computed(() => !!active.value && Date.now() - Number(active.value.startedAt) >= OVERNIGHT_MS);

    const stop = async ({ minutes } = {}) => {
        const cur = active.value;
        if (!cur) return null;
        const mins = minutes != null ? Number(minutes) : Math.max(1, Math.round((Date.now() - Number(cur.startedAt)) / 60000));
        await logTime({
            task: cur,
            minutes: mins,
            endAt: minutes != null ? Number(cur.startedAt) + mins * 60000 : Date.now(),
            note: cur.note,
            billable: cur.billable,
        });
        lastStopped.value = { ...cur, minutes: mins, stoppedAt: Date.now() };
        active.value = null;
        write(null);
        refreshElapsed();
        syncTicker();
        return lastStopped.value;
    };

    const start = async (task, { note = '', billable = true } = {}) => {
        if (!task || !task.taskId) return { stoppedPrevious: null };
        if (active.value && active.value.taskId === task.taskId) return { stoppedPrevious: null };
        const stoppedPrevious = active.value ? await stop() : null;
        active.value = {
            taskId: task.taskId,
            taskName: task.taskName || '',
            projectId: task.projectId || '',
            projectName: task.projectName || '',
            sprintId: task.sprintId || '',
            startedAt: Date.now(),
            note,
            billable: billable !== false,
        };
        write(active.value);
        refreshElapsed();
        syncTicker();
        return { stoppedPrevious };
    };

    const discard = () => {
        active.value = null;
        write(null);
        refreshElapsed();
        syncTicker();
    };

    const reconcile = async () => {
        reconciled = true;
        try {
            const tz = encodeURIComponent(currentUser().timeZone);
            const res = await apiRequest('get', `${env.TIMER_RUNNING}?timeZone=${tz}`);
            const body = (res && res.data) || {};
            sessions.value = body.status ? body.data || [] : [];
        } catch (e) {
            sessions.value = [];
        }
        return sessions.value;
    };

    const trim = async (session, minutes) => {
        const res = await apiRequest('post', env.TIMER_TRIM, { timeSheetId: session.timeSheetId, minutes });
        const body = (res && res.data) || {};
        if (!body.status) throw new Error(body.statusText || 'trim_failed');
        sessions.value = sessions.value.filter((s) => s.timeSheetId !== session.timeSheetId);
        return body.data;
    };

    if (!reconciled && localStorage.getItem('userId')) reconcile();

    return { active, elapsed, running, overnight, sessions, lastStopped, start, stop, discard, reconcile, trim, logTime, formatClock, formatMinutes, formatHm, isoDate };
}
