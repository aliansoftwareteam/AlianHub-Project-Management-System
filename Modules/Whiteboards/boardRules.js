const MAX_ELEMENTS = 2000;
const MAX_PATCH_BYTES = 512 * 1024;
const MAX_COORDINATE = 100000;
const MAX_Z = 1000000;
const MAX_SNAPSHOTS = 20;
const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;

const ELEMENT_ID = /^[A-Za-z0-9_-]{1,40}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ELEMENT_TYPES = Object.freeze(['task']);
const PATCH_FIELDS = Object.freeze(['baseRevision', 'upsert', 'remove']);
/* A card holds where it sits and which task it stands for, and nothing else: with no free text and no
 * source field there is nothing a client could have rendered as markup, and no place for a data URL. */
const ELEMENT_FIELDS = Object.freeze(['id', 'type', 'taskId', 'x', 'y', 'z']);

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

const coordinate = (value, field) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_COORDINATE) {
        throw new BoardRefused(field, `A card sits between 0 and ${MAX_COORDINATE}.`);
    }
    return Math.round(value);
};

const layer = (value) => {
    if (value === undefined) return 0;
    if (!Number.isInteger(value) || value < 0 || value > MAX_Z) throw new BoardRefused('upsert.z', `A card's layer is a whole number up to ${MAX_Z}.`);
    return value;
};

const parseElement = (raw) => {
    if (!isPlainObject(raw)) throw new BoardRefused('upsert', 'Each card must be an object.');
    const unknown = Object.keys(raw).find((field) => !ELEMENT_FIELDS.includes(field));
    if (unknown) throw new BoardRefused(`upsert.${unknown}`, `A card cannot carry ${unknown}.`);
    if (typeof raw.id !== 'string' || !ELEMENT_ID.test(raw.id)) throw new BoardRefused('upsert.id', 'A card needs an id of letters, digits, - and _.');
    if (!ELEMENT_TYPES.includes(raw.type)) throw new BoardRefused('upsert.type', 'This kind of card is not supported.');
    if (typeof raw.taskId !== 'string' || !OBJECT_ID.test(raw.taskId)) throw new BoardRefused('upsert.taskId', 'A card must name the task it stands for.');
    return { id: raw.id, type: raw.type, taskId: raw.taskId.toLowerCase(), x: coordinate(raw.x, 'upsert.x'), y: coordinate(raw.y, 'upsert.y'), z: layer(raw.z) };
};

const parsePatch = (body) => {
    if (!isPlainObject(body)) throw new BoardRefused('body', 'The save must be an object.');
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_PATCH_BYTES) {
        throw new BoardRefused('body', `One save can carry at most ${MAX_PATCH_BYTES} bytes.`, 413);
    }
    const unknown = Object.keys(body).find((field) => !PATCH_FIELDS.includes(field));
    if (unknown) throw new BoardRefused(unknown, `A save cannot carry ${unknown}.`);
    if (!Number.isInteger(body.baseRevision) || body.baseRevision < 0) throw new BoardRefused('baseRevision', 'A save names the revision it was made on.');

    const { upsert = [], remove = [] } = body;
    if (!Array.isArray(upsert) || upsert.length > MAX_ELEMENTS) throw new BoardRefused('upsert', `A save can change at most ${MAX_ELEMENTS} cards.`);
    if (!Array.isArray(remove) || remove.length > MAX_ELEMENTS || remove.some((id) => typeof id !== 'string' || !ELEMENT_ID.test(id))) {
        throw new BoardRefused('remove', 'Cards are taken off by their ids.');
    }
    if (!upsert.length && !remove.length) throw new BoardRefused('body', 'The save changes nothing.');

    const elements = upsert.map(parseElement);
    if (new Set(elements.map((element) => element.id)).size !== elements.length) throw new BoardRefused('upsert', 'A save names each card once.');
    return { baseRevision: body.baseRevision, upsert: elements, remove: [...new Set(remove)] };
};

/* The task behind a card is fixed when the card is made, and a task has one card: a second card for it moves the first. */
const applyPatch = (elements, patch) => {
    const gone = new Set(patch.remove);
    const next = (elements || []).filter((element) => !gone.has(element.id)).map((element) => ({ ...element }));
    patch.upsert.forEach((change) => {
        const held = next.find((element) => element.id === change.id) || next.find((element) => element.taskId === change.taskId);
        if (held) Object.assign(held, { x: change.x, y: change.y, z: change.z });
        else next.push({ ...change });
    });
    if (next.length > MAX_ELEMENTS) throw new BoardRefused('upsert', `A board holds at most ${MAX_ELEMENTS} cards.`);
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
    MAX_PATCH_BYTES,
    MAX_COORDINATE,
    MAX_Z,
    MAX_SNAPSHOTS,
    SNAPSHOT_INTERVAL_MS,
    OBJECT_ID,
    BoardRefused,
    parsePatch,
    applyPatch,
    reasonToKeep,
    snapshotOf,
};
