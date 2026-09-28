const mongoose = require('mongoose');

const HEX_ID = /^[0-9a-fA-F]{24}$/;

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && !(value instanceof Date) && value._bsontype !== 'ObjectId';

/* A setter for a Mixed id path. Mongoose runs a Mixed path's setter on a save and an update but
 * never on a filter, so a query can still match a value stored as text before its migration;
 * typing the path as ObjectId would cast the filters too, and throw on a legacy value that is not
 * an id. A value that is not a 24-hex id is stored as sent. */
const objectIdIfHex = (value) => (typeof value === 'string' && HEX_ID.test(value) ? new mongoose.Types.ObjectId(value) : value);

/* The same for an untyped Object path whose listed keys hold ObjectIds. A dotted update of one key
 * reaches the setter as a bare value, so it is left alone and its writer passes an ObjectId. */
const objectIdKeys = (...keys) => (value) => {
    if (!isPlainObject(value)) return value;
    const out = { ...value };
    keys.filter((key) => key in out).forEach((key) => { out[key] = objectIdIfHex(out[key]); });
    return out;
};

/* Every stored form of each id, for a filter on a field whose rows a migration may not have reached yet. */
const idForms = (ids) => [].concat(ids === undefined || ids === null ? [] : ids)
    .flatMap((id) => (HEX_ID.test(String(id)) ? [String(id), new mongoose.Types.ObjectId(String(id))] : [id]));

module.exports = { objectIdKeys, objectIdIfHex, idForms, HEX_ID };
