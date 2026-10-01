import { apiRequest } from '@/services';
import * as env from '@/config/env';
import {
    DEFAULT_SETTINGS, PAGE_SIZE, baseRequest, boardColumns, cleanSettings, firstRequest, groupIdOf, groupRequest, groupsFrom, queryGroup
} from '@/views/Everything/everythingRequest';

const READY = 'ready';
const LOADING = 'loading';
const FAILED = 'error';

const viewer = (context = {}) => ({
    now: context.now || new Date(),
    timeZone: context.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
});

const bodyOf = (response) => {
    const body = response?.data;
    if (!body || body.status !== true) throw new Error(body?.message || 'Request failed');
    return body;
};
const dataOf = (response) => {
    const { data } = bodyOf(response);
    if (!data) throw new Error('Request failed');
    return data;
};

const refusedCursor = (error) => error?.response?.status === 400 && error.response.data?.field === 'cursor';

const emptyGroup = (group) => ({ ...group, rows: [], nextCursor: null, loaded: group.count === 0, loading: false, failed: false });

const knownStatuses = (rootGetters) => (rootGetters?.['projectData/allProjects']?.data || [])
    .filter((project) => !project.deletedStatusKey)
    .flatMap((project) => project.taskStatusData || []);

const viewPath = (id) => `${env.V2_TASKS_EVERYTHING_VIEWS}/${id}`;
const byName = (a, b) => String(a.name).localeCompare(String(b.name));

