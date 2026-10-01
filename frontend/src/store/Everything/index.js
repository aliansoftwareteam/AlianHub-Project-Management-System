import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { DEFAULT_SETTINGS, PAGE_SIZE, baseRequest, cleanSettings, firstRequest, groupRequest, groupsFrom } from '@/views/Everything/everythingRequest';

const READY = 'ready';
const LOADING = 'loading';
const FAILED = 'error';

const viewer = (context = {}) => ({
    now: context.now || new Date(),
    timeZone: context.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
});

const dataOf = (response) => {
    const body = response?.data;
    if (!body || body.status !== true || !body.data) throw new Error(body?.message || 'Request failed');
    return body.data;
};

const refusedCursor = (error) => error?.response?.status === 400 && error.response.data?.field === 'cursor';

const emptyGroup = (group) => ({ ...group, rows: [], nextCursor: null, loaded: false, loading: false, failed: false });

export default {
    namespaced: true,
    state: () => ({
        settings: { ...DEFAULT_SETTINGS },
        status: 'idle',
        groups: [],
        projects: {},
        base: null,
        pageSize: PAGE_SIZE,
        serial: 0
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
        }
    },
    mutations: {
        setSettings(state, settings) { state.settings = cleanSettings({ ...state.settings, ...settings }); },
        setPageSize(state, size) { state.pageSize = size; },
        started(state, { serial, quiet }) {
            state.serial = serial;
            if (!quiet) { state.status = LOADING; state.groups = []; }
        },
        counted(state, { base, groups }) {
            state.base = base;
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
        patchRow(state, { taskId, fields }) {
            state.groups.forEach((group) => {
                group.rows = group.rows.map((row) => (String(row._id) === String(taskId) ? { ...row, ...fields } : row));
            });
        }
    },
    actions: {
        applySettings({ commit, dispatch }, { settings, now, timeZone }) {
            commit('setSettings', settings);
            return dispatch('load', { now, timeZone });
        },

        /* `quiet` is the refresh on focus and after an edit: the rows stay on screen while page one
           is read again, and the groups that were open are read again with it. */
        async load({ commit, dispatch, state }, { quiet = false, now, timeZone } = {}) {
            const serial = state.serial + 1;
            const context = viewer({ now, timeZone });
            const wasLoaded = new Set(quiet ? state.groups.filter((group) => group.loaded).map((group) => group.id) : []);
            commit('started', { serial, quiet });
            try {
                const data = dataOf(await apiRequest('post', env.V2_TASKS_EVERYTHING, firstRequest(state.settings, context, state.pageSize)));
                if (state.serial !== serial) return;
                const previous = new Map(state.groups.map((group) => [group.id, group]));
                const groups = groupsFrom(data.groups, state.settings, context).map((group) => (
                    quiet && previous.has(group.id) ? { ...previous.get(group.id), ...group, loading: false } : emptyGroup(group)
                ));
                commit('counted', { base: baseRequest(state.settings, context), groups });
                if (state.settings.group === 'none') {
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
        }
    }
};
