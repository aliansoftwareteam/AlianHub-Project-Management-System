import { computed, inject, ref, unref, watch } from 'vue';
import { viewPrefsKey } from './projectViewPrefs';

export const FIELD_PREFIX = 'cf:';
const MAX_IDS = 200;

const LABELS = {
    status: 'List.status',
    assignee: 'List.col_assignee',
    due: 'List.col_due',
    start: 'ViewColumns.col_start',
    priority: 'List.col_priority',
    estimate: 'List.col_est',
    points: 'ViewColumns.col_points',
    tags: 'List.col_tags',
    created: 'ViewColumns.col_created',
    updated: 'ViewColumns.col_updated',
    doneBy: 'Provenance.col_done_by',
    summary: 'List.col_summary',
    risk: 'List.col_risk',
    area: 'List.col_area'
};

const AI_COLUMNS = ['summary', 'risk', 'area'];

/* `base` columns keep the List's responsive tracks: the others drop out below 1024px. */
const VIEWS = {
    list: {
        lead: ['28px', 'minmax(0, 1fr)'],
        columns: ['tags', 'assignee', 'due', 'start', 'priority', 'estimate', 'points', 'created', 'updated', 'risk', 'doneBy'],
        defaults: ['tags', 'assignee', 'due', 'priority', 'estimate', 'risk', 'doneBy'],
        base: ['tags', 'assignee', 'due', 'priority', 'estimate', 'risk', 'doneBy'],
        fieldsShown: false,
        tracks: {
            tags: 'minmax(0, .45fr)', assignee: '56px', due: '64px', start: '64px', priority: '72px', estimate: '48px',
            points: '44px', created: '72px', updated: '72px', risk: '80px', doneBy: '88px'
        },
        fieldTrack: '112px'
    },
    table: {
        lead: ['28px', 'minmax(220px, 1fr)'],
        columns: ['status', 'assignee', 'due', 'start', 'priority', 'estimate', 'points', 'tags', 'created', 'updated', 'summary', 'risk', 'area', 'doneBy'],
        defaults: ['status', 'assignee', 'due', 'priority', 'estimate', 'points', 'tags', 'summary', 'risk', 'area', 'doneBy'],
        base: [],
        fieldsShown: true,
        tracks: {
            status: '110px', assignee: '72px', due: '96px', start: '96px', priority: '96px', estimate: '84px', points: '64px',
            tags: '170px', created: '96px', updated: '96px', summary: 'minmax(200px, 1.3fr)', risk: '110px', area: '140px', doneBy: '96px'
        },
        fieldTrack: '150px'
    },
    board: {
        lead: [],
        columns: ['points'],
        defaults: [],
        base: [],
        fieldsShown: false,
        tracks: {},
        fieldTrack: ''
    }
};

export const viewColumnIds = (viewId) => [...(VIEWS[viewId]?.columns || [])];
export const isFieldColumn = (id) => String(id).startsWith(FIELD_PREFIX);
export const fieldColumnId = (fieldId) => `${FIELD_PREFIX}${fieldId}`;

/* What this project and this user can have as a column; a column the rules take away
   leaves the chooser too, while its saved position is kept for when it comes back. */
export function columnCatalogue(viewId, context = {}) {
    const view = VIEWS[viewId];
    if (!view) return [];
    const gates = {
        tags: context.tagsOn !== false,
        priority: context.priorityOn !== false,
        estimate: context.estimateOn !== false,
        start: context.startOn !== false,
        points: context.pointsOn !== false
    };
    const builtIns = view.columns
        .filter((id) => gates[id] !== false)
        .map((id) => ({ id, labelKey: LABELS[id], track: view.tracks[id], ai: AI_COLUMNS.includes(id), base: view.base.includes(id) }));
    const fields = (context.fields || [])
        .filter((field) => field && field._id)
        .map((field) => ({ id: fieldColumnId(field._id), label: field.fieldTitle || '', track: view.fieldTrack, field, base: false }));
    return [...builtIns, ...fields];
}

const defaultShown = (viewId, id) => (isFieldColumn(id) ? Boolean(VIEWS[viewId]?.fieldsShown) : (VIEWS[viewId]?.defaults || []).includes(id));

export function cleanColumnState(raw) {
    const state = raw && typeof raw === 'object' ? raw : {};
    const order = Array.isArray(state.order)
        ? [...new Set(state.order.filter((id) => typeof id === 'string' && id.length <= 64))].slice(0, MAX_IDS)
        : [];
    const shown = {};
    if (state.shown && typeof state.shown === 'object') {
        Object.entries(state.shown).slice(0, MAX_IDS).forEach(([id, on]) => {
            if (typeof on === 'boolean' && id.length <= 64) shown[id] = on;
        });
    }
    return { order, shown };
}