export default {
    namespaced: true,
    state: () => ({
        settings: { ...DEFAULT_SETTINGS },
        status: 'idle',
        groups: [],
        projects: {},
        base: null,
        kind: 'none',
        pageSize: PAGE_SIZE,
        serial: 0,
        views: [],
        viewsLoaded: false,
        activeViewId: ''
    }),
    getters: {
        settings: (state) => state.settings,
        status: (state) => state.status,
        groups: (state) => state.groups,
        projects: (state) => state.projects,
        total: (state) => state.groups.reduce((sum, group) => sum + group.count, 0),
        rowById: (state) => (taskId) => {
            for (const group of state.groups) {
                const row = group.rows.find((entry) => String(entry._id) === String(taskId));
                if (row) return row;
            }
            return null;
        },
        views: (state) => state.views,
        viewsLoaded: (state) => state.viewsLoaded,
        activeView: (state) => state.views.find((view) => view._id === state.activeViewId) || null,
        defaultView: (state) => state.views.find((view) => view.isDefault) || null
    },
    mutations: {
        setSettings(state, settings) { state.settings = cleanSettings({ ...state.settings, ...settings }); },
        setPageSize(state, size) { state.pageSize = size; },
        started(state, { serial, quiet }) {
            state.serial = serial;
            if (!quiet) { state.status = LOADING; state.groups = []; }
        },
        counted(state, { base, kind, groups }) {
            state.base = base;
            state.kind = kind;
            state.groups = groups;
            state.status = READY;
        },
        failed(state) { state.status = FAILED; },
        groupLoading(state, id) {
            const group = state.groups.find((entry) => entry.id === id);
            if (group) { group.loading = true; group.failed = false; }
        },
        groupPage(state, { id, rows, nextCursor, projects, replace }) {
            const group = state.groups.find((entry) => entry.id === id);
            if (!group) return;
            const known = new Set(replace ? [] : group.rows.map((row) => String(row._id)));
            group.rows = [...(replace ? [] : group.rows), ...rows.filter((row) => !known.has(String(row._id)))];
            group.nextCursor = nextCursor;
            group.loaded = true;
            group.loading = false;
            state.projects = { ...state.projects, ...projects };
        },
        groupFailed(state, id) {
            const group = state.groups.find((entry) => entry.id === id);
            if (group) { group.loading = false; group.failed = true; }
        },
        /* An edit shows at once. When the rows are grouped by what was edited, the row also moves
           to the group it now belongs to, and the two counts follow; the next read settles both. */
        patchRow(state, { taskId, fields }) {
            let moved = null;
            state.groups.forEach((group) => {
                const row = group.rows.find((entry) => String(entry._id) === String(taskId));
                if (!row) return;
                const patched = { ...row, ...fields };
                const home = groupIdOf(state.kind, patched);
                if (home && home !== group.id) {
                    group.rows = group.rows.filter((entry) => entry !== row);
                    group.count = Math.max(0, group.count - 1);
                    moved = { row: patched, to: home };
                } else {
                    group.rows = group.rows.map((entry) => (entry === row ? patched : entry));
                }
            });
            const target = moved && state.groups.find((group) => group.id === moved.to);
            if (target) {
                target.rows = [moved.row, ...target.rows];
                target.count += 1;
            }
        },
        setViews(state, views) {
            state.views = [...views].sort(byName);
            state.viewsLoaded = true;
            if (!state.views.some((view) => view._id === state.activeViewId)) state.activeViewId = '';
        },
        putView(state, view) {
            const others = state.views.filter((entry) => entry._id !== view._id).map((entry) => (view.isDefault ? { ...entry, isDefault: false } : entry));
            state.views = [...others, view].sort(byName);
        },
        dropView(state, id) {
            state.views = state.views.filter((view) => view._id !== id);
            if (state.activeViewId === id) state.activeViewId = '';
        },
        setActiveView(state, id) { state.activeViewId = id || ''; }
    },
    actions: {
        applySettings({ commit, dispatch }, { settings, now, timeZone }) {
            commit('setSettings', settings);
            return dispatch('load', { now, timeZone });
        },

        /* `quiet` is the refresh on focus and after an edit: the rows stay on screen while page one
           is read again, and the groups that were open are read again with it. */
        async load({ commit, dispatch, state, rootGetters }, { quiet = false, now, timeZone } = {}) {
            const serial = state.serial + 1;
            const context = viewer({ now, timeZone });
            const wasLoaded = new Set(quiet ? state.groups.filter((group) => group.loaded && group.rows.length).map((group) => group.id) : []);
            commit('started', { serial, quiet });
            try {
                const { settings } = state;
                const data = dataOf(await apiRequest('post', env.V2_TASKS_EVERYTHING, firstRequest(settings, context, state.pageSize)));
                if (state.serial !== serial) return;
                const previous = new Map(state.groups.map((group) => [group.id, group]));
                const counted = groupsFrom(data.groups, settings, context);
                const groups = (settings.mode === 'board' ? boardColumns(counted, knownStatuses(rootGetters), settings) : counted).map((group) => (
                    quiet && previous.has(group.id) ? { ...previous.get(group.id), ...group, loading: false } : emptyGroup(group)
                ));
                const kind = queryGroup(settings);
                commit('counted', { base: baseRequest(settings, context), kind, groups });
                if (kind === 'none') {
                    commit('groupPage', { id: 'all', rows: data.rows, nextCursor: data.nextCursor, projects: data.projects, replace: true });
                    return;
                }
                await Promise.all(groups.filter((group) => wasLoaded.has(group.id)).map((group) => dispatch('loadGroup', { id: group.id, restart: true })));
            } catch (error) {
                if (state.serial === serial) commit('failed');
            }
        },

        /* The next page of one group: the same query narrowed to the group, after its cursor. A
           cursor the server no longer accepts (the query behind it changed) starts the group again. */
        async loadGroup({ commit, dispatch, state }, { id, restart = false }) {
            const group = state.groups.find((entry) => entry.id === id);
            if (!group || !state.base || (group.loading && !restart)) return;
            if (group.loaded && !group.nextCursor && !restart) return;
            const { serial } = state;
            const cursor = restart ? null : group.nextCursor;
            commit('groupLoading', id);
            try {
                const data = dataOf(await apiRequest('post', env.V2_TASKS_EVERYTHING, groupRequest(state.base, group.filter, { cursor, limit: state.pageSize })));
                if (state.serial !== serial) return;
                commit('groupPage', { id, rows: data.rows, nextCursor: data.nextCursor, projects: data.projects, replace: !cursor });
            } catch (error) {
                if (state.serial !== serial) return;
                if (cursor && refusedCursor(error)) {
                    await dispatch('loadGroup', { id, restart: true });
                    return;
                }
                commit('groupFailed', id);
            }
        },

        async loadViews({ commit }) {
            commit('setViews', dataOf(await apiRequest('get', env.V2_TASKS_EVERYTHING_VIEWS)));
        },

        async saveView({ commit, state }, { name }) {
            const view = dataOf(await apiRequest('post', env.V2_TASKS_EVERYTHING_VIEWS, { name, settings: cleanSettings(state.settings) }));
            commit('putView', view);
            commit('setActiveView', view._id);
            return view;
        },

        async updateView({ commit, state }, { id, name, isDefault, settings = false }) {
            const body = {
                ...(name === undefined ? {} : { name }),
                ...(isDefault === undefined ? {} : { isDefault }),
                ...(settings ? { settings: cleanSettings(state.settings) } : {})
            };
            const view = dataOf(await apiRequest('patch', viewPath(id), body));
            commit('putView', view);
            return view;
        },

        async deleteView({ commit }, id) {
            bodyOf(await apiRequest('delete', viewPath(id)));
            commit('dropView', id);
        },

        openView({ commit, dispatch, state }, { id, now, timeZone }) {
            const view = state.views.find((entry) => entry._id === id);
            if (!view) return Promise.resolve();
            commit('setActiveView', id);
            commit('setSettings', cleanSettings(view.settings));
            return dispatch('load', { now, timeZone });
        }
    }
};
