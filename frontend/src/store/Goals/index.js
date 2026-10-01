import { apiRequest } from '@/services';
import {
    addTargetRequest, archiveRequest, createRequest, editTargetRequest, listRequest, readRequest, removeTargetRequest, restoreRequest, sourcesRequest, updateRequest, valueOf, valueRequest
} from '@/views/Goals/goalRequest';

export const REFETCH_DELAY_MS = 400;
/* A count the server has started is asked for again this long after its last answer. The server gives a
   count up after two minutes; one it still calls under way past that, with a margin, is no longer asked for. */
export const COUNT_POLL_MS = 2000;
export const COUNT_GIVE_UP_MS = 150000;

const READY = 'ready';
const LOADING = 'loading';
const FAILED = 'error';
const MISSING = 'missing';
const GONE = 'gone';
const KIND_OF_STATUS = { 400: 'field', 403: 'forbidden', 404: 'missing', 409: 'conflict' };
/* After these the goal on screen is not the goal on the server: it is read again before the person retries. */
const READ_AGAIN = ['forbidden', 'missing', 'conflict'];

const closed = () => ({ id: '', status: 'idle', goal: null });
const refetchTimers = new WeakMap();

const send = async ({ method, path, body }) => {
    const payload = (await apiRequest(method, path, body))?.data;
    if (!payload || payload.status !== true) throw new Error(payload?.message || 'Request failed');
    return payload.data;
};

const failure = (error) => {
    const status = error?.response?.status || 0;
    const data = error?.response?.data || {};
    return Object.assign(new Error(data.message || error?.message || 'Request failed'), {
        kind: KIND_OF_STATUS[status] || 'failed', status, field: data.field || '', code: data.code || '', sources: data.sources || null
    });
};

const isCounting = (goal) => (goal?.targets || []).some((target) => target.updating === true);

const sameId = (goal, id) => String(goal._id) === String(id);
const byName = (a, b) => String(a.name).localeCompare(String(b.name));
const listed = (goal, filters) => goal.archived === filters.archived && (!filters.mine || goal.isOwner || goal.sharedWithMe);

/* A write can answer with no goal: it succeeded and took the goal out of this person's reach. */
const write = async ({ commit, dispatch }, id, request, undo) => {
    commit('writing', { id, by: 1 });
    try {
        const goal = await send(request);
        commit('writing', { id, by: -1 });
        commit(goal ? 'put' : 'drop', goal || id);
        return goal || null;
    } catch (error) {
        commit('writing', { id, by: -1 });
        if (undo) undo();
        const refused = failure(error);
        if (READ_AGAIN.includes(refused.kind)) await dispatch('read', id);
        throw refused;
    }
};

