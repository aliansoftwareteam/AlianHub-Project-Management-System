import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

export const WHITEBOARD_EVENT = 'whiteboardChanged';
export const SAVE_DELAY_MS = 800;
const RETRY_DELAY_MS = 8000;
const MAX_CONFLICT_TRIES = 4;

export const legacyKeyOf = (projectId, sprintId) => `wb:${projectId || 'p'}:${sprintId || 's'}`;
export const unsavedKeyOf = (projectId, sprintId) => `wb-unsaved:${projectId || 'p'}:${sprintId || 's'}`;

const readStored = (key) => {
    try {
        const stored = JSON.parse(localStorage.getItem(key) || 'null');
        return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : null;
    } catch (error) {
        return null;
    }
};
const writeStored = (key, value) => {
    try {
        if (value && Object.keys(value).length) localStorage.setItem(key, JSON.stringify(value));
        else localStorage.removeItem(key);
    } catch (error) {
        console.error('ERROR in keeping the whiteboard on this device: ', error);
    }
};

const newCardId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const placeIn = (place) => ({ x: Math.max(0, Math.round(Number(place.x) || 0)), y: Math.max(0, Math.round(Number(place.y) || 0)) });
const bodyOf = (response) => response?.data?.data;

/* One list's board. `source` is 'local' while the only board is the one an earlier build kept in this browser:
   it stays in use, untouched, until someone uploads it, and is never sent or removed without being asked. */
