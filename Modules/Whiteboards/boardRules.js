const MAX_ELEMENTS = 2000;
const MAX_NOTES = 500;
const MAX_TEXT_LENGTH = 2000;
const MAX_PATCH_BYTES = 512 * 1024;
/* History keeps up to MAX_SNAPSHOTS whole scenes in the board's own document, which MongoDB caps at 16 MB. */
const MAX_SCENE_BYTES = 512 * 1024;
const MAX_COORDINATE = 100000;
const MAX_Z = 1000000;
const MIN_WIDTH = 40;
const MAX_WIDTH = 1200;
const MIN_HEIGHT = 24;
const MAX_HEIGHT = 1200;
const MAX_SNAPSHOTS = 20;
const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;

const ELEMENT_ID = /^[A-Za-z0-9_-]{1,40}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TASK = 'task';
/* A tone is a name the web app maps to a design token; a colour value is never stored. */
const NOTE_TONES = Object.freeze(['amber', 'green', 'red', 'violet', 'brand', 'grey']);
const PATCH_FIELDS = Object.freeze(['baseRevision', 'upsert', 'remove']);
/* Each kind carries these fields and nothing else: the only free text is `text`, which every client shows as
 * text, and there is no source, style or colour field for markup or a data URL to sit in. */
const ELEMENT_FIELDS = Object.freeze({
    task: Object.freeze(['id', 'type', 'taskId', 'x', 'y', 'z']),
    note: Object.freeze(['id', 'type', 'text', 'tone', 'x', 'y', 'w', 'h', 'z']),
    text: Object.freeze(['id', 'type', 'text', 'x', 'y', 'w', 'h', 'z']),
});

class BoardRefused extends Error {
    constructor(field, message, statusCode = 400) {
        super(message);
        this.name = 'BoardRefused';
        this.field = field;
        this.statusCode = statusCode;
    }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const isTask = (element) => element.type === TASK;

const within = (value, field, min, max, what) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        throw new BoardRefused(field, `${what} is a number between ${min} and ${max}.`);
    }
    return Math.round(value);
};

const layer = (value) => {
    if (value === undefined) return 0;
    if (!Number.isInteger(value) || value < 0 || value > MAX_Z) throw new BoardRefused('upsert.z', `An element's layer is a whole number up to ${MAX_Z}.`);
    return value;
};

const placeOf = (raw) => ({ x: within(raw.x, 'upsert.x', 0, MAX_COORDINATE, 'A place'), y: within(raw.y, 'upsert.y', 0, MAX_COORDINATE, 'A place') });

/* Stored as typed: no trimming and no escaping, because it is never read as anything but text. */
const textOf = (raw) => {
    if (typeof raw.text !== 'string' || raw.text.length > MAX_TEXT_LENGTH) throw new BoardRefused('upsert.text', `Text is a string of at most ${MAX_TEXT_LENGTH} characters.`);
    return raw.text;
};

const writtenElement = (raw) => {
    const text = textOf(raw);
    if (raw.type === 'note' && !NOTE_TONES.includes(raw.tone)) throw new BoardRefused('upsert.tone', `A note's tone is one of ${NOTE_TONES.join(', ')}.`);
    return {
        id: raw.id,
        type: raw.type,
        text,
        ...(raw.type === 'note' ? { tone: raw.tone } : {}),
        ...placeOf(raw),
        w: within(raw.w, 'upsert.w', MIN_WIDTH, MAX_WIDTH, 'A width'),
        h: within(raw.h, 'upsert.h', MIN_HEIGHT, MAX_HEIGHT, 'A height'),
        z: layer(raw.z),
    };
};

const taskCard = (raw) => {
    if (typeof raw.taskId !== 'string' || !OBJECT_ID.test(raw.taskId)) throw new BoardRefused('upsert.taskId', 'A card must name the task it stands for.');
    return { id: raw.id, type: raw.type, taskId: raw.taskId.toLowerCase(), ...placeOf(raw), z: layer(raw.z) };
};

const parseElement = (raw) => {
    if (!isPlainObject(raw)) throw new BoardRefused('upsert', 'Each element must be an object.');
    if (typeof raw.id !== 'string' || !ELEMENT_ID.test(raw.id)) throw new BoardRefused('upsert.id', 'An element needs an id of letters, digits, - and _.');
    const fields = Object.prototype.hasOwnProperty.call(ELEMENT_FIELDS, raw.type) ? ELEMENT_FIELDS[raw.type] : null;
    if (!fields) throw new BoardRefused('upsert.type', 'This kind of element is not supported.');
    const unknown = Object.keys(raw).find((field) => !fields.includes(field));
    if (unknown) throw new BoardRefused(`upsert.${unknown}`, `A ${raw.type} cannot carry ${unknown}.`);
    return isTask(raw) ? taskCard(raw) : writtenElement(raw);
};

