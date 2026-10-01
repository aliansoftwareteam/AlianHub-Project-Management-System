import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

export const WHITEBOARD_EVENT = 'whiteboardChanged';
export const SAVE_DELAY_MS = 800;
const RETRY_DELAY_MS = 8000;
const MAX_CONFLICT_TRIES = 4;
/* The names and sizes Modules/Whiteboards/boardRules.js takes; a spec holds the two lists together. */
export const NOTE_TONES = ['amber', 'green', 'red', 'violet', 'brand', 'grey'];
export const NOTE_BOUNDS = { minW: 40, maxW: 1200, minH: 24, maxH: 1200 };
const TASK = 'task';
/* A waiting change is kept under the task's id for a card and under this prefix for a note or a text. */
const ELEMENT_KEY = 'el:';

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

export const newElementId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const placeIn = (place) => ({ x: Math.max(0, Math.round(Number(place.x) || 0)), y: Math.max(0, Math.round(Number(place.y) || 0)) });
const between = (value, min, max) => Math.min(max, Math.max(min, Math.round(Number(value) || 0)));
const bodyOf = (response) => response?.data?.data;
const isElementKey = (key) => key.startsWith(ELEMENT_KEY);
const isWritten = (element) => Boolean(element) && element.type !== TASK && !element.withheld;
const byLayer = (a, b) => (a.z || 0) - (b.z || 0);

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
    const noteLimit = ref(500);
    const textLimit = ref(2000);
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
    /* Notes and text as this person sees them: the saved ones with their own waiting edits and deletions on top. */
    const written = computed(() => {
        const shown = new Map(elements.value.filter(isWritten).map((element) => [element.id, element]));
        pending.forEach((change, key) => {
            if (!isElementKey(key)) return;
            if (change.remove) shown.delete(key.slice(ELEMENT_KEY.length));
            else shown.set(change.element.id, change.element);
        });
        return [...shown.values()].sort(byLayer);
    });
    const canWrite = computed(() => phase.value === 'ready' && canEdit.value && !usesLocal.value);
    const notesFull = computed(() => written.value.length >= noteLimit.value);
    const topLayer = computed(() => Math.max(0, ...elements.value.map((element) => element.z || 0), ...written.value.map((element) => element.z || 0)));

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
        noteLimit.value = Number(board.limits?.notes) || noteLimit.value;
        textLimit.value = Number(board.limits?.text) || textLimit.value;
    };

    const cardFor = (taskId, place) => {
        const held = byTask.value.get(taskId);
        return { id: held ? held.id : newElementId(), type: TASK, taskId, ...placeIn(place), z: held ? held.z || 0 : 0 };
    };

    const patchOf = (changes) => {
        const upsert = [];
        const remove = [];
        changes.forEach((change, key) => {
            if (!isElementKey(key)) upsert.push(cardFor(key, change));
            else if (change.remove) remove.push(key.slice(ELEMENT_KEY.length));
            else upsert.push({ ...change.element });
        });
        return { baseRevision: revision.value, ...(upsert.length ? { upsert } : {}), ...(remove.length ? { remove } : {}) };
    };

    const settle = (sent) => {
        sent.forEach((change, key) => { if (pending.get(key) === change) pending.delete(key); });
        keepUnsaved();
    };

    const send = (changes) => apiRequest('patch', url(), patchOf(changes));

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

    const wait = (key, change) => {
        pending.set(key, change);
        keepUnsaved();
        saveState.value = 'saving';
        schedule();
    };

    /* A note or a text is sent whole, so the fields are settled here the way the server would settle them. */
    const putElement = (element) => {
        if (!canWrite.value || !element || element.type === TASK) return;
        wait(`${ELEMENT_KEY}${element.id}`, {
            element: {
                id: element.id,
                type: element.type,
                text: String(element.text ?? '').slice(0, textLimit.value),
                ...(element.type === 'note' ? { tone: NOTE_TONES.includes(element.tone) ? element.tone : NOTE_TONES[0] } : {}),
                ...placeIn(element),
                w: between(element.w, NOTE_BOUNDS.minW, NOTE_BOUNDS.maxW),
                h: between(element.h, NOTE_BOUNDS.minH, NOTE_BOUNDS.maxH),
                z: Math.max(0, Math.round(Number(element.z) || 0)),
            },
        });
    };

    const removeElement = (id) => {
        if (canWrite.value) wait(`${ELEMENT_KEY}${id}`, { remove: true });
    };

    const waitingFrom = (stored) => Object.entries(stored || {}).forEach(([key, change]) => {
        if (!isElementKey(key)) pending.set(key, placeIn(change));
        else if (change?.remove === true) pending.set(key, { remove: true });
        else if (change?.element?.id) pending.set(key, { element: change.element });
    });

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
                if (source.value === 'server' && canEdit.value) waitingFrom(readStored(unsavedKey()));
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

    /* Moves still waiting when the view turns to another list are sent for the list they were made on. If that
       save does not land they stay in this browser under that list's key and go in the next time it is opened. */
    const sendOff = (project, sprint) => {
        if (!pending.size || !canEdit.value || usesLocal.value || inFlight || !project || !sprint) return;
        const key = unsavedKeyOf(project, sprint);
        const kept = localStorage.getItem(key);
        apiRequest('patch', `${env.WHITEBOARDS}/${project}/${sprint}`, patchOf(pending))
            .then(() => { if (localStorage.getItem(key) === kept) writeStored(key, null); })
            .catch(() => {});
    };

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
        if (project === oldProject && sprint === oldSprint) return;
        sendOff(oldProject, oldSprint);
        reset();
    });
    onBeforeUnmount(() => {
        unbind();
        window.removeEventListener('online', onOnline);
        flush();
        alive = false;
    });

    return {
        phase, canEdit, canMove, canWrite, saveState, usesLocal, hasUnusedLocal, withheld, elements, written, notesFull, textLimit, topLayer,
        history, historyFailed, placeOf, place, putElement, removeElement, uploadLocal, discardLocal, loadHistory, restore,
    };
}