export function useWhiteboardBoard({ projectId, sprintId, socket }) {
    const phase = ref('loading');
    const source = ref('server');
    const canEdit = ref(false);
    const revision = ref(0);
    const boardId = ref(null);
    const elements = ref([]);
    const limit = ref(2000);
    const pending = reactive(new Map());
    const localCopy = ref(null);
    const saveState = ref('saved');
    const history = ref(null);
    const historyFailed = ref(false);

    let saveTimer = null;
    let retryTimer = null;
    let inFlight = false;
    let loadedKey = '';
    let bound = null;
    let alive = true;

    const url = () => `${env.WHITEBOARDS}/${projectId.value}/${sprintId.value}`;
    const ready = () => Boolean(projectId.value && sprintId.value);
    const keyNow = () => `${projectId.value}:${sprintId.value}`;
    const legacyKey = () => legacyKeyOf(projectId.value, sprintId.value);
    const unsavedKey = () => unsavedKeyOf(projectId.value, sprintId.value);

    const byTask = computed(() => new Map(elements.value.filter((element) => element.taskId).map((element) => [element.taskId, element])));
    const withheld = computed(() => elements.value.filter((element) => element.withheld));
    const usesLocal = computed(() => source.value === 'local');
    const hasUnusedLocal = computed(() => phase.value === 'ready' && source.value === 'server' && Boolean(localCopy.value));
    const canMove = computed(() => phase.value === 'ready' && (usesLocal.value || canEdit.value));

    const placeOf = (taskId) => {
        if (usesLocal.value) return localCopy.value?.[taskId] || null;
        return pending.get(taskId) || byTask.value.get(taskId) || null;
    };

    const keepUnsaved = () => writeStored(unsavedKey(), Object.fromEntries(pending));

    const adopt = (board) => {
        if (!board) return;
        revision.value = Number(board.revision) || 0;
        boardId.value = board.boardId || null;
        elements.value = Array.isArray(board.elements) ? board.elements : [];
        canEdit.value = board.canEdit === true;
        limit.value = Number(board.limits?.elements) || limit.value;
    };

    const cardsFor = (places) => [...places].map(([taskId, place]) => {
        const held = byTask.value.get(taskId);
        return { id: held ? held.id : newCardId(), type: 'task', taskId, ...placeIn(place), z: held ? held.z || 0 : 0 };
    });

    const settle = (sent) => {
        sent.forEach((place, taskId) => { if (pending.get(taskId) === place) pending.delete(taskId); });
        keepUnsaved();
    };

    const send = (places) => apiRequest('patch', url(), { baseRevision: revision.value, upsert: cardsFor(places) });

    const retryLater = () => {
        clearTimeout(retryTimer);
        if (alive) retryTimer = setTimeout(() => flush(), RETRY_DELAY_MS);
    };

    /* A 409 carries the board as it is now. The moves still waiting are put back on top of it (they are read
       before the board in placeOf) and sent again against its revision, so only the cards this person moved
       are written and everyone else's stay where they put them. */
    async function flush() {
        clearTimeout(saveTimer);
        clearTimeout(retryTimer);
        if (inFlight || !pending.size || !canEdit.value || usesLocal.value || !ready()) return;
        const key = keyNow();
        inFlight = true;
        saveState.value = 'saving';
        try {
            for (let attempt = 1; ; attempt += 1) {
                const sent = new Map(pending);
                try {
                    const response = await send(sent);
                    if (key !== keyNow()) return;
                    adopt(bodyOf(response));
                    settle(sent);
                    break;
                } catch (error) {
                    if (key !== keyNow()) return;
                    const status = error?.response?.status;
                    if (status === 409 && attempt < MAX_CONFLICT_TRIES) {
                        adopt(error.response.data?.data);
                        continue;
                    }
                    if (status === 409) adopt(error.response.data?.data);
                    saveState.value = status ? 'failed' : 'offline';
                    if (!status) retryLater();
                    return;
                }
            }
            saveState.value = pending.size ? 'saving' : 'saved';
        } finally {
            inFlight = false;
        }
        if (pending.size && saveState.value === 'saving') schedule();
    }

    function schedule() {
        clearTimeout(saveTimer);
        if (alive) saveTimer = setTimeout(() => flush(), SAVE_DELAY_MS);
    }

    const place = (changes) => {
        if (!canMove.value) return;
        const entries = Object.entries(changes || {});
        if (!entries.length) return;
        if (usesLocal.value) {
            localCopy.value = { ...(localCopy.value || {}), ...Object.fromEntries(entries.map(([taskId, at]) => [taskId, placeIn(at)])) };
            writeStored(legacyKey(), localCopy.value);
            return;
        }
        entries.forEach(([taskId, at]) => pending.set(taskId, placeIn(at)));
        keepUnsaved();
        saveState.value = 'saving';
        schedule();
    };

    async function load() {
        if (!ready()) return;
        const key = keyNow();
        try {
            const board = bodyOf(await apiRequest('get', url()));
            if (key !== keyNow()) return;
            adopt(board);
            if (loadedKey !== key) {
                loadedKey = key;
                localCopy.value = readStored(legacyKey());
                source.value = revision.value === 0 && localCopy.value ? 'local' : 'server';
                Object.entries(source.value === 'server' && canEdit.value ? readStored(unsavedKey()) || {} : {})
                    .forEach(([taskId, at]) => pending.set(taskId, placeIn(at)));
            } else if (revision.value > 0) {
                source.value = 'server';
            }
            phase.value = 'ready';
            if (pending.size && !usesLocal.value) {
                saveState.value = 'saving';
                schedule();
            }
        } catch (error) {
            if (key !== keyNow()) return;
            if (phase.value !== 'ready') phase.value = 'unavailable';
            console.error('ERROR in loading the whiteboard: ', error);
        }
    }

    /* The first save of a board is made on revision 0, so the server answers 409 instead of replacing a board
       someone else saved in the meantime; the browser copy is then kept and simply no longer used. */
    async function uploadLocal(taskIdsFirst = []) {
        if (!usesLocal.value || !canEdit.value || inFlight || !localCopy.value) return;
        const copy = localCopy.value;
        const order = [...new Set([...taskIdsFirst.filter((taskId) => copy[taskId]), ...Object.keys(copy)])].slice(0, limit.value);
        inFlight = true;
        saveState.value = 'saving';
        try {
            const response = await send(new Map(order.map((taskId) => [taskId, copy[taskId]])));
            adopt(bodyOf(response));
            writeStored(legacyKey(), null);
            localCopy.value = null;
            source.value = 'server';
            saveState.value = 'saved';
        } catch (error) {
            const status = error?.response?.status;
            if (status === 409) {
                adopt(error.response.data?.data);
                source.value = 'server';
                saveState.value = 'saved';
            } else {
                saveState.value = status ? 'failed' : 'offline';
            }
        } finally {
            inFlight = false;
        }
    }

    const discardLocal = () => {
        if (usesLocal.value) return;
        writeStored(legacyKey(), null);
        localCopy.value = null;
    };

    async function loadHistory() {
        historyFailed.value = false;
        try {
            history.value = bodyOf(await apiRequest('get', `${url()}/history`)) || [];
        } catch (error) {
            history.value = [];
            historyFailed.value = true;
        }
    }

    /* Restoring replaces the whole board on purpose, so moves still waiting to be saved are dropped with it. */
    async function restore(wanted) {
        if (!canEdit.value || inFlight) return false;
        clearTimeout(saveTimer);
        inFlight = true;
        try {
            const response = await apiRequest('post', `${url()}/restore`, { revision: wanted });
            pending.clear();
            keepUnsaved();
            adopt(bodyOf(response));
            saveState.value = 'saved';
            return true;
        } catch (error) {
            if (error?.response?.status === 409) adopt(error.response.data?.data);
            return false;
        } finally {
            inFlight = false;
            if (pending.size) schedule();
        }
    }

    const onChanged = (change) => {
        if (!change || inFlight) return;
        if (boardId.value && change.boardId !== boardId.value) return;
        if (Number(change.revision) > revision.value) load();
    };

    function unbind() {
        bound?.off?.(WHITEBOARD_EVENT, onChanged);
        bound = null;
    }
    function bind() {
        const live = socket?.value;
        if (live === bound) return;
        unbind();
        if (!live?.on) return;
        bound = live;
        live.on(WHITEBOARD_EVENT, onChanged);
    }

    const onOnline = () => (phase.value === 'ready' ? flush() : load());

    const reset = () => {
        clearTimeout(saveTimer);
        clearTimeout(retryTimer);
        pending.clear();
        phase.value = 'loading';
        source.value = 'server';
        saveState.value = 'saved';
        elements.value = [];
        revision.value = 0;
        boardId.value = null;
        history.value = null;
        localCopy.value = null;
        loadedKey = '';
        load();
    };

    onMounted(() => {
        load();
        bind();
        window.addEventListener('online', onOnline);
    });
    watch(() => socket?.value, bind);
    watch(() => [projectId.value, sprintId.value], ([project, sprint], [oldProject, oldSprint]) => {
        if (project !== oldProject || sprint !== oldSprint) reset();
    });
    onBeforeUnmount(() => {
        unbind();
        window.removeEventListener('online', onOnline);
        flush();
        alive = false;
    });

    return {
        phase, canEdit, canMove, saveState, usesLocal, hasUnusedLocal, withheld, elements, history, historyFailed,
        placeOf, place, uploadLocal, discardLocal, loadHistory, restore,
    };
}