const overCap = (elements) => elements.filter(isTask).length > MAX_ELEMENTS || elements.filter((element) => !isTask(element)).length > MAX_NOTES;

const parsePatch = (body) => {
    if (!isPlainObject(body)) throw new BoardRefused('body', 'The save must be an object.');
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_PATCH_BYTES) {
        throw new BoardRefused('body', `One save can carry at most ${MAX_PATCH_BYTES} bytes.`, 413);
    }
    const unknown = Object.keys(body).find((field) => !PATCH_FIELDS.includes(field));
    if (unknown) throw new BoardRefused(unknown, `A save cannot carry ${unknown}.`);
    if (!Number.isInteger(body.baseRevision) || body.baseRevision < 0) throw new BoardRefused('baseRevision', 'A save names the revision it was made on.');

    const { upsert = [], remove = [] } = body;
    const most = MAX_ELEMENTS + MAX_NOTES;
    if (!Array.isArray(upsert) || upsert.length > most) throw new BoardRefused('upsert', `A save can change at most ${most} elements.`);
    if (!Array.isArray(remove) || remove.length > most || remove.some((id) => typeof id !== 'string' || !ELEMENT_ID.test(id))) {
        throw new BoardRefused('remove', 'Elements are taken off by their ids.');
    }
    if (!upsert.length && !remove.length) throw new BoardRefused('body', 'The save changes nothing.');

    const elements = upsert.map(parseElement);
    if (overCap(elements)) throw new BoardRefused('upsert', `A save can change at most ${MAX_ELEMENTS} cards and ${MAX_NOTES} notes and texts.`);
    if (new Set(elements.map((element) => element.id)).size !== elements.length) throw new BoardRefused('upsert', 'A save names each element once.');
    return { baseRevision: body.baseRevision, upsert: elements, remove: [...new Set(remove)] };
};

/* The task behind a card is fixed when the card is made, and a task has one card: a second card for it moves the
 * first. A note or a text is replaced whole, so the last save of it wins. */
const applyPatch = (elements, patch) => {
    const gone = new Set(patch.remove);
    const next = (elements || []).filter((element) => !gone.has(element.id)).map((element) => ({ ...element }));
    patch.upsert.forEach((change) => {
        const at = next.findIndex((element) => element.id === change.id);
        if (at !== -1 && next[at].type !== change.type) throw new BoardRefused('upsert.type', 'An element keeps the kind it was made as.');
        if (!isTask(change)) {
            if (at === -1) next.push({ ...change });
            else next[at] = { ...change };
            return;
        }
        const held = at !== -1 ? next[at] : next.find((element) => isTask(element) && element.taskId === change.taskId);
        if (held) Object.assign(held, { x: change.x, y: change.y, z: change.z });
        else next.push({ ...change });
    });
    if (overCap(next)) throw new BoardRefused('upsert', `A board holds at most ${MAX_ELEMENTS} cards and ${MAX_NOTES} notes and texts.`);
    if (Buffer.byteLength(JSON.stringify(next), 'utf8') > MAX_SCENE_BYTES) throw new BoardRefused('upsert', `A board can hold at most ${MAX_SCENE_BYTES} bytes.`, 413);
    return next;
};

const touchesMostOf = (elements, patch) => {
    const touched = patch.upsert.length + patch.remove.length;
    return touched >= Math.max(2, Math.ceil(elements.length / 2));
};

/* Why the state a save is about to replace is kept, or '' when it is not. Every move would otherwise push an
 * earlier arrangement out of the short history, so one person's small moves share a state per interval. */
const reasonToKeep = ({ board, uid, patch, now, restoring = false }) => {
    if (!board || !(board.elements || []).length) return '';
    if (restoring) return 'restore';
    if (String(board.updatedBy || '') !== String(uid)) return 'author';
    if (patch && touchesMostOf(board.elements, patch)) return 'bulk';
    const keptAt = board.historyKeptAt ? new Date(board.historyKeptAt).getTime() : 0;
    return now.getTime() - keptAt >= SNAPSHOT_INTERVAL_MS ? 'interval' : '';
};

const snapshotOf = (board, reason) => ({
    revision: board.revision,
    elements: board.elements,
    savedBy: String(board.updatedBy || ''),
    savedAt: board.savedAt || null,
    reason,
});

module.exports = {
    MAX_ELEMENTS,
    MAX_NOTES,
    MAX_TEXT_LENGTH,
    MAX_PATCH_BYTES,
    MAX_SCENE_BYTES,
    MAX_COORDINATE,
    MAX_Z,
    MIN_WIDTH,
    MAX_WIDTH,
    MIN_HEIGHT,
    MAX_HEIGHT,
    MAX_SNAPSHOTS,
    SNAPSHOT_INTERVAL_MS,
    NOTE_TONES,
    OBJECT_ID,
    BoardRefused,
    isTask,
    parsePatch,
    applyPatch,
    reasonToKeep,
    snapshotOf,
};
