const { objectIdIfHex } = require('./objectIdKeys');

const LIST_PLACEMENT_KEYS = Object.freeze(['id', 'name', 'folderId', 'folderName']);
const ID_KEYS = ['id', 'folderId'];

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && !(value instanceof Date) && value._bsontype !== 'ObjectId';

/* The setter of a task's sprintArray. Readers match the list's id and folder id and show the two names; a writer
 * handed the whole stored list would otherwise leave its people, counters and flags on every task in it. A stored
 * list names itself by _id. A dotted update of one key reaches the setter as a bare value and is left alone, so
 * its writer passes an ObjectId for an id path, as before. */
const listPlacement = (value) => {
    if (!isPlainObject(value)) return value;
    const placed = {};
    LIST_PLACEMENT_KEYS.forEach((key) => {
        const kept = key === 'id' && value.id === undefined ? value._id : value[key];
        if (kept !== undefined) placed[key] = ID_KEYS.includes(key) ? objectIdIfHex(kept) : kept;
    });
    return placed;
};

module.exports = { LIST_PLACEMENT_KEYS, listPlacement };
