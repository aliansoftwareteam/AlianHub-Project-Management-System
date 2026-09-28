import { computed } from 'vue';
import { useViewSettings } from './viewSettingsContext';
import { PRIORITY_RANK, priorityKey } from '@/components/molecules/Home/homeFormat';

export const SORT_KEYS = ['manual', 'due', 'priority', 'created', 'updated', 'name', 'status'];
export const MANUAL = Object.freeze({ key: 'manual', dir: 'asc' });

/* The direction a key opens with: soonest, most urgent and newest first. */
const NATURAL_DIR = { due: 'asc', priority: 'asc', created: 'desc', updated: 'desc', name: 'asc', status: 'asc' };

/* The task fields the Table's sort headers also store, so a view's sort names one field either way. */
const FIELD_OF = { due: 'DueDate', priority: 'Task_Priority', created: 'createdAt', updated: 'updatedAt', name: 'TaskName', status: 'statusKey' };

export function cleanSort(raw) {
    if (!raw || !SORT_KEYS.includes(raw.key) || raw.key === 'manual') return { ...MANUAL };
    return { key: raw.key, dir: raw.dir === 'desc' ? 'desc' : 'asc' };
}

/* A saved view keeps { field, dir: 1 | -1 }, or null for Manual. A field the List cannot sort by reads as Manual. */
export function sortFromSettings(saved) {
    const key = Object.keys(FIELD_OF).find((id) => FIELD_OF[id] === saved?.field);
    if (!key || (saved.dir !== 1 && saved.dir !== -1)) return { ...MANUAL };
    return { key, dir: saved.dir === -1 ? 'desc' : 'asc' };
}

export function settingsFromSort(sort) {
    const clean = cleanSort(sort);
    return clean.key === 'manual' ? null : { field: FIELD_OF[clean.key], dir: clean.dir === 'desc' ? -1 : 1 };
}

const timeOf = (value) => {
    if (!value) return null;
    const time = value.seconds ? value.seconds * 1000 : new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
};

function rankIn(list, matches) {
    const index = list.findIndex(matches);
    return index === -1 ? null : index;
}

function valueReader(key, { priorities = [], statuses = [] }) {
    if (key === 'due') return (task) => timeOf(task.DueDate);
    if (key === 'created') return (task) => timeOf(task.createdAt);
    if (key === 'updated') return (task) => timeOf(task.updatedAt || task.Updated_At);
    if (key === 'name') return (task) => (task.TaskName ? String(task.TaskName) : null);
    if (key === 'status') return (task) => rankIn(statuses, (status) => String(status.key) === String(task.statusKey));
    return (task) => {
        if (!task.Task_Priority) return null;
        return rankIn(priorities, (priority) => priority.value === task.Task_Priority) ?? PRIORITY_RANK[priorityKey(task.Task_Priority)] ?? null;
    };
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;
const compareValues = (a, b) => (typeof a === 'string' ? (collator ? collator.compare(a, b) : a.localeCompare(b)) : a - b);

/* Tasks without a value stay at the end in both directions, and ties keep the drag order. */
export function sortTasks(rows, sort, context = {}) {
    const clean = cleanSort(sort);
    if (clean.key === 'manual') return rows;
    const read = valueReader(clean.key, context);
    const sign = clean.dir === 'desc' ? -1 : 1;
    return rows
        .map((task, index) => ({ task, index, value: read(task) }))
        .sort((a, b) => {
            const aMissing = a.value === null || a.value === undefined;
            const bMissing = b.value === null || b.value === undefined;
            if (aMissing || bMissing) return aMissing === bMissing ? a.index - b.index : (aMissing ? 1 : -1);
            return sign * compareValues(a.value, b.value) || a.index - b.index;
        })
        .map((entry) => entry.task);
}

/* The open saved view's sort, so a change shows as an unsaved change of that view. */
export function useListSort() {
    const view = useViewSettings();
    const sort = computed(() => sortFromSettings(view.sort.value));
    const set = (next) => view.setSort(settingsFromSort(next));

    return {
        sort,
        isManual: computed(() => sort.value.key === 'manual'),
        set,
        setKey: (key) => set({ key, dir: NATURAL_DIR[key] || 'asc' }),
        setDir: (dir) => set({ ...sort.value, dir })
    };
}
