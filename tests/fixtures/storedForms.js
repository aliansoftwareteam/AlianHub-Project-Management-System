/* Filters matched the way MongoDB does, where an ObjectId never equals its hex text. sift alone would
 * read an ObjectId as its hex, so each ObjectId is tagged before matching. */
const mongoose = require('mongoose');
const sift = require('sift');

const oid = (id) => new mongoose.Types.ObjectId(id);

const bson = (value) => {
    if (value instanceof mongoose.Types.ObjectId) return { objectId: value.toHexString() };
    if (Array.isArray(value)) return value.map(bson);
    if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof RegExp)) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bson(v)]));
    }
    return value;
};

const matchesLikeMongo = (filter) => {
    const test = sift(bson(filter || {}));
    return (row) => test(bson(row));
};

/* The $match stages a pipeline opens with, which are the ones that pick rows from the collection. */
const leadingMatch = (pipeline) => {
    const stages = [];
    for (const stage of pipeline) {
        if (!stage.$match) break;
        stages.push(stage.$match);
    }
    return { $and: stages.length ? stages : [{}] };
};

const filterOf = (method, data) => (method === 'aggregate' ? leadingMatch(data[0]) : data[0] || {});

module.exports = { oid, bson, matchesLikeMongo, leadingMatch, filterOf };