export default {
    namespaced: true,
    state: () => ({
        status: 'idle',
        goals: [],
        filters: { mine: false, archived: false },
        serial: 0,
        open: closed(),
        writing: {},
        countGivenUp: false
    }),
    getters: {
        status: (state) => state.status,
        goals: (state) => state.goals,
        filters: (state) => state.filters,
        open: (state) => state.open,
        counting: (state) => state.goals.some(isCounting) || isCounting(state.open.goal),
        countGivenUp: (state) => state.countGivenUp,
        goalById: (state) => (id) => state.goals.find((goal) => sameId(goal, id)) || null
    },
    mutations: {
        setFilters(state, filters) { state.filters = { ...state.filters, ...filters }; },
        started(state, { serial, quiet }) {
            state.serial = serial;
            if (!quiet) state.status = LOADING;
        },
        /* A goal with a write still on its way keeps what the person just did; the write's own answer settles it. */
        listed(state, goals) {
            const kept = new Map(state.goals.filter((goal) => state.writing[goal._id]).map((goal) => [String(goal._id), goal]));
            state.goals = goals.map((goal) => kept.get(String(goal._id)) || goal);
            state.status = READY;
            const shown = state.open.id && state.goals.find((goal) => sameId(goal, state.open.id));
            if (shown) state.open = { id: state.open.id, status: READY, goal: shown };
        },
        failed(state) { state.status = FAILED; },
        put(state, goal) {
            const others = state.goals.filter((entry) => !sameId(entry, goal._id));
            state.goals = listed(goal, state.filters) ? [...others, goal].sort(byName) : others;
            if (state.open.id && sameId(goal, state.open.id)) state.open = { id: state.open.id, status: READY, goal };
        },
        drop(state, id) {
            state.goals = state.goals.filter((goal) => !sameId(goal, id));
            if (String(state.open.id) === String(id)) state.open = { id: state.open.id, status: state.open.status === LOADING ? MISSING : GONE, goal: null };
        },
        setOpen(state, open) { state.open = open; },
        setCountGivenUp(state, givenUp) { state.countGivenUp = givenUp; },
        writing(state, { id, by }) {
            const count = (state.writing[id] || 0) + by;
            const others = Object.fromEntries(Object.entries(state.writing).filter(([key]) => key !== String(id)));
            state.writing = count > 0 ? { ...others, [id]: count } : others;
        },
        patchTarget(state, { id, targetId, fields, saving = false }) {
            const patched = (goal) => ({
                ...goal,
                targets: goal.targets.map((target) => {
                    if (String(target.id) !== String(targetId)) return target;
                    const settled = Object.fromEntries(Object.entries(target).filter(([key]) => key !== 'saving'));
                    return { ...settled, ...fields, ...(saving ? { saving: true } : {}) };
                })
            });
            const goal = state.goals.find((entry) => sameId(entry, id)) || (state.open.goal && sameId(state.open.goal, id) ? state.open.goal : null);
            if (!goal) return;
            const next = patched(goal);
            state.goals = state.goals.map((entry) => (sameId(entry, id) ? next : entry));
            if (state.open.goal && sameId(state.open.goal, id)) state.open = { ...state.open, goal: next };
        }
    },
    actions: {
        applyFilters({ commit, dispatch }, filters) {
            commit('setFilters', filters);
            return dispatch('load');
        },

        /* `quiet` is the refresh after a change made elsewhere: the goals stay on screen while they are read again. */
        async load({ commit, state }, { quiet = false } = {}) {
            const serial = state.serial + 1;
            const silent = quiet && state.status === READY;
            commit('started', { serial, quiet: silent });
            try {
                const goals = await send(listRequest(state.filters));
                if (state.serial === serial) commit('listed', Array.isArray(goals) ? goals : []);
            } catch (error) {
                if (state.serial === serial && !silent) commit('failed');
            }
        },

        async open({ commit, dispatch, getters }, id) {
            const known = getters.goalById(id);
            commit('setOpen', known ? { id, status: READY, goal: known } : { id, status: LOADING, goal: null });
            if (!known) await dispatch('read', id);
        },

        close({ commit }) { commit('setOpen', closed()); },

        async read({ commit, state }, id) {
            try {
                const goal = await send(readRequest(id));
                commit(goal ? 'put' : 'drop', goal || id);
                return goal || null;
            } catch (error) {
                if (failure(error).kind === 'missing') commit('drop', id);
                else if (String(state.open.id) === String(id) && state.open.status === LOADING) commit('setOpen', { id, status: FAILED, goal: null });
                return null;
            }
        },

        async refresh({ dispatch, getters, state }) {
            await dispatch('load', { quiet: true });
            const { id, status } = state.open;
            if (id && ![MISSING, GONE].includes(status) && !getters.goalById(id)) await dispatch('read', id);
        },

        /* The server says only that some goal changed, to everyone, on every write: a burst is read once. */
        changed({ dispatch, state }) {
            if (state.status !== READY) return;
            clearTimeout(refetchTimers.get(state));
            refetchTimers.set(state, setTimeout(() => dispatch('refresh'), REFETCH_DELAY_MS));
        },

        stopWatching({ state }) {
            clearTimeout(refetchTimers.get(state));
            refetchTimers.delete(state);
        },

        async create({ commit }, form) {
            try {
                const goal = await send(createRequest(form));
                if (goal) commit('put', goal);
                return goal || null;
            } catch (error) {
                throw failure(error);
            }
        },

        update: (context, { id, changes }) => write(context, id, updateRequest(id, changes)),
        archive: (context, id) => write(context, id, archiveRequest(id)),
        restore: (context, id) => write(context, id, restoreRequest(id)),
        addTarget: (context, { id, form }) => write(context, id, addTargetRequest(id, form)),
        removeTarget: (context, { id, targetId }) => write(context, id, removeTargetRequest(id, targetId)),
        setSources: (context, { id, target, sources }) => write(context, id, sourcesRequest(id, target, sources)),

        editTarget(context, { id, target, form }) {
            const request = editTargetRequest(id, target, form);
            if (!Object.keys(request.body).length) return Promise.resolve(context.getters.goalById(id) || context.state.open.goal);
            return write(context, id, request);
        },

        /* The new value shows at once; the percentages wait for the server, which is the only one that counts. */
        setValue(context, { id, target, value }) {
            const fields = valueOf(target, value);
            const was = Object.fromEntries(Object.keys(fields).map((key) => [key, target[key]]));
            const patch = (next, saving) => context.commit('patchTarget', { id, targetId: target.id, fields: next, saving });
            patch(fields, true);
            return write(context, id, valueRequest(id, target, value), () => patch(was, false));
        }
    }
};
