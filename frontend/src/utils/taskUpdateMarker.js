// getRandomValues rather than randomUUID: the latter is missing on plain-http self-hosted installs.
const bytes = crypto.getRandomValues(new Uint8Array(16));
const TAB_ID = `tab-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

export const tabUpdateMarker = (timeStamp) => ({ user: TAB_ID, timeStamp });

export const isOwnTabUpdate = (marker) => marker?.user === TAB_ID;

/* The server stores the marker only with a reorder, so an edit of a field cannot carry it.
   The tab keeps what it has sent and not yet had answered instead: an event that left the
   server before the answer must not put an older value back. */
const editsInFlight = new Map();
/* A request that is cancelled never answers; its edit must not hold the task for good. */
const HOLD_MS = 30000;

const dropEdit = (id, edit) => {
    const left = (editsInFlight.get(id) || []).filter((other) => other !== edit);
    if (left.length) editsInFlight.set(id, left);
    else editsInFlight.delete(id);
};

export function holdOwnEdit(taskId, fields, before) {
    const id = String(taskId);
    const edit = { fields, before: { ...before }, at: Date.now() };
    editsInFlight.set(id, [...(editsInFlight.get(id) || []), edit]);
    return {
        confirm: () => dropEdit(id, edit),
        /* Returns the fields to put back. A field a later edit still holds stays as that edit
           left it, and that edit now returns to this one's start if it fails too. */
        refuse: () => {
            const all = editsInFlight.get(id) || [];
            const later = all.slice(all.indexOf(edit) + 1);
            dropEdit(id, edit);
            const restore = {};
            Object.keys(edit.fields).forEach((field) => {
                const next = later.find((other) => field in other.fields);
                if (next) next.before[field] = edit.before[field];
                else restore[field] = edit.before[field];
            });
            return restore;
        }
    };
}

export const ownEditsInFlight = (taskId) => Object.assign({}, ...(editsInFlight.get(String(taskId)) || [])
    .filter((edit) => Date.now() - edit.at < HOLD_MS)
    .map((edit) => edit.fields));

/* A move or a convert takes the task off its list first, and that event can reach the tab before
   or just after the answer. The tab that asked for it says what happened itself. */
const AFTER_ANSWER_MS = 5000;
const leavesAskedHere = new Map();

export function holdOwnLeave(taskId) {
    const id = String(taskId);
    leavesAskedHere.set(id, Date.now() + HOLD_MS);
    return () => leavesAskedHere.set(id, Date.now() + AFTER_ANSWER_MS);
}

export const isOwnLeave = (taskId) => (leavesAskedHere.get(String(taskId)) || 0) > Date.now();
