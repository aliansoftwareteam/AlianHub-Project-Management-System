const mongoose = require('mongoose');

const HEX_ID = /^[0-9a-fA-F]{24}$/;

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && !(value instanceof Date) && value._bsontype !== 'ObjectId';

/* A setter for an untyped Object path whose listed keys hold ObjectIds. Mongoose runs it when a
 * document is built and on a whole-object $set, but never on a filter, so a query can still match
 * a value stored as text before migration 044; typing the keys as ObjectId paths would cast the
 * filters too, and throw on the legacy keys that are not ids. A value that is not a 24-hex id is
 * stored as sent. A dotted update of one key reaches the setter as a bare value, so it is left
 * alone and its writer passes an ObjectId. */
const objectIdKeys = (...keys) => (value) => {
    if (!isPlainObject(value)) return value;
    const out = { ...value };
    keys.forEach((key) => {
        if (typeof out[key] === 'string' && HEX_ID.test(out[key])) out[key] = new mongoose.Types.ObjectId(out[key]);
    });
    return out;
};

module.exports = { objectIdKeys, HEX_ID };