export function resolveColumns(viewId, catalogue, state) {
    const { order, shown } = cleanColumnState(state);
    const byId = new Map(catalogue.map((column) => [column.id, column]));
    const ids = [...order.filter((id) => byId.has(id)), ...catalogue.map((column) => column.id).filter((id) => !order.includes(id))];
    return ids.map((id) => ({
        ...byId.get(id),
        visible: typeof shown[id] === 'boolean' ? shown[id] : defaultShown(viewId, id)
    }));
}

export const defaultColumns = (viewId, context) => resolveColumns(viewId, columnCatalogue(viewId, context), null).filter((column) => column.visible);

export function withVisibility(state, id, on) {
    const clean = cleanColumnState(state);
    return { ...clean, shown: { ...clean.shown, [id]: Boolean(on) } };
}

export function withMove(state, orderedIds, id, delta) {
    const clean = cleanColumnState(state);
    const ids = [...orderedIds];
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= ids.length) return clean;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    const kept = clean.order.filter((known) => !ids.includes(known));
    return { ...clean, order: [...ids, ...kept].slice(0, MAX_IDS) };
}

/* Below 1100px the List drops Done by and below 1024px everything past the meta line,
   exactly as its stylesheet does; at phone width the stylesheet's own layout applies. */
export function listColumnsAt(columns, width) {
    if (width <= 1024) return columns.filter((column) => column.base && !['estimate', 'risk', 'doneBy'].includes(column.id));
    if (width <= 1100) return columns.filter((column) => column.id !== 'doneBy');
    return columns;
}

const LIST_CLASSES = {
    tags: 'lv2__c-tags', assignee: 'lv2__c-assignee', due: 'lv2__c-due', priority: 'lv2__c-prio',
    estimate: 'lv2__c-est', risk: 'lv2__c-risk', doneBy: 'lv2__c-done'
};

export const listColumnClass = (column) => LIST_CLASSES[column.id]
    || `lv2__c-extra ${column.field ? 'lv2__c-field' : `lv2__c-${column.id}`}`;

export function gridTracks(viewId, columns) {
    const view = VIEWS[viewId];
    if (!view) return '';
    return [...view.lead, ...columns.map((column) => column.track || view.fieldTrack)].join(' ');
}

const FR_WIDTH = 200;
export function gridMinWidth(tracks) {
    return String(tracks || '')
        .replace(/minmax\(\s*([\d.]+)px[^)]*\)/g, '$1px')
        .split(/\s+/)
        .filter(Boolean)
        .reduce((total, track) => total + (track.endsWith('px') ? parseFloat(track) : FR_WIDTH) + 10, 28);
}

export const columnStorageKey = (ids, viewId) => `${viewPrefsKey(ids)}.columns.${viewId}`;

const defaultStorage = () => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
};

export function loadColumnState(ids, viewId, storage = defaultStorage()) {
    if (!ids?.companyId || !ids?.userId || !ids?.projectId || !storage) return cleanColumnState(null);
    try {
        return cleanColumnState(JSON.parse(storage.getItem(columnStorageKey(ids, viewId)) || 'null'));
    } catch {
        return cleanColumnState(null);
    }
}

export function saveColumnState(ids, viewId, state, storage = defaultStorage()) {
    if (!ids?.companyId || !ids?.userId || !ids?.projectId || !storage) return;
    const clean = cleanColumnState(state);
    try {
        if (!clean.order.length && !Object.keys(clean.shown).length) storage.removeItem(columnStorageKey(ids, viewId));
        else storage.setItem(columnStorageKey(ids, viewId), JSON.stringify(clean));
    } catch {
        // Private windows and blocked site data refuse writes; the columns still work unsaved.
    }
}

/* Per user and per project for now; 042 slice 4 moves the same state onto the saved view. */
export function useViewColumns(projectId, viewId, catalogue, { storage } = {}) {
    const companyId = inject('$companyId', ref(''));
    const userId = inject('$userId', ref(''));
    const ids = computed(() => ({ companyId: unref(companyId), userId: unref(userId), projectId: unref(projectId) }));
    const state = ref(loadColumnState(ids.value, viewId, storage ?? defaultStorage()));

    watch(ids, (next) => { state.value = loadColumnState(next, viewId, storage ?? defaultStorage()); });

    const columns = computed(() => resolveColumns(viewId, unref(catalogue) || [], state.value));
    const visibleColumns = computed(() => columns.value.filter((column) => column.visible));

    function commit(next) {
        state.value = cleanColumnState(next);
        saveColumnState(ids.value, viewId, state.value, storage ?? defaultStorage());
    }

    return {
        columns,
        visibleColumns,
        isVisible: (id) => visibleColumns.value.some((column) => column.id === id),
        setVisible: (id, on) => commit(withVisibility(state.value, id, on)),
        move: (id, delta) => commit(withMove(state.value, columns.value.map((column) => column.id), id, delta)),
        reset: () => commit(null)
    };
}
